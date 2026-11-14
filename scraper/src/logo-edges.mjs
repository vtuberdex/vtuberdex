// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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

import { BAND, BADGE } from "./logo-bands.mjs";

/** Celdas de NxN px como unidad de agregación. */
const CELL = 4;

/** ¿El píxel tiene color suficiente (saturación por encima de `minSat`)? */
function isSaturated(r, g, b, minSat) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max !== 0 && ((max - min) / max) * 255 > minSat;
}

/**
 * Gradiente del píxel `i`: suma de diferencias absolutas con el vecino derecho
 * y el de abajo (sin dependencias).
 */
function gradientAt(data, i, width, channels) {
  const ir = i + channels;
  const ib = i + width * channels;
  return (
    Math.abs(data[i] - data[ir]) +
    Math.abs(data[i + 1] - data[ir + 1]) +
    Math.abs(data[i + 2] - data[ir + 2]) +
    Math.abs(data[i] - data[ib]) +
    Math.abs(data[i + 1] - data[ib + 1]) +
    Math.abs(data[i + 2] - data[ib + 2])
  );
}

/** Rectángulo en píxeles de una zona expresada en fracciones del lienzo. */
function zoneInPixels(zone, width, height) {
  return {
    x0: Math.floor(width * zone.x0),
    y0: Math.floor(height * zone.y0),
    x1: Math.floor(width * zone.x1),
    y1: Math.floor(height * zone.y1),
  };
}

/**
 * Cuenta, por celda, los píxeles con borde fuerte y los saturados dentro de la
 * banda (fuera del badge del número).
 */
function countEdges(data, width, channels, grid, area, badgePx, thresholds) {
  const image = { data, width, channels };
  for (let y = Math.max(1, area.y0); y < area.y1 - 1; y += 1) {
    const inBadgeRows = y >= badgePx.y0 && y < badgePx.y1;
    countRow(image, grid, y, area, inBadgeRows ? badgePx : null, thresholds);
  }
}

/**
 * Una fila de la banda. `badge` es la caja del número solo si la fila la cruza (`null` si no): sus
 * columnas se saltan.
 */
function countRow(image, grid, y, area, badge, thresholds) {
  for (let x = Math.max(1, area.x0); x < area.x1 - 1; x += 1) {
    const inBadge = badge !== null && x >= badge.x0 && x < badge.x1;
    if (!inBadge) {
      countPixel(image, grid, x, y, thresholds);
    }
  }
}

/** Suma el píxel (x, y) a los contadores de su celda: saturado y/o con borde fuerte. */
function countPixel({ data, width, channels }, grid, x, y, thresholds) {
  const i = (y * width + x) * channels;
  const cell = Math.floor(y / CELL) * grid.cols + Math.floor(x / CELL);
  if (isSaturated(data[i], data[i + 1], data[i + 2], thresholds.minSat)) {
    grid.satCounts[cell] += 1;
  }
  if (gradientAt(data, i, width, channels) > thresholds.edgeMin) {
    grid.counts[cell] += 1;
  }
}

/**
 * Rejilla de celdas "con estructura": una celda cuenta si contiene suficientes
 * píxeles con gradiente fuerte.
 * @returns {{on: Uint8Array, cols:number, rows:number, x0:number, y0:number}}
 */
export function buildEdgeGrid(data, width, height, channels, options = {}) {
  const area = zoneInPixels(options.band ?? BAND, width, height);
  const badgePx = zoneInPixels(options.badge ?? BADGE, width, height);

  const cols = Math.ceil(width / CELL);
  const rows = Math.ceil(height / CELL);
  const grid = {
    counts: new Uint16Array(cols * rows),
    satCounts: new Uint16Array(cols * rows),
    cols,
  };

  countEdges(data, width, channels, grid, area, badgePx, {
    edgeMin: options.edgeMin ?? 90,
    minSat: options.minSat ?? 45,
  });

  const on = cellsOn(grid, {
    cellMinEdge: options.cellMinEdge ?? 5,
    cellMinSat: options.cellMinSat ?? 6,
    requireSat: Boolean(options.requireSat),
  });
  return { on, cols, rows, x0: area.x0, y0: area.y0 };
}

/**
 * Celdas encendidas: bastantes píxeles con borde y, con `requireSat`, además color: descarta el
 * texto claro del panel sobre fondo plano, que tiene bordes pero no saturación.
 */
function cellsOn(grid, { cellMinEdge, cellMinSat, requireSat }) {
  const on = new Uint8Array(grid.counts.length);
  for (const [i, count] of grid.counts.entries()) {
    const okEdge = count >= cellMinEdge;
    const okSat = !requireSat || grid.satCounts[i] >= cellMinSat;
    if (okEdge && okSat) {
      on[i] = 1;
    }
  }
  return on;
}

/** Amplía la caja de un componente para incluir la celda (cx, cy). */
function growStats(st, cx, cy) {
  st.size += 1;
  st.minX = Math.min(st.minX, cx);
  st.maxX = Math.max(st.maxX, cx);
  st.minY = Math.min(st.minY, cy);
  st.maxY = Math.max(st.maxY, cy);
}

/**
 * Etiqueta de la celda a partir de sus vecinas de arriba e izquierda; si las
 * dos tienen etiqueta distinta, se funden en la menor.
 */
function labelFromNeighbours(stats, labels, labelUp, labelLeft) {
  if (!labelUp || !labelLeft) {
    return labelUp || labelLeft;
  }
  const label = Math.min(labelUp, labelLeft);
  const other = Math.max(labelUp, labelLeft);
  if (other !== label) {
    mergeLabels(stats, labels, label, other);
  }
  return label;
}

/** Componentes conexos (4-vecindad) de las celdas encendidas, con su caja. */
function labelComponents(on, cols, rows) {
  const state = { labels: new Int32Array(cols * rows), stats: [], next: 0, cols };
  for (let cy = 0; cy < rows; cy += 1) {
    for (let cx = 0; cx < cols; cx += 1) {
      if (on[cy * cols + cx]) {
        labelCell(state, cx, cy);
      }
    }
  }
  return state.stats;
}

/**
 * Etiqueta una celda encendida: hereda la de sus vecinas (fundiéndolas si difieren) o abre un
 * componente nuevo, y amplía la caja de ese componente.
 */
function labelCell(state, cx, cy) {
  const { labels, stats, cols } = state;
  const idx = cy * cols + cx;
  const labelUp = cy > 0 ? labels[idx - cols] : 0;
  const labelLeft = cx > 0 ? labels[idx - 1] : 0;
  let label = labelFromNeighbours(stats, labels, labelUp, labelLeft);
  if (!label) {
    state.next += 1;
    label = state.next;
    stats[label] = { size: 0, minX: cx, maxX: cx, minY: cy, maxY: cy };
  }
  labels[idx] = label;
  growStats(stats[label], cx, cy);
}

/** Caja del mayor componente fusionada con los secundarios comparables. */
function mergeComparable(reales, ratio) {
  const mayor = reales[0].st;
  const merged = { ...mayor, total: mayor.size, blobs: 1 };
  for (const { st } of reales.slice(1)) {
    if (st.size < mayor.size * ratio) {
      break;
    }
    merged.minX = Math.min(merged.minX, st.minX);
    merged.maxX = Math.max(merged.maxX, st.maxX);
    merged.minY = Math.min(merged.minY, st.minY);
    merged.maxY = Math.max(merged.maxY, st.maxY);
    merged.total += st.size;
    merged.blobs += 1;
  }
  return merged;
}

/**
 * Caja del logo: la del mayor componente conexo (4-vecindad) de celdas con
 * estructura, fusionando los secundarios comparables.
 * @returns {{box:{left:number,top:number,width:number,height:number}, cells:number, blobs:number}|null}
 */
export function findLogoBox(data, width, height, channels, options = {}) {
  const { on, cols, rows } = buildEdgeGrid(
    data,
    width,
    height,
    channels,
    options,
  );
  const minCells = options.minCells ?? 30;
  const ratio = options.ratio ?? 0.25;

  const reales = labelComponents(on, cols, rows)
    .map((st, label) => (st ? { label, st } : null))
    .filter(Boolean)
    .sort((a, b) => b.st.size - a.st.size);
  if (!reales.length || reales[0].st.size < minCells) {
    return null;
  }

  const { minX, maxX, minY, maxY, total, blobs } = mergeComparable(
    reales,
    ratio,
  );
  const left = minX * CELL;
  const top = minY * CELL;
  const w = (maxX - minX + 1) * CELL;
  const h = (maxY - minY + 1) * CELL;
  if (w < 24 || h < 20) {
    return null;
  }
  if (w > width * (options.maxWidthRatio ?? 0.9) && h > height * 0.6) {
    return null;
  }

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
  if (!a || !b) {
    return;
  }
  b.size += a.size;
  b.minX = Math.min(b.minX, a.minX);
  b.maxX = Math.max(b.maxX, a.maxX);
  b.minY = Math.min(b.minY, a.minY);
  b.maxY = Math.max(b.maxY, a.maxY);
  stats[other] = null;
  for (let i = 0; i < labels.length; i += 1) {
    if (labels[i] === other) {
      labels[i] = label;
    }
  }
}
