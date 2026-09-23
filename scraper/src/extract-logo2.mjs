/**
 * Extrae el logo del VTuber desde la imagen de la CARTA, para las fichas que no
 * tienen página de detalle (el sitio no sirve esos logos por separado).
 *
 * CALIBRADO con las 154 cartas cuyo logo ya conocemos (ver calibrate-logo.mjs):
 * el logo vive en una banda estable de la carta, no en una posición arbitraria.
 *
 *   x0 ≈ 0.48 del ancho   (mediana medida)
 *   y0 ≈ 0.14 del alto
 *   ancho ≈ 0.38 del ancho de la carta
 *
 * Se extrae esa banda, se recorta el contenido real por saturación/contraste
 * (que separa el logo del fondo de arte) y se recorta el alfa.
 *
 * Uso:
 *   node src/extract-logo2.mjs --sample 40   # validación (rejilla + informe)
 *   node src/extract-logo2.mjs               # todas las que faltan
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findLogoBox as findLogoBoxEdges } from './logo-edges.mjs';
import { BAND, BADGE, MIN_SAT, MIN_VAL, MAX_DARK } from './logo-bands.mjs';

import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LOGOS = path.join(ROOT, 'data', 'images', 'logo');
const DATASET = path.join(HERE, '..', 'out', 'dataset.json');
const REPORT = path.join(HERE, '..', 'out', 'logo-extraction2.json');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const SAMPLE = Number(value('sample', '0')) || 0;
const CONCURRENCY = Number(value('concurrency', '6'));

/**
 * Banda de búsqueda del logo, derivada de la calibración.
 * Se deja margen para tolerar la variación medida (y0 entre 0.01 y 0.21) y se
 * extiende hacia abajo: muchos logos son más altos de lo que sugería la muestra
 * inicial y quedaban cortados por el pie.
 */

/**
 * Zona EXCLUIDA: el número de dex (`#NNN`) va siempre en la esquina superior
 * derecha y no forma parte del logo. Si no se enmascara, entra en el recorte.
 */

/** Umbral de saturación/valor por encima del cual se considera logo. */
/** Parametros del detector por bordes, elegidos por barrido medido. */
const EDGE_OPTIONS = { edgeMin: 60, cellMinEdge: 3, minCells: 20, ratio: 0.45 };
/** Umbral de oscuridad para cartas de fondo claro (modo `dark`). */

/**
 * Localiza la caja del contenido "logo" dentro de la banda.
 * Criterio: píxeles saturados o muy claros suelen ser el logo o su borde blanco,
 * mientras el fondo de la carta es oscuro y poco saturado.
 */
export function findLogoBoxInBand(data, width, height, channels, band = BAND, badge = BADGE) {
  // Cadena de intentos, del criterio más fiable al más permisivo:
  //   1. `sat`  — solo saturación. Discrimina mejor; con él se validaron ~770.
  //   2. `both` — saturación o brillo: rescata logos BLANCOS sobre fondo oscuro.
  //   3. `dark` — píxeles oscuros: para cartas con fondo CLARO (crema, rosa vivo)
  //               donde el logo es lo oscuro, que es el caso invertido.
  // Se corta en cuanto un intento produce una caja plausible.
  for (const mode of ['sat', 'both', 'dark']) {
    const found = detectWithMask(data, width, height, channels, mode, band, badge);
    if (found) return found;
  }
  return null;
}

function detectWithMask(data, width, height, channels, mode, band = BAND, badge = BADGE) {
  const x0 = Math.floor(width * band.x0);
  const y0 = Math.floor(height * band.y0);
  const x1 = Math.floor(width * band.x1);
  const y1 = Math.floor(height * band.y1);
  // Rectángulo del badge del número, en píxeles.
  const bx0 = Math.floor(width * badge.x0);
  const bx1 = Math.floor(width * badge.x1);
  const by0 = Math.floor(height * badge.y0);
  const by1 = Math.floor(height * badge.y1);

  // Rejilla de contenido: primero se marca qué celdas (4x4 px) tienen saturación,
  // y luego se cuenta por columnas/filas. Así una franja del MARCO (que es
  // continua) no infla una fila entera como si fuera contenido del logo.
  const CELL = 4;
  const gridCols = Math.ceil(width / CELL);
  const gridRows = Math.ceil(height / CELL);
  const grid = new Uint16Array(gridCols * gridRows);
  let hits = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) continue;
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : ((max - min) / max) * 255;
      // Cada modo responde a un tipo de carta:
      //   sat  → logo colorido sobre fondo apagado (el caso mayoritario).
      //   both → además brillo alto: rescata logos blancos sobre fondo oscuro.
      //   dark → píxeles oscuros: cartas de fondo claro con logo oscuro.
      const isLogo =
        mode === 'sat' ? sat > MIN_SAT
          : mode === 'both' ? (sat > MIN_SAT || max > MIN_VAL)
            : max < MAX_DARK;
      if (isLogo) {
        grid[Math.floor(y / CELL) * gridCols + Math.floor(x / CELL)] += 1;
        hits += 1;
      }
    }
  }
  if (hits < 120) return null;

  // Una celda cuenta solo si está MAYORITARIAMENTE cubierta (>=8 de 16 píxeles).
  // Esto funciona como una erosión: el texto del panel tiene trazos finos que no
  // llenan una celda y desaparecen, mientras el logo es una masa gruesa que
  // sobrevive. Con un umbral bajo (3/16) el texto contaminaba la caja.
  const cellOn = (cx, cy) => grid[cy * gridCols + cx] >= 8;

  const colHits = new Uint32Array(gridCols);
  const rowHits = new Uint32Array(gridRows);
  for (let cy = 0; cy < gridRows; cy += 1) {
    for (let cx = 0; cx < gridCols; cx += 1) {
      if (cellOn(cx, cy)) {
        colHits[cx] += 1;
        rowHits[cy] += 1;
      }
    }
  }

  /** Rango [inicio, fin] que contiene el 92% central de las muestras. */
  const coreRange = (hist, from, to) => {
    const total = hist.reduce((s, v) => s + v, 0);
    if (total === 0) return null;
    const lowThreshold = total * 0.04;
    const highThreshold = total * 0.96;
    let acc = 0;
    let start = from;
    let end = to - 1;
    for (let i = from; i < to; i += 1) {
      acc += hist[i];
      if (acc >= lowThreshold) {
        start = i;
        break;
      }
    }
    acc = 0;
    for (let i = to - 1; i >= from; i -= 1) {
      acc += hist[i];
      if (acc >= total - highThreshold) {
        end = i;
        break;
      }
    }
    return end > start ? [start, end] : null;
  };

  const colsRange = coreRange(colHits, Math.floor(x0 / CELL), Math.floor(x1 / CELL));
  if (!colsRange) return null;
  const cols = [colsRange[0] * CELL, Math.min(width - 1, colsRange[1] * CELL + CELL - 1)];

  // --- Corte vertical por DENSIDAD (en celdas) --------------------------------
  // El logo es la masa más densa de la banda; el panel de historia tiene filas
  // mucho menos pobladas. Se toma el pico y se corta donde la densidad cae por
  // debajo de la mitad del pico de forma sostenida: así el panel no se arrastra
  // aunque tenga algunas filas cargadas.
  const cellY0 = Math.floor(y0 / CELL);
  const cellY1 = Math.floor(y1 / CELL);
  const rowsBand = Array.from({ length: cellY1 - cellY0 }, (_, i) => rowHits[cellY0 + i]);
  const peak = Math.max(...rowsBand);
  if (peak < 3) return null;

  let firstDense = -1;
  for (let i = 0; i < rowsBand.length; i += 1) {
    if (rowsBand[i] >= peak * 0.5) {
      firstDense = i;
      break;
    }
  }
  if (firstDense < 0) return null;

  // Fin: última fila que aún supera la mitad del pico, tolerando huecos cortos
  // (los logos caligráficos tienen valles internos).
  let lastDense = firstDense;
  let quiet = 0;
  const maxQuiet = 3;
  for (let i = firstDense; i < rowsBand.length; i += 1) {
    if (rowsBand[i] >= peak * 0.5) {
      lastDense = i;
      quiet = 0;
    } else {
      quiet += 1;
      if (quiet > maxQuiet) break;
    }
  }

  const rows = [Math.max(0, (cellY0 + firstDense) * CELL), Math.min(height - 1, (cellY0 + lastDense) * CELL + CELL - 1)];
  if (rows[1] <= rows[0]) return null;

  const box = {
    left: cols[0],
    top: rows[0],
    width: cols[1] - cols[0] + 1,
    height: rows[1] - rows[0] + 1,
  };
  // El badge NO se recorta aquí: algunos logos llegan hasta esa zona y se
  // cortarían. Se borra después, píxel a píxel, solo en la esquina superior
  // derecha del recorte (ver extractLogoFromCard).
  // Descarta cajas degeneradas (una línea, o que cubran toda la banda).
  if (box.width < 30 || box.height < 24) return null;
  if (box.width > width * 0.85 && box.height > height * 0.5) return null;
  return { box, hits, columnas: cols, filas: rows, peak };
}

/** Extrae el logo de una carta. Devuelve {buffer, box, meta} o null. */
export async function extractLogoFromCard(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // Detección por BORDES: medida contra las 211 cartas con logo conocido da
  // recall 0.87 / precisión 0.67, el mejor resultado de los enfoques probados
  // (densidad 0.90/0.35, diversidad de color 0.67/0.61). El logo tiene
  // estructura; el fondo del panel de historia es plano, así que no entra.
  const edge = findLogoBoxEdges(data, info.width, info.height, info.channels, EDGE_OPTIONS);
  // Respaldo: el detector por densidad, para cartas con logos muy lisos.
  const found = edge ? { box: edge.box } : findLogoBoxInBand(data, info.width, info.height, info.channels);
  if (!found) return null;

  const pad = 4;
  const crop = {
    left: Math.max(0, found.box.left - pad),
    top: Math.max(0, found.box.top - pad),
    width: Math.min(info.width - Math.max(0, found.box.left - pad), found.box.width + pad * 2),
    height: Math.min(info.height - Math.max(0, found.box.top - pad), found.box.height + pad * 2),
  };

  // Se extrae y se BORRA el badge del número (esquina superior derecha), que no
  // forma parte del logo. Se hace con transparencia para no cortar el arte.
  const raw = await sharp(file).extract(crop).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.from(raw.data);
  const { width, height, channels } = raw.info;
  const badgeX = Math.floor(width * 0.72);
  const badgeY = Math.floor(height * 0.34);
  for (let y = 0; y < Math.min(badgeY, height); y += 1) {
    for (let x = badgeX; x < width; x += 1) {
      out[(y * width + x) * channels + 3] = 0;
    }
  }
  const buffer = await sharp(out, { raw: { width, height, channels } }).png().toBuffer();
  return { buffer, box: crop, meta: found };
}

async function main() {
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  // Solo cartas que aún no tienen logo (las 574 sin ficha de detalle).
  const missing = dataset.vtubers.filter((v) => v.assets?.card && !fs.existsSync(path.join(LOGOS, `${v.slug}.webp`)));
  let targets = missing;
  if (SAMPLE > 0) {
    const step = Math.max(1, Math.floor(missing.length / SAMPLE));
    targets = missing.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  }
  console.log(`[logo2] cartas sin logo: ${missing.length} | procesando ${targets.length}`);

  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const card = targets[cursor++];
      const file = path.join(ROOT, 'data', card.assets.card);
      try {
        const found = await extractLogoFromCard(file);
        if (!found) {
          results.push({ slug: card.slug, dexNumber: card.dexNumber, status: 'no-detectado' });
          continue;
        }
        await sharp(found.buffer).webp({ quality: 92, alphaQuality: 95 }).toFile(path.join(LOGOS, `${card.slug}.webp`));
        results.push({
          slug: card.slug,
          dexNumber: card.dexNumber,
          status: 'extraido',
          box: found.box,
          width: found.box.width,
          height: found.box.height,
          aspect: Number((found.box.width / found.box.height).toFixed(2)),
        });
      } catch (error) {
        results.push({ slug: card.slug, dexNumber: card.dexNumber, status: 'error', detail: String(error).slice(0, 100) });
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const byStatus = results.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
  const ok = results.filter((r) => r.status === 'extraido');
  fs.writeFileSync(
    REPORT,
    JSON.stringify({ generatedAt: new Date().toISOString(), band: BAND, resumen: { total: results.length, ...byStatus }, results }, null, 1),
  );
  console.log(`[logo2] ${JSON.stringify(byStatus)}`);
  if (ok.length) {
    const w = ok.map((r) => r.width).sort((a, b) => a - b);
    const h = ok.map((r) => r.height).sort((a, b) => a - b);
    console.log(`[logo2] ancho mediano ${w[Math.floor(w.length / 2)]} | alto mediano ${h[Math.floor(h.length / 2)]}`);
  }
  console.log('[logo2] informe: out/logo-extraction2.json');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[logo2] ERROR', error);
    process.exit(1);
  });
}
