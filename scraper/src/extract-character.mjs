/**
 * Extrae la IMAGEN DEL PERSONAJE desde la imagen de la carta.
 *
 * Contexto: en las cartas, el arte del personaje ocupa un panel a la IZQUIERDA
 * (aproximadamente del 4% al 38% del ancho). Solo 211 de 785 VTubers tienen el
 * personaje servido por separado (los `avatar` de la página de detalle); el
 * resto solo existe dentro de la carta, así que hay que rescatarlo de ahí.
 *
 * El panel es estable entre cartas (medido sobre una muestra), pero la bandera
 * del país se superpone en la esquina superior izquierda: se detecta y se borra
 * con transparencia para que no aparezca en la carta ni en el listado.
 */

import { promises as fsP } from 'node:fs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
/**
 * Las fichas APAISADAS del sitio, que son la fuente del recorte. Viven en
 * `ficha/`: antes se leían de `card/`, pero esa carpeta pasó a ser la de la carta
 * compuesta y luego quedó vacía, así que el extractor se quedaba sin entrada.
 */
const CARDS = path.join(ROOT, 'data', 'images', 'ficha');
const OUTDIR = path.join(ROOT, 'data', 'images', 'character');
/** Lienzo de carta coleccionable (proporción 1.4 de alto/ancho). */
const CARD_W = 720;
const CARD_H = 1008;
const DATASET = path.join(HERE, '..', 'out', 'dataset.json');
const REPORT = path.join(HERE, '..', 'out', 'character-extraction.json');

/**
 * Panel del personaje, en fracciones de la carta. Se toma un poco de margen a
 * los lados para no cortar personajes anchos.
 */
export const PANEL = { x0: 0.035, y0: 0.015, x1: 0.385, y1: 0.935 };

/**
 * Zona donde vive la bandera del país (fracciones de la CARTA).
 * Medida sobre 77 cartas: el rectángulo está en x0≈3.8%, y0≈6.2%, ancho≈16.8%
 * y alto≈19.5%, con muy poca varianza. Se usa la mediana con un margen pequeño.
 *
 * Se usa una caja FIJA en vez de detección por color porque el pelo o la ropa
 * claros del personaje se confunden con el borde blanco de la bandera, y la
 * detección por color dejaba huecos enormes o no borraba nada.
 */
export const FLAG_BOX = { x0: 0.028, y0: 0.048, x1: 0.212, y1: 0.263 };

/** Zona de búsqueda (algo más amplia que la caja) para tests y diagnóstico. */
export const FLAG_ZONE = { x0: 0.01, y0: 0.03, x1: 0.24, y1: 0.29 };

/**
 * Comprueba si hay bandera: se considera que sí cuando la zona calibrada tiene
 * suficientes píxeles claros (borde blanco del rectángulo). Solo informativo:
 * el borrado usa la caja calibrada sin depender de esta detección.
 */
export function hasFlag(data, width, height, channels) {
  const sx0 = Math.floor(width * FLAG_ZONE.x0);
  const sx1 = Math.floor(width * FLAG_ZONE.x1);
  const sy0 = Math.floor(height * FLAG_ZONE.y0);
  const sy1 = Math.floor(height * FLAG_ZONE.y1);
  let claros = 0;
  for (let y = sy0; y < sy1; y += 1) {
    for (let x = sx0; x < sx1; x += 1) {
      const i = (y * width + x) * channels;
      if (Math.min(data[i], data[i + 1], data[i + 2]) > 170) claros += 1;
    }
  }
  return claros / Math.max(1, (sx1 - sx0) * (sy1 - sy0)) > 0.05;
}

/**
 * Borde DERECHO del panel del personaje, medido en la propia ficha.
 *
 * El panel no tiene un ancho fijo: medido en las 785 fichas va del 31% al 48.8%
 * del ancho (mediana 37.9%). Usar un corte fijo en 38.5% cortaba al personaje por
 * la mitad en 168 de ellas (las de panel ancho, p. ej. `3lpantuflas-exe`, con el
 * panel al 51%, o `dra-yusei`, donde el brazo cruza el borde).
 *
 * Se detecta el borde buscando el primer "valle" oscuro sostenido a la derecha
 * del 28%: el panel con el personaje es la zona con contenido y a su derecha está
 * el fondo oscuro con el logo y el texto, mucho más apagado.
 *
 * @param {Uint8Array|Buffer} data pixeles crudos
 * @param {number} width ancho de la imagen
 * @param {number} height alto de la imagen
 * @param {number} channels canales por pixel
 * @returns {number} fracción del ancho donde termina el panel (con respaldo fijo)
 */
export function detectPanelRight(data, width, height, channels) {
  const columna = [];
  for (let x = 0; x < width; x += 1) {
    let suma = 0;
    for (let y = 0; y < height; y += 2) {
      const i = (y * width + x) * channels;
      suma += data[i] + data[i + 1] + data[i + 2];
    }
    columna.push(suma / (3 * Math.ceil(height / 2)));
  }
  // Primer tramo sostenido de oscuridad (8 columnas por debajo del umbral) que
  // empieza después del 28% del ancho.
  for (let x = Math.round(width * 0.28); x < Math.round(width * 0.72) - 8; x += 1) {
    let oscuro = true;
    for (let k = 0; k < 8; k += 1) {
      if (columna[x + k] > 14) {
        oscuro = false;
        break;
      }
    }
    if (oscuro) return x / width;
  }
  // Sin valle claro (paneles oscuros): se usa el respaldo, que cubre la mediana
  // con margen para no cortar al personaje.
  return PANEL.x1;
}

/**
 * Extrae el personaje de una carta.
 * @returns {Promise<{buffer:Buffer, box:object, flag:boolean}|null>}
 */
export async function extractCharacterFromCard(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // El ancho del panel se mide en ESTA ficha en vez de asumir uno fijo.
  const panelRight = Math.min(0.9, Math.max(0.3, detectPanelRight(data, width, height, channels)));
  const crop = {
    left: Math.max(0, Math.round(width * PANEL.x0)),
    top: Math.max(0, Math.round(height * PANEL.y0)),
    width: 0,
    height: 0,
  };
  crop.width = Math.min(width - crop.left, Math.round(width * (panelRight - PANEL.x0)));
  crop.height = Math.min(height - crop.top, Math.round(height * (PANEL.y1 - PANEL.y0)));
  if (crop.width < 40 || crop.height < 40) return null;

  // NOTA sobre la bandera del país: se superpone al arte del personaje en la
  // esquina superior izquierda (FLAG_BOX documenta dónde). Se probó a BORRARLA de
  // dos formas y ambas resultaron PEORES que dejarla:
  //   1. Dejando la zona transparente -> recuadro hueco visible sobre el fondo.
  //   2. Rellenando con la mezcla del borde -> manchón de franjas grises.
  // El contenido detrás de la bandera no existe en el origen, así que cualquier
  // relleno es contenido INVENTADO. Se conservan los píxeles originales: es más
  // fiel al origen que un parche falso. Eliminarla de verdad requeriría un
  // inpaint real (modelo), no un promedio de bordes.
  const raw = await sharp(file).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = raw.data;
  /**
   * Se normaliza SIEMPRE al lienzo de carta (720x1008, proporción 1.4) con
   * `cover`: escala hasta llenar y recorta el exceso. Antes se guardaba el
   * recorte en su tamaño natural, así que el asset quedaba con la proporción del
   * trozo recortado y NO con la de una carta (p. ej. `dra-yusei` salía 720x930,
   * ratio 1.29 y sin alfa). Esa imagen luego no encaja en el marco de la carta 3D:
   * aparece con franjas o deformada. Normalizar aquí es lo que garantiza que
   * TODOS los personajes sean intercambiables en el mismo marco.
   */
  /**
   * Encuadre final: la figura se ESCALA para caber completa dentro del lienzo de
   * carta (720x1008) y el espacio sobrante se rellena con TRANSPARENCIA.
   *
   * Reglas:
   *   - Se ajusta por el lado más restrictivo (`inside`), así NUNCA se recorta
   *     nada de la figura: ni el 5% de muslos que perdía `cover`, ni el brazo de
   *     `dra-yusei` que quedaba fuera por un panel más ancho.
   *   - El hueco se rellena con alfa 0, no con color: la card 3D dibuja encima su
   *     propio fondo y un relleno opaco taparía el marco.
   *   - El resultado es SIEMPRE 720x1008 (proporción 1.4), de modo que todos los
   *     personajes encajan igual en el mismo marco.
   */
  const escalada = await sharp(out, { raw: { width: raw.info.width, height: raw.info.height, channels: raw.info.channels } })
    .resize({ width: CARD_W, height: CARD_H, fit: 'inside', withoutEnlargement: false })
    .ensureAlpha()
    .png()
    .toBuffer();

  const tam = await sharp(escalada).metadata();
  const anchoFinal = tam.width ?? CARD_W;
  const altoFinal = tam.height ?? CARD_H;
  const sobraX = CARD_W - anchoFinal;
  const sobraY = CARD_H - altoFinal;
  const lienzo = await sharp(escalada)
    .extend({
      // Centrado: el sobrante se reparte a los dos lados.
      top: Math.floor(sobraY / 2),
      bottom: Math.ceil(sobraY / 2),
      left: Math.floor(sobraX / 2),
      right: Math.ceil(sobraX / 2),
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  const webp = await sharp(lienzo).webp({ quality: 88, alphaQuality: 100, effort: 6 }).toBuffer();
  return { buffer: webp, box: crop, flag: hasFlag(data, width, height, channels) };
}

async function main() {
  const sample = Number(process.argv.find((a) => a.startsWith('--sample'))?.split('=')[1] ?? 0);
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  let targets = dataset.vtubers.filter((v) => v.assets?.card);
  if (sample) {
    const step = Math.max(1, Math.floor(targets.length / sample));
    targets = targets.filter((_, i) => i % step === 0).slice(0, sample);
  }
  await fsP.mkdir(OUTDIR, { recursive: true });

  const results = [];
  let extraidos = 0;
  let conBandera = 0;
  for (const v of targets) {
    const cardPath = path.join(ROOT, 'data', v.assets.card);
    if (!fs.existsSync(cardPath)) {
      results.push({ slug: v.slug, status: 'sin-carta' });
      continue;
    }
    try {
      const r = await extractCharacterFromCard(cardPath);
      if (!r) {
        results.push({ slug: v.slug, status: 'no-detectado' });
        continue;
      }
      await fsP.writeFile(path.join(OUTDIR, `${v.slug}.webp`), r.buffer);
      extraidos += 1;
      if (r.flag) conBandera += 1;
      results.push({ slug: v.slug, status: 'extraido', box: r.box, flag: r.flag });
    } catch (error) {
      results.push({ slug: v.slug, status: 'error', detail: String(error.message).slice(0, 120) });
    }
  }

  const resumen = { total: targets.length, extraidos, conBandera };
  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), resumen, results }, null, 1));
  console.log(`[character] ${JSON.stringify(resumen)}`);
  console.log(`[character] informe: out/character-extraction.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[character] ERROR', error);
    process.exit(1);
  });
}
