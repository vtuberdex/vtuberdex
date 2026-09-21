/**
 * Tests de la subida de imágenes del mantenedor.
 *
 * Se testea el módulo directamente (no el HTTP) porque lo que importa aquí es la
 * validación: que un archivo que NO es imagen se rechace por CONTENIDO, que se
 * respeten los límites, y que el guardado use la ruta canónica del asset.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import sharp from 'sharp';

import {
  ACCEPTED_FORMATS,
  MAX_UPLOAD_BYTES,
  UPLOADABLE_KINDS,
  alphaBounds,
  removeUploadedImage,
  saveUploadedImage,
} from '../src/uploads.mjs';

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'uploads-'));

/** PNG opaco de color plano. */
async function pngBuffer(width = 120, height = 90, color = { r: 200, g: 40, b: 90 }) {
  return sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer();
}

/** PNG con contenido real rodeado de margen transparente. */
async function paddedPng() {
  const inner = await sharp({ create: { width: 60, height: 30, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } })
    .png()
    .toBuffer();
  return sharp({ create: { width: 200, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: inner, left: 70, top: 35 }])
    .png()
    .toBuffer();
}

test('acepta un PNG y lo guarda en la ruta canónica del asset', async () => {
  const root = tmpRoot();
  const saved = await saveUploadedImage({
    buffer: await pngBuffer(),
    kind: 'card',
    slug: 'prueba-uno',
    imageRoot: root,
    sharp,
  });
  assert.equal(saved.path, 'images/ficha/prueba-uno.webp');
  assert.ok(fs.existsSync(path.join(root, 'ficha', 'prueba-uno.webp')), 'el archivo existe en disco');
  assert.equal(saved.width, 120);
  assert.ok(saved.bytes > 0);
});

test('reemplazar la misma imagen usa la MISMA ruta (no deja huérfanos)', async () => {
  const root = tmpRoot();
  const first = await saveUploadedImage({ buffer: await pngBuffer(120, 90), kind: 'logo', slug: 'dup', imageRoot: root, sharp });
  const second = await saveUploadedImage({ buffer: await pngBuffer(300, 100), kind: 'logo', slug: 'dup', imageRoot: root, sharp });
  assert.equal(first.path, second.path, 'misma ruta canónica');
  const files = fs.readdirSync(path.join(root, 'logo'));
  assert.equal(files.length, 1, `debe quedar 1 archivo, hay ${files.length}`);
  assert.equal(second.width, 300, 'se actualizó el contenido');
});

test('convierte CUALQUIER formato de entrada a WebP optimizado', async () => {
  const root = tmpRoot();
  const svg = Buffer.from(
    '<svg width="400" height="200"><circle cx="100" cy="100" r="70" fill="#ff3366"/><text x="190" y="115" font-size="34" fill="#fff">LOGO</text></svg>',
  );
  const entradas = {
    png: await sharp(svg).png().toBuffer(),
    jpeg: await sharp(svg).flatten({ background: '#101010' }).jpeg({ quality: 98 }).toBuffer(),
    webp: await sharp(svg).webp({ quality: 95 }).toBuffer(),
    gif: await sharp(svg).gif().toBuffer(),
    tiff: await sharp(svg).tiff().toBuffer(),
    svg,
  };
  for (const [fmt, buffer] of Object.entries(entradas)) {
    const saved = await saveUploadedImage({ buffer, kind: 'logo', slug: `conv-${fmt}`, imageRoot: root, sharp });
    assert.equal(saved.format, 'webp', `${fmt} debe salir como webp`);
    assert.ok(saved.bytes > 0, `${fmt} debe producir bytes`);
    const onDisk = await sharp(path.join(root, 'logo', `conv-${fmt}.webp`)).metadata();
    assert.equal(onDisk.format, 'webp', `${fmt}: el archivo en disco es webp real`);
  }
});

test('conserva la transparencia de PNG/WebP/GIF/AVIF y la reporta', async () => {
  const root = tmpRoot();
  // Se usa `card` (no `logo`) porque el logo recorta el padding transparente:
  // aquí interesa comprobar que el ALFA sobrevive a la conversión, no el recorte.
  const conAlfa = await sharp({ create: { width: 100, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp({ create: { width: 50, height: 50, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 25, top: 25 }])
    .png()
    .toBuffer();
  const saved = await saveUploadedImage({ buffer: conAlfa, kind: 'card', slug: 'alfa', imageRoot: root, sharp });
  assert.equal(saved.format, 'webp');
  assert.equal(saved.hasAlpha, true, 'debe conservar el alfa');
  assert.equal(saved.alphaLost, false, 'no debe reportar pérdida');
  const onDisk = await sharp(path.join(root, 'ficha', 'alfa.webp')).metadata();
  assert.equal(onDisk.hasAlpha, true, 'el webp en disco tiene alfa');
  assert.equal(onDisk.width, 100, 'sin recorte: conserva el lienzo');
  // Y la transparencia debe ser real, no solo declarada.
  const { data, info } = await sharp(path.join(root, 'ficha', 'alfa.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, 'la esquina sigue transparente');
  assert.equal(data[((50 * info.width + 50) * info.channels) + 3], 255, 'el centro sigue opaco');
});

test('el logo con alfa usa near-lossless (mejor para trazos finos)', async () => {
  const root = tmpRoot();
  // Rejilla de líneas de 1px: con pérdida normal se llena de artefactos.
  const finas = await sharp({ create: { width: 200, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="200" height="40">' +
            Array.from({ length: 20 }, (_, i) => `<rect x="${i * 10}" y="5" width="1" height="30" fill="#fff"/>`).join('') +
            '</svg>',
        ),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  const saved = await saveUploadedImage({ buffer: finas, kind: 'logo', slug: 'finas', imageRoot: root, sharp });
  assert.equal(saved.hasAlpha, true, 'conserva alfa');
  // Con near-lossless el trazo de 1px no debe emborronarse: se comprueba que
  // sigue habiendo píxeles completamente opacos y completamente transparentes.
  const { data, info } = await sharp(path.join(root, 'logo', 'finas.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let opacos = 0;
  let claros = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] > 250) opacos += 1;
    else if (data[i] === 0) claros += 1;
  }
  assert.ok(opacos > 0, 'quedan trazos opacos');
  assert.ok(claros > 0, 'queda fondo transparente');
});

test('no empeora el tamaño: si el resultado pesara más, recomprime', async () => {
  const root = tmpRoot();
  // Un JPEG ya muy optimizado y de baja resolución: convertirlo a WebP q94 lo
  // haría MÁS grande, que es lo contrario de optimizar.
  const jpeg = await sharp({ create: { width: 320, height: 180, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .jpeg({ quality: 60 })
    .toBuffer();
  const saved = await saveUploadedImage({ buffer: jpeg, kind: 'card', slug: 'no-grande', imageRoot: root, sharp });
  assert.ok(saved.bytes <= jpeg.length, `no debe crecer: ${saved.bytes}b vs ${jpeg.length}b originales`);
});

test('un JPEG no reporta pérdida de alfa (nunca la tuvo)', async () => {
  const root = tmpRoot();
  const jpeg = await sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .jpeg()
    .toBuffer();
  const saved = await saveUploadedImage({ buffer: jpeg, kind: 'card', slug: 'sin-alfa', imageRoot: root, sharp });
  assert.equal(saved.hasAlpha, false);
  assert.equal(saved.alphaLost, false, 'no perdió nada: el JPEG no tiene alfa');
});

test('acepta SVG y AVIF (identificados como svg y heif por sharp)', async () => {
  const root = tmpRoot();
  const svg = Buffer.from('<svg width="60" height="60"><rect width="60" height="60" fill="#0af"/></svg>');
  const fromSvg = await saveUploadedImage({ buffer: svg, kind: 'character', slug: 'vec', imageRoot: root, sharp });
  assert.equal(fromSvg.format, 'webp');

  const avif = await sharp({ create: { width: 60, height: 60, channels: 3, background: { r: 10, g: 90, b: 200 } } })
    .avif({ quality: 70, effort: 2 })
    .toBuffer();
  const fromAvif = await saveUploadedImage({ buffer: avif, kind: 'character', slug: 'av', imageRoot: root, sharp });
  assert.equal(fromAvif.format, 'webp', 'AVIF (heif) debe convertirse, no rechazarse');
});

test('rechaza un archivo que NO es imagen, aunque se llame .png', async () => {
  const root = tmpRoot();
  await assert.rejects(
    () => saveUploadedImage({ buffer: Buffer.from('esto no es una imagen'), kind: 'card', slug: 'x', imageRoot: root, sharp }),
    /no_es_imagen/,
    'debe validar por contenido, no por nombre',
  );
});

test('rechaza un archivo vacío y uno demasiado grande', async () => {
  const root = tmpRoot();
  await assert.rejects(
    () => saveUploadedImage({ buffer: Buffer.alloc(0), kind: 'card', slug: 'x', imageRoot: root, sharp }),
    /archivo_vacio/,
  );
  const enorme = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
  await assert.rejects(
    () => saveUploadedImage({ buffer: enorme, kind: 'card', slug: 'x', imageRoot: root, sharp }),
    /archivo_demasiado_grande/,
  );
});

test('rechaza un kind desconocido', async () => {
  const root = tmpRoot();
  const buffer = await pngBuffer();
  await assert.rejects(
    () => saveUploadedImage({ buffer, kind: 'inventado', slug: 'x', imageRoot: root, sharp }),
    /kind_invalido/,
  );
});

test('el logo se recorta al contenido real (quita el margen transparente)', async () => {
  const root = tmpRoot();
  const saved = await saveUploadedImage({
    buffer: await paddedPng(),
    kind: 'logo',
    slug: 'con-padding',
    imageRoot: root,
    sharp,
  });
  // El contenido real era 60x30 dentro de un lienzo 200x100.
  assert.ok(Math.abs(saved.width - 60) <= 2, `ancho recortado ${saved.width} (esperado ~60)`);
  assert.ok(Math.abs(saved.height - 30) <= 2, `alto recortado ${saved.height} (esperado ~30)`);
});

test('la carta NO se recorta (solo el logo necesita trim)', async () => {
  const root = tmpRoot();
  const saved = await saveUploadedImage({
    buffer: await paddedPng(),
    kind: 'card',
    slug: 'carta',
    imageRoot: root,
    sharp,
  });
  assert.ok(saved.width > 60, `la carta conserva su lienzo (${saved.width})`);
});

test('respeta el ancho máximo por tipo sin ampliar', async () => {
  const root = tmpRoot();
  const saved = await saveUploadedImage({
    buffer: await pngBuffer(1600, 900),
    kind: 'thumb',
    slug: 'grande',
    imageRoot: root,
    sharp,
  });
  assert.equal(saved.width, UPLOADABLE_KINDS.thumb.width, 'se reduce al ancho del tipo');
});

test('borra la imagen y deja de existir en disco', async () => {
  const root = tmpRoot();
  await saveUploadedImage({ buffer: await pngBuffer(), kind: 'card', slug: 'borrar', imageRoot: root, sharp });
  const file = path.join(root, 'ficha', 'borrar.webp');
  assert.ok(fs.existsSync(file));
  await removeUploadedImage({ kind: 'card', slug: 'borrar', imageRoot: root });
  assert.equal(fs.existsSync(file), false, 'ya no existe');
  // Borrar dos veces no debe lanzar.
  await removeUploadedImage({ kind: 'card', slug: 'borrar', imageRoot: root });
});

test('alphaBounds encuentra la caja del contenido opaco', async () => {
  const { data, info } = await sharp(await paddedPng()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(data, info.width, info.height, info.channels);
  assert.ok(bounds, 'debe encontrar contenido');
  assert.ok(Math.abs(bounds.left - 70) <= 2, `left ${bounds.left}`);
  assert.ok(Math.abs(bounds.top - 35) <= 2, `top ${bounds.top}`);
  assert.ok(Math.abs(bounds.width - 60) <= 2, `width ${bounds.width}`);
});

test('alphaBounds devuelve null si todo es transparente', async () => {
  const { data, info } = await sharp({
    create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .png()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(alphaBounds(data, info.width, info.height, info.channels), null);
});

test('los formatos aceptados cubren lo habitual y excluyen lo que no es imagen', () => {
  for (const f of ['png', 'jpeg', 'webp', 'gif', 'tiff', 'avif', 'heif', 'svg']) {
    assert.ok(ACCEPTED_FORMATS.includes(f), `debe aceptar ${f}`);
  }
  assert.ok(!ACCEPTED_FORMATS.includes('pdf'), 'no debe aceptar pdf');
  assert.ok(!ACCEPTED_FORMATS.includes('raw'), 'no debe aceptar raw de sharp');
  // `heif` es como sharp reporta AVIF: debe estar o el AVIF se rechazaría.
  assert.ok(ACCEPTED_FORMATS.includes('heif'), 'avif se reporta como heif');
});

test('todos los tipos subibles declaran carpeta y ancho', () => {
  for (const [kind, spec] of Object.entries(UPLOADABLE_KINDS)) {
    assert.ok(spec.folder, `${kind} debe tener carpeta`);
    assert.ok(spec.width > 0, `${kind} debe tener ancho`);
  }
});

test('el PERSONAJE subido se recorta a la proporción de la carta (1.4)', async () => {
  const root = tmpRoot();
  // Una imagen MUY ancha (2:1) no debe guardarse ancha: al ir dentro de un marco
  // de carta dejaría franjas o se deformaría. Debe salir recortada a 1.4.
  const ancha = await sharp({ create: { width: 800, height: 400, channels: 3, background: { r: 200, g: 40, b: 60 } } })
    .png()
    .toBuffer();
  const saved = await saveUploadedImage({ buffer: ancha, kind: 'character', slug: 'ancha', imageRoot: root, sharp });
  assert.equal(saved.width, 720);
  assert.equal(saved.height, 1008, 'alto = ancho x 1.4');
  const ratio = saved.height / saved.width;
  assert.ok(Math.abs(ratio - 1.4) < 0.01, `proporción de carta, se obtuvo ${ratio}`);

  // Y una más ALTA que la carta también termina en la proporción exacta.
  const alta = await sharp({ create: { width: 300, height: 1200, channels: 3, background: { r: 20, g: 90, b: 180 } } })
    .png()
    .toBuffer();
  const saved2 = await saveUploadedImage({ buffer: alta, kind: 'character', slug: 'alta', imageRoot: root, sharp });
  assert.equal(saved2.height / saved2.width, 1008 / 720);

  // El logo NO se fuerza a carta: es rectangular y se muestra natural.
  const logo = await sharp({ create: { width: 900, height: 300, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .png()
    .toBuffer();
  const savedLogo = await saveUploadedImage({ buffer: logo, kind: 'logo', slug: 'recto', imageRoot: root, sharp });
  assert.ok(savedLogo.height / savedLogo.width < 1, 'el logo sigue siendo apaisado');
});
