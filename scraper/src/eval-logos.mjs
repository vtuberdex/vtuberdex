// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Mide el detector de logos contra el GROUND TRUTH de calibración.
 *
 * Ground truth: `calibrate-logo.mjs` localiza el logo REAL (el que el sitio
 * sirve para las 211 fichas de detalle) dentro de su propia carta, por template
 * matching. Eso da la caja verdadera; aquí se compara la caja que produce el
 * detector contra ella con intersección sobre área (recall/precisión).
 *
 * Uso:
 *   node src/eval-logos.mjs            # informe por consola
 *   node src/eval-logos.mjs --json     # salida JSON
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

import { findLogoBox } from "./logo-edges.mjs";
import { findLogoBoxInBand } from "./extract-logo2.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const GT = path.join(HERE, "..", "out", "logo-calibration.json");
const EDGE_OPTIONS = { edgeMin: 60, cellMinEdge: 3, minCells: 20, ratio: 0.45 };

/** Un score de template matching alto indica que la pareja no es fiable. */
const MAX_SCORE = 60;

const asJson = process.argv.includes("--json");

function intersection(a, b) {
  const ix = Math.max(
    0,
    Math.min(a.left + a.width, b.x + b.width) - Math.max(a.left, b.x),
  );
  const iy = Math.max(
    0,
    Math.min(a.top + a.height, b.y + b.height) - Math.max(a.top, b.y),
  );
  return ix * iy;
}

/** Suma una caja detectada (o su ausencia) al acumulador de un detector. */
function acumular(acc, box, g, gArea) {
  if (!box) {
    acc.nulos += 1;
    return;
  }
  const inter = intersection(box, g);
  const rec = inter / gArea;
  const pre = inter / (box.width * box.height);
  acc.recall.push(rec);
  acc.prec.push(pre);
  if (rec > 0.85 && pre > 0.7) {
    acc.buenos += 1;
  }
}

/** Evalúa una carta con los dos detectores; devuelve el fallo de bordes, si lo hay. */
function evaluarCarta({ data, info }, g, det, den) {
  const gArea = g.width * g.height;
  acumular(
    det,
    findLogoBox(data, info.width, info.height, info.channels, EDGE_OPTIONS)
      ?.box,
    g,
    gArea,
  );
  acumular(
    den,
    findLogoBoxInBand(data, info.width, info.height, info.channels)?.box,
    g,
    gArea,
  );

  const boxDet = findLogoBox(
    data,
    info.width,
    info.height,
    info.channels,
    EDGE_OPTIONS,
  )?.box;
  if (!boxDet) {
    return null;
  }
  const rec = intersection(boxDet, g) / gArea;
  const pre = intersection(boxDet, g) / (boxDet.width * boxDet.height);
  return rec <= 0.85 || pre <= 0.7
    ? `r${rec.toFixed(2)}/p${pre.toFixed(2)}`
    : null;
}

function media(a) {
  return a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
}

function resumenDe(acc, evaluadas) {
  return {
    recallMedio: Number(media(acc.recall).toFixed(3)),
    precisionMedia: Number(media(acc.prec).toFixed(3)),
    ajusteFino: `${acc.buenos}/${evaluadas}`,
    pctAjusteFino: Number(((acc.buenos / evaluadas) * 100).toFixed(1)),
    nulos: acc.nulos,
  };
}

function imprimir(report, fallos) {
  console.log(
    `pares de ground truth: ${report.paresGroundTruth} | evaluadas: ${report.evaluadas}`,
  );
  console.log("\nbordes (detector actual):");
  console.log(`  recall medio    ${report.bordes.recallMedio}`);
  console.log(`  precision media ${report.bordes.precisionMedia}`);
  console.log(
    `  ajuste fino     ${report.bordes.ajusteFino} (${report.bordes.pctAjusteFino}%)`,
  );
  console.log(`  nulos           ${report.bordes.nulos}`);
  console.log("\ndensidad (detector anterior):");
  console.log(`  recall medio    ${report.densidad.recallMedio}`);
  console.log(`  precision media ${report.densidad.precisionMedia}`);
  console.log(
    `  ajuste fino     ${report.densidad.ajusteFino} (${report.densidad.pctAjusteFino}%)`,
  );
  if (fallos.length) {
    console.log(`\npeores casos de bordes (${fallos.length}):`);
    console.log("  " + fallos.slice(0, 12).join(" | "));
  }
}

async function main() {
  const gt = JSON.parse(fs.readFileSync(GT, "utf8"));
  const pairs = gt.results.filter((r) => r.found && r.found.score < MAX_SCORE);

  const det = { recall: [], prec: [], nulos: 0, buenos: 0 };
  const den = { recall: [], prec: [], nulos: 0, buenos: 0 };
  const fallos = [];
  let evaluadas = 0;

  for (const r of pairs) {
    const p = path.join(ROOT, "data", "images", "card", `${r.slug}.webp`);
    if (!fs.existsSync(p)) {
      continue;
    }
    const raw = await sharp(p)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    evaluadas += 1;
    const fallo = evaluarCarta(raw, r.found, det, den);
    if (fallo) {
      fallos.push(`${r.slug}:${fallo}`);
    }
  }

  const report = {
    paresGroundTruth: pairs.length,
    evaluadas,
    bordes: resumenDe(det, evaluadas),
    densidad: resumenDe(den, evaluadas),
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    imprimir(report, fallos);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await main();
  } catch (error) {
    console.error("[eval] ERROR", error);
    process.exit(1);
  }
}
