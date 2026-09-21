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

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

import { findLogoBox } from './logo-edges.mjs';
import { findLogoBoxInBand } from './extract-logo2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const GT = path.join(HERE, '..', 'out', 'logo-calibration.json');
const EDGE_OPTIONS = { edgeMin: 60, cellMinEdge: 3, minCells: 20, ratio: 0.45 };

/** Un score de template matching alto indica que la pareja no es fiable. */
const MAX_SCORE = 60;

const asJson = process.argv.includes('--json');

function intersection(a, b) {
  const ix = Math.max(0, Math.min(a.left + a.width, b.x + b.width) - Math.max(a.left, b.x));
  const iy = Math.max(0, Math.min(a.top + a.height, b.y + b.height) - Math.max(a.top, b.y));
  return ix * iy;
}

async function main() {
  const gt = JSON.parse(fs.readFileSync(GT, 'utf8'));
  const pairs = gt.results.filter((r) => r.found && r.found.score < MAX_SCORE);

  const det = { recall: [], prec: [], nulos: 0, buenos: 0 };
  const den = { recall: [], prec: [], nulos: 0, buenos: 0 };
  const fallos = [];
  let evaluadas = 0;

  for (const r of pairs) {
    const p = path.join(ROOT, 'data', 'images', 'card', `${r.slug}.webp`);
    if (!fs.existsSync(p)) continue;
    const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const g = r.found;
    const gArea = g.width * g.height;
    evaluadas += 1;

    for (const [acc, box] of [
      [det, findLogoBox(data, info.width, info.height, info.channels, EDGE_OPTIONS)?.box],
      [den, findLogoBoxInBand(data, info.width, info.height, info.channels)?.box],
    ]) {
      if (!box) {
        acc.nulos += 1;
        continue;
      }
      const inter = intersection(box, g);
      const rec = inter / gArea;
      const pre = inter / (box.width * box.height);
      acc.recall.push(rec);
      acc.prec.push(pre);
      if (rec > 0.85 && pre > 0.7) acc.buenos += 1;
    }

    const boxDet = findLogoBox(data, info.width, info.height, info.channels, EDGE_OPTIONS)?.box;
    if (boxDet) {
      const rec = intersection(boxDet, g) / gArea;
      const pre = intersection(boxDet, g) / (boxDet.width * boxDet.height);
      if (rec <= 0.85 || pre <= 0.7) fallos.push(`${r.slug}:r${rec.toFixed(2)}/p${pre.toFixed(2)}`);
    }
  }

  const media = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
  const report = {
    paresGroundTruth: pairs.length,
    evaluadas,
    bordes: {
      recallMedio: Number(media(det.recall).toFixed(3)),
      precisionMedia: Number(media(det.prec).toFixed(3)),
      ajusteFino: `${det.buenos}/${evaluadas}`,
      pctAjusteFino: Number(((det.buenos / evaluadas) * 100).toFixed(1)),
      nulos: det.nulos,
    },
    densidad: {
      recallMedio: Number(media(den.recall).toFixed(3)),
      precisionMedia: Number(media(den.prec).toFixed(3)),
      ajusteFino: `${den.buenos}/${evaluadas}`,
      pctAjusteFino: Number(((den.buenos / evaluadas) * 100).toFixed(1)),
      nulos: den.nulos,
    },
  };

  if (asJson) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    console.log(`pares de ground truth: ${pairs.length} | evaluadas: ${evaluadas}`);
    console.log('\nbordes (detector actual):');
    console.log(`  recall medio    ${report.bordes.recallMedio}`);
    console.log(`  precision media ${report.bordes.precisionMedia}`);
    console.log(`  ajuste fino     ${report.bordes.ajusteFino} (${report.bordes.pctAjusteFino}%)`);
    console.log(`  nulos           ${report.bordes.nulos}`);
    console.log('\ndensidad (detector anterior):');
    console.log(`  recall medio    ${report.densidad.recallMedio}`);
    console.log(`  precision media ${report.densidad.precisionMedia}`);
    console.log(`  ajuste fino     ${report.densidad.ajusteFino} (${report.densidad.pctAjusteFino}%)`);
    if (fallos.length) {
      console.log(`\npeores casos de bordes (${fallos.length}):`);
      console.log('  ' + fallos.slice(0, 12).join(' | '));
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[eval] ERROR', error);
    process.exit(1);
  });
}
