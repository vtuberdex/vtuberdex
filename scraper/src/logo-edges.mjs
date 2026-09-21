/**
 * Localiza el logo dentro de la carta por BORDES (gradiente) + componentes conexos.
 *
 * Historial de intentos y por qué se llegó aquí (medido contra las 211 cartas
 * cuyo logo conocemos, con intersección sobre el área real):
 *   - Densidad de saturación por filas: recall 0.90 pero precisión 0.35. El
 *     fondo del panel de historia es de color, así que también está "saturado"
 *     y la caja se estiraba hasta abarcarlo entero.
 *   - Diversidad de color: precisión 0.61 pero recall 0.67. Funciona con logos
 *     multicolor, pero descarta los logos monocromos (blancos).
 *   - Bordes: el logo tiene estructura (bordes fuertes y conectados) mientras el
 *     fondo del panel es plano, sin gradiente. Además funciona igual con logos
 *     monocromos, porque un logo blanco sobre fondo oscuro también tiene bordes.
 *
 * El texto del panel sí tiene bordes, pero son glifos finos y sueltos: forman
 * muchos componentes pequeños, así que quedarse con la componente mayor los deja
 * fuera sin necesidad de umbrales de color.
 */

import { BAND, BADGE } from './logo-bands.mjs';

/** Celdas de NxN px como unidad de agregación. */
const CELL = 4;

/**
 * Rejilla de celdas "con estructura": una celda cuenta si contiene suficientes
 * píxeles con gradiente fuerte.
 * @returns {{on: Uint8Array, cols:number, rows:number, x0:number, y0:number}}
 */
export function buildEdgeGrid(data, width, height, channels, options = {}) {
  const band = options.band ?? BAND;
  const badge = options.badge ?? BADGE;
  const edgeMin = options.edgeMin ?? 90;
  const cellMinEdge = options.cellMinEdge ?? 5;

  const x0 = Math.floor(width * band.x0);
  const y0 = Math.floor(height * band.y0);
  const x1 = Math.floor(width * band.x1);
  const y1 = Math.floor(height * band.y1);
  const bx0 = Math.floor(width * badge.x0);
  const bx1 = Math.floor(width * badge.x1);
  const by0 = Math.floor(height * badge.y0);
  const by1 = Math.floor(height * badge.y1);

  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const counts = new Uint16Array(cols * rows);
  const satCounts = new Uint16Array(cols * rows);
  const on = new Uint8Array(cols * rows);
  const minSat = options.minSat ?? 45;
  const cellMinSat = options.cellMinSat ?? 6;

  // Gradiente por diferencias entre píxeles contiguos (sin dependencias).
  for (let y = Math.max(1, y0); y < y1 - 1; y += 1) {
    for (let x = Math.max(1, x0); x < x1 - 1; x += 1) {
      if (x >= bx0 && x < bx1 && y >= by0 && y < by1) continue;
      const i = (y * width + x) * channels;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const cell = Math.floor(y / CELL) * cols + Math.floor(x / CELL);
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max !== 0 && ((max - min) / max) * 255 > minSat) satCounts[cell] += 1;
      // Vecino derecho, abajo y diagonal: suma de diferencias absolutas.
      const ir = i + channels;
      const ib = i + width * channels;
      const d = Math.abs(r - data[ir]) + Math.abs(g - data[ir + 1]) + Math.abs(b - data[ir + 2])
        + Math.abs(r - data[ib]) + Math.abs(g - data[ib + 1]) + Math.abs(b - data[ib + 2]);
      if (d > edgeMin) counts[cell] += 1;
    }
  }

  for (let i = 0; i < counts.length; i += 1) {
    // Con `requireSat` una celda debe tener además color: descarta el texto claro
    // del panel sobre fondo plano, que tiene bordes pero no saturación.
    const okEdge = counts[i] >= cellMinEdge;
    const okSat = !options.requireSat || satCounts[i] >= cellMinSat;
    if (okEdge && okSat) on[i] = 1;
  }
  return { on, cols, rows, x0, y0 };
}

/**
 * Caja del logo: la del mayor componente conexo (4-vecindad) de celdas con
 * estructura, fusionando los secundarios comparables.
 * @returns {{box:{left:number,top:number,width:number,height:number}, cells:number, blobs:number}|null}
 */
export function findLogoBox(data, width, height, channels, options = {}) {
  const { on, cols, rows } = buildEdgeGrid(data, width, height, channels, options);
  const minCells = options.minCells ?? 30;
  const ratio = options.ratio ?? 0.25;

  const labels = new Int32Array(cols * rows);
  const stats = [];
  let next = 0;

  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      const idx = cy * cols + cx;
      if (!on[idx]) continue;
      const up = cy > 0 ? labels[idx - cols] : 0;
      const left = cx > 0 ? labels[idx - 1] : 0;
      let label;
      if (up && left) {
        label = Math.min(up, left);
        const other = Math.max(up, left);
        if (other !== label) mergeLabels(stats, labels, label, other);
      } else {
        label = up || left;
      }
      if (!label) {
        next += 1;
        label = next;
        stats[label] = { size: 0, minX: cx, maxX: cx, minY: cy, maxY: cy };
      }
      labels[idx] = label;
      const st = stats[label];
      st.size += 1;
      if (cx < st.minX) st.minX = cx;
      if (cx > st.maxX) st.maxX = cx;
      if (cy < st.minY) st.minY = cy;
      if (cy > st.maxY) st.maxY = cy;
    }
  }

  const reales = stats
    .map((st, label) => (st ? { label, st } : null))
    .filter(Boolean)
    .sort((a, b) => b.st.size - a.st.size);
  if (!reales.length) return null;
  const mayor = reales[0];
  if (mayor.st.size < minCells) return null;

  let minX = mayor.st.minX;
  let maxX = mayor.st.maxX;
  let minY = mayor.st.minY;
  let maxY = mayor.st.maxY;
  let total = mayor.st.size;
  let blobs = 1;
  for (let i = 1; i < reales.length; i += 1) {
    if (reales[i].st.size < mayor.st.size * ratio) break;
    minX = Math.min(minX, reales[i].st.minX);
    maxX = Math.max(maxX, reales[i].st.maxX);
    minY = Math.min(minY, reales[i].st.minY);
    maxY = Math.max(maxY, reales[i].st.maxY);
    total += reales[i].st.size;
    blobs += 1;
  }

  const left = minX * CELL;
  const top = minY * CELL;
  const w = (maxX - minX + 1) * CELL;
  const h = (maxY - minY + 1) * CELL;
  if (w < 24 || h < 20) return null;
  if (w > width * (options.maxWidthRatio ?? 0.9) && h > height * 0.6) return null;

  return {
    box: {
      left: Math.max(0, left),
      top: Math.max(0, top),
      width: Math.min(width - left, w),
      height: Math.min(height - top, h),
    },
    cells: total,
    blobs,
  };
}

/** Une la etiqueta `other` dentro de `label` y reescribe sus apariciones. */
function mergeLabels(stats, labels, label, other) {
  const a = stats[other];
  const b = stats[label];
  if (!a || !b) return;
  b.size += a.size;
  b.minX = Math.min(b.minX, a.minX);
  b.maxX = Math.max(b.maxX, a.maxX);
  b.minY = Math.min(b.minY, a.minY);
  b.maxY = Math.max(b.maxY, a.maxY);
  stats[other] = null;
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === other) labels[i] = label;
  }
}
