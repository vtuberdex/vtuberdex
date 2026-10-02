/**
 * Subida y reemplazo de las imágenes de un VTuber desde el mantenedor.
 *
 * Diseño:
 *   - Sin dependencias nuevas: el cuerpo llega como binario (`express.raw`) y se
 *     valida con `sharp`, que ya está en el proyecto. No se usa multer.
 *   - El tipo se decide por el CONTENIDO decodificado, no por la extensión ni el
 *     `Content-Type` (ambos los controla el cliente): si `sharp` no puede leerlo
 *     como imagen, se rechaza.
 *   - El archivo se guarda con el nombre canónico del asset
 *     (`data/images/<carpeta>/<slug>.webp`), así que reemplazar una imagen no deja
 *     huérfanos ni cambia la ruta que ya sirve la API.
 *   - Se actualiza la fila de `asset` (dimensiones y bytes) para que la auditoría
 *     refleje lo que hay en disco.
 */

import fs from 'node:fs';
import { promises as fsP } from 'node:fs';
import path from 'node:path';

/** Tipos de asset que el mantenedor puede reemplazar. */
export const UPLOADABLE_KINDS = {
  /**
   * La FICHA apaisada del sitio original (imagen legacy). Es el respaldo que se
   * muestra cuando el VTuber no tiene personaje. La CARTA en sí no se sube: la
   * compone el visor 3D en el navegador a partir del personaje y el logo.
   */
  card: { folder: 'ficha', width: 720 },
  /**
   * El PERSONAJE normalizado al lienzo de carta (720x1008). Es la imagen que
   * consumen la carta 3D, el listado y la ficha: llega ya recortada y con la
   * proporción correcta, así que ninguna vista tiene que deformarla.
   *
   * Escribe en `character/` —la carpeta del personaje— y no en `avatar/`: así una
   * sustitución desde el mantenedor y una regeneración del scraper escriben el
   * MISMO archivo en vez de dos copias que se contradicen.
   */
  character: { folder: 'character', width: 720, keepAlpha: true, ratio: 1.4 },
  thumb: { folder: 'thumb', width: 360, keepAlpha: true, ratio: 1.4 },
  logo: { folder: 'logo', width: 900, keepAlpha: true, trim: true },
  radar: { folder: 'radar', width: 512 },
  /**
   * El FONDO de la carta 3D: la capa que se pinta POR DETRÁS del personaje.
   *
   * Se normaliza al MISMO lienzo que el personaje (720x1008, `cover`): así el fondo
   * y el personaje comparten encuadre y el paralaje entre las dos capas no arrastra
   * un desajuste de proporción. Se conserva el alfa porque un fondo puede traerlo
   * (un cielo calado, un degradado con transparencia).
   */
  background: { folder: 'background', width: 720, keepAlpha: true, ratio: 1.4 },
};

/** Tamaño máximo aceptado para una imagen subida (12 MB). */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

/**
 * Formatos de ENTRADA aceptados (se normalizan todos a WebP al guardar).
 *
 * Los identificadores son los que reporta `sharp.metadata().format`, que NO
 * siempre coincide con la extensión: AVIF se reporta como `heif`. Se consulta
 * `sharp.format` para que la lista refleje lo que esta instalación realmente
 * puede decodificar, en vez de asumir un juego de formatos.
 */
export const ACCEPTED_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'avif', 'heif', 'tiff', 'svg'];

/**
 * Formatos que SÍ pueden conservar transparencia al convertirlos. El resto (JPEG,
 * TIFF sin alfa) son opacos por definición; se avisa en la respuesta para que el
 * mantenedor no crea que perdió el alfa por un error de la conversión.
 */
export const FORMATS_WITH_ALPHA = ['png', 'webp', 'gif', 'avif', 'heif', 'svg', 'tiff'];

/**
 * Recorta el alfa real de un PNG. `trim()` de sharp usa la esquina como
 * referencia y falla si esa esquina no es transparente, así que se recorre el
 * canal alfa para hallar la caja con contenido.
 * @returns {{left:number,top:number,width:number,height:number}|null}
 */
export function alphaBounds(data, width, height, channels) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (data[(y * width + x) * channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Procesa y guarda una imagen subida.
 * @param {object} args
 * @param {Buffer} args.buffer   bytes recibidos
 * @param {string} args.kind     uno de UPLOADABLE_KINDS
 * @param {string} args.slug     slug del VTuber (nombre canónico del archivo)
 * @param {string} args.imageRoot raíz de imágenes (`data/images`)
 * @param {object} args.sharp    instancia de sharp
 * @returns {Promise<{path:string,width:number,height:number,bytes:number}>}
 */
export async function saveUploadedImage({ buffer, kind, slug, imageRoot, sharp }) {
  const spec = UPLOADABLE_KINDS[kind];
  if (!spec) throw new Error('kind_invalido');
  if (!buffer || buffer.length === 0) throw new Error('archivo_vacio');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('archivo_demasiado_grande');

  // Validación por CONTENIDO: si sharp no lo decodifica, no es una imagen.
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('no_es_imagen');
  }
  if (!meta.format || !ACCEPTED_FORMATS.includes(meta.format)) {
    throw new Error(`formato_no_soportado:${meta.format ?? 'desconocido'}`);
  }
  if (!meta.width || !meta.height) throw new Error('imagen_sin_dimensiones');

  const dir = path.join(imageRoot, spec.folder);
  await fsP.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${slug}.webp`);

  let pipeline = sharp(buffer, { animated: false });
  // Los logos traen padding transparente baked; se recorta el alfa real para que
  // no queden diminutos ni con márgenes enormes (mismo criterio que el scraper).
  if (spec.trim) {
    const raw = await sharp(buffer, { animated: false }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bounds = alphaBounds(raw.data, raw.info.width, raw.info.height, raw.info.channels);
    if (bounds && (bounds.width < raw.info.width || bounds.height < raw.info.height)) {
      pipeline = sharp(buffer, { animated: false }).extract(bounds);
    }
  }

  // --- Conversión a WebP optimizado -------------------------------------------
  // Todo lo que se sube sale como WebP, sea cual sea el formato de entrada.
  //   - Con alfa (logos): `nearLossless` en vez de pérdida normal. Los trazos
  //     finos y el texto de un logo se llenan de artefactos con pérdida a q92,
  //     porque el WebP con pérdida no es bueno en bordes duros de 1px.
  //   - Sin alfa (cartas): pérdida de alta calidad (94), que da archivos mucho
  //     más pequeños sin diferencia visible en arte fotográfico.
  // `effort: 6` (el máximo) comprime mejor a costa de algo más de CPU: aquí no
  // importa porque se procesa una imagen por petición, no en lote.
  const hasAlpha = Boolean(meta.hasAlpha) || spec.keepAlpha;
  /**
   * El PERSONAJE y la CARTA se normalizan a la proporción EXACTA de la carta
   * (1.4) al subirlos, con `cover`: escalan hasta llenar el lienzo y se recorta
   * el exceso. Con `inside` se conservaba la proporción del archivo original, así
   * que un personaje más ancho que una carta se guardaba más ancho y luego la
   * carta 3D lo dejaba con franjas o lo deformaba: la imagen dejaba de ser
   * proporcional al marco. Recortar es la única forma de garantizar que la
   * proporción no dependa de lo que suba el usuario.
   */
  const fitsCard = spec.ratio !== undefined;
  const resized = fitsCard
    ? pipeline.resize({
        width: spec.width,
        height: Math.round(spec.width * spec.ratio),
        fit: 'cover',
        position: 'top',
      })
    : pipeline.resize({ width: spec.width, withoutEnlargement: true, fit: 'inside' });

  let converted = await (hasAlpha
    ? resized.webp({ nearLossless: true, quality: 90, alphaQuality: 100, effort: 6, smartSubsample: false })
    : resized.webp({ quality: 94, effort: 6 })
  ).toBuffer();

  // Si el resultado pesa MÁS que el original, se reintenta con pérdida más
  // agresiva. Sin esto, un original ya optimizado (un JPEG pequeño) salía más
  // grande que antes de subirlo, que es justo lo contrario de "optimizar".
  if (converted.length > buffer.length) {
    const alt = await (fitsCard
      ? pipeline.resize({ width: spec.width, height: Math.round(spec.width * spec.ratio), fit: 'cover', position: 'top' })
      : pipeline.resize({ width: spec.width, withoutEnlargement: true, fit: 'inside' })
    )
      .webp({ quality: hasAlpha ? 92 : 86, alphaQuality: 100, effort: 6 })
      .toBuffer();
    if (alt.length < converted.length) converted = alt;
  }

  await fsP.writeFile(file, converted);

  const out = await sharp(converted).metadata();
  return {
    path: `images/${spec.folder}/${slug}.webp`,
    width: out.width ?? spec.width,
    height: out.height ?? 0,
    bytes: converted.length,
    format: 'webp',
    hasAlpha: Boolean(out.hasAlpha),
    /**
     * Aviso para la UI: JPEG nunca tiene alfa, así que si el original era JPEG el
     * usuario no perdió nada; si era PNG/WebP con alfa y no se conservó, sí.
     */
    alphaLost: FORMATS_WITH_ALPHA.includes(meta.format) && Boolean(meta.hasAlpha) && !out.hasAlpha,
  };
}

/** Borra la imagen de un asset (deja el VTuber sin esa imagen). */
export async function removeUploadedImage({ kind, slug, imageRoot }) {
  const spec = UPLOADABLE_KINDS[kind];
  if (!spec) throw new Error('kind_invalido');
  const file = path.join(imageRoot, spec.folder, `${slug}.webp`);
  if (fs.existsSync(file)) await fsP.unlink(file);
  return { path: `images/${spec.folder}/${slug}.webp` };
}

/**
 * Guarda el EMBLEMA de una facción como PNG (`<imageRoot>/faction/<slug>.png`).
 *
 * A diferencia de las imágenes de un VTuber, los emblemas son PNG y no WebP: así los publica el
 * scraper (`images/faction/*.png`) y así los sirve la ruta `/images`. Se conserva el alfa y se
 * limita a 512 px de lado (el emblema se dibuja a ~74 px en la carta: más es peso muerto en
 * Turso). Se valida por contenido con `sharp`, igual que el resto de subidas.
 */
export async function saveFactionEmblem({ buffer, slug, imageRoot, sharp }) {
  if (!buffer || buffer.length === 0) throw new Error('archivo_vacio');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new Error('archivo_demasiado_grande');
  let meta;
  try {
    meta = await sharp(buffer).metadata();
  } catch {
    throw new Error('no_es_imagen');
  }
  if (!meta.format || !ACCEPTED_FORMATS.includes(meta.format)) {
    throw new Error(`formato_no_soportado:${meta.format ?? 'desconocido'}`);
  }
  const dir = path.join(imageRoot, 'faction');
  await fsP.mkdir(dir, { recursive: true });
  const converted = await sharp(buffer, { animated: false })
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .png({ compressionLevel: 9 })
    .toBuffer();
  await fsP.writeFile(path.join(dir, `${slug}.png`), converted);
  const out = await sharp(converted).metadata();
  return { path: `images/faction/${slug}.png`, width: out.width ?? 0, height: out.height ?? 0, bytes: converted.length };
}
