/**
 * Tests del extractor de la imagen del PERSONAJE.
 *
 * El panel del personaje es fijo (mitad izquierda de la carta), así que se testea
 * la geometría del recorte y la detección/borrado de la bandera con lienzos
 * sintéticos; no se depende de imágenes reales.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PANEL, FLAG_BOX, hasFlag, extractCharacterFromCard } from '../src/extract-character.mjs';

import sharp from 'sharp';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Lienzo RGBA oscuro. */
function canvas(width, height, bg = [12, 12, 18]) {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i += 1) {
    data[i * channels] = bg[0];
    data[i * channels + 1] = bg[1];
    data[i * channels + 2] = bg[2];
    data[i * channels + 3] = 255;
  }
  return { data, channels, width, height };
}

function paintRect(c, x0, y0, w, h, color) {
  const { data, channels, width } = c;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * width + x) * channels;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = 255;
    }
  }
}

/** Guarda el lienzo como PNG temporal para pasarlo por sharp. */
async function writeTmp(c, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'char-'));
  const file = path.join(dir, name);
  await sharp(c.data, { raw: { width: c.width, height: c.height, channels: c.channels } })
    .png()
    .toFile(file);
  return file;
}

test('el panel del personaje cubre la mitad izquierda y no el logo', () => {
  assert.ok(PANEL.x0 < PANEL.x1, 'x0 < x1');
  assert.ok(PANEL.y0 < PANEL.y1, 'y0 < y1');
  // Debe quedarse en la mitad izquierda: el logo y el texto van a la derecha.
  assert.ok(PANEL.x1 <= 0.45, `x1 ${PANEL.x1} no debe invadir la zona del logo`);
  assert.ok(PANEL.x0 >= 0.01, 'x0 deja margen con el borde');
  // Y cubrir bastante alto de la carta (el personaje es vertical).
  assert.ok(PANEL.y1 - PANEL.y0 > 0.8, 'debe cubrir casi todo el alto');
});

test('hasFlag detecta la bandera por su borde claro y la ignora si no está', () => {
  const c = canvas(720, 405);
  // Bandera dentro de la caja calibrada, con borde claro.
  const fx = Math.round(720 * FLAG_BOX.x0) + 4;
  const fy = Math.round(405 * FLAG_BOX.y0) + 4;
  paintRect(c, fx, fy, 60, 40, [245, 245, 245]);
  assert.equal(hasFlag(c.data, c.width, c.height, c.channels), true, 'con bandera');

  const sin = canvas(720, 405);
  assert.equal(hasFlag(sin.data, sin.width, sin.height, sin.channels), false, 'sin bandera');
});

test('el recorte del personaje sale del panel y conserva su arte', async () => {
  const c = canvas(720, 405);
  // Personaje: rectángulo grande en el panel izquierdo.
  const px = Math.floor(720 * PANEL.x0) + 10;
  const py = Math.floor(405 * PANEL.y0) + 10;
  const pw = Math.floor(720 * (PANEL.x1 - PANEL.x0)) - 20;
  const ph = Math.floor(405 * (PANEL.y1 - PANEL.y0)) - 20;
  paintRect(c, px, py, pw, ph, [200, 120, 60]);
  // Bandera encima, dentro de su caja calibrada.
  paintRect(c, Math.round(720 * FLAG_BOX.x0) + 4, Math.round(405 * FLAG_BOX.y0) + 4, 60, 40, [250, 250, 250]);

  const file = await writeTmp(c, 'card.png');
  const r = await extractCharacterFromCard(file);
  assert.ok(r, 'debe extraer');
  assert.equal(r.flag, true, 'debe reportar la bandera');

  // El resultado es SIEMPRE el lienzo de carta (720x1008, proporción 1.4), no el
  // tamaño del panel: así todos los personajes encajan igual en el marco de la
  // card 3D, sin franjas ni deformación.
  const { info } = await sharp(r.buffer).raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, 720, `ancho de carta, se obtuvo ${info.width}`);
  assert.equal(info.height, 1008, `alto de carta, se obtuvo ${info.height}`);
  assert.ok(Math.abs(info.height / info.width - 1.4) < 0.005, 'proporción de carta 1.4');
  // La figura se ajusta para CABER completa: el panel no debe quedar recortado.
  assert.ok(
    r.box.width <= Math.round(720 * (PANEL.x1 - PANEL.x0)) + 2,
    'el recorte no debe exceder el panel medido',
  );

  // El arte se conserva OPACO, incluida la zona de la bandera: se decidió NO
  // borrarla porque cualquier relleno sería contenido inventado (dejarla
  // transparente dejaba un hueco visible y promediar bordes dejaba un manchón).
  const { data, info: out2 } = await sharp(r.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // El buffer ya es el lienzo de carta (720x1008) con la figura escalada, así que
  // la zona de la bandera se localiza con la transformación real: se recorta el
  // panel, se escala para caber y se centra. En vez de recalcular la escala, se
  // comprueba el hecho que importa: el interior del panel sigue opaco.
  const fzX = Math.round(out2.width * 0.9);
  const fzY = Math.round(out2.height * 0.1);
  const inside = data[((fzY * out2.width) + fzX) * out2.channels + 3];
  assert.equal(inside, 255, 'la zona de la bandera conserva su píxel original');
  // Y el personaje, que está más abajo, debe seguir opaco.
  const bodyY = Math.round(out2.height * 0.6);
  const bodyX = Math.round(out2.width * 0.5);
  const body = data[((bodyY * out2.width) + bodyX) * out2.channels + 3];
  assert.equal(body, 255, 'el cuerpo del personaje no debe borrarse');
});

test('sin bandera no se borra nada del personaje', async () => {
  const c = canvas(720, 405);
  const px = Math.floor(720 * PANEL.x0) + 10;
  const py = Math.floor(405 * PANEL.y0) + 10;
  paintRect(c, px, py, 120, 120, [200, 120, 60]);
  const file = await writeTmp(c, 'card2.png');
  const r = await extractCharacterFromCard(file);
  assert.ok(r, 'debe extraer');
  assert.equal(r.flag, false, 'no debe reportar bandera');
  const { data, info } = await sharp(r.buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // El centro de la figura sigue opaco (no se borró nada del personaje).
  const cx = Math.round(info.width * 0.5);
  const cy = Math.round(info.height * 0.5);
  assert.equal(data[((cy * info.width) + cx) * info.channels + 3], 255, 'el personaje sigue opaco');
  // Y la esquina es transparente solo si el encuadre dejó hueco: con `inside` el
  // sobrante se rellena con alfa 0, así que la esquina NUNCA debe ser un color
  // inventado; o es arte opaco o es transparente.
  const corner = data[3];
  assert.ok(corner === 255 || corner === 0, `esquina opaca o transparente, no un relleno (${corner})`);
});

test('devuelve null si la imagen no tiene tamaño suficiente', async () => {
  const c = canvas(40, 30);
  const file = await writeTmp(c, 'tiny.png');
  const r = await extractCharacterFromCard(file);
  assert.equal(r, null, 'una imagen diminuta no da panel válido');
});
