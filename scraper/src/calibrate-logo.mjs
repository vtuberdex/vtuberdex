/**
 * Calibración: usa las 154 cartas cuyo logo YA conocemos (vienen de `logos/` en
 * el sitio) para descubrir DÓNDE está el logo dentro de la carta y A QUÉ ESCALA.
 *
 * Eso da ground truth para extraer el logo de las 574 que no lo tienen, en vez
 * de adivinar umbrales a ciegas.
 *
 * Método: el logo del sitio trae alfa, así que se compara solo sobre sus píxeles
 * opacos. Se prueban varias escalas y se elige la posición de menor diferencia
 * media (SAD normalizada) en la zona superior de la carta.
 *
 * Uso: node src/calibrate-logo.mjs [--limit 40]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CARDS = path.join(ROOT, 'data', 'images', 'card');
const LOGOS = path.join(ROOT, 'data', 'images', 'logo');
const DATASET = path.join(HERE, '..', 'out', 'dataset.json');
const REPORT = path.join(HERE, '..', 'out', 'logo-calibration.json');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const LIMIT = Number(value('limit', '0')) || Infinity;

/** Luminancia en gris desde un buffer RGBA. */
function toGray(data, width, height, channels) {
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += channels, p += 1) {
    gray[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return gray;
}

/**
 * Busca el logo dentro de la carta por SAD sobre los píxeles opacos del logo.
 * @returns {{x:number,y:number,scale:number,score:number}|null}
 */
export function locateLogo(cardGray, cardW, cardH, logoGray, logoW, logoH, logoAlpha, scales, searchTop = 0.62, step = 2) {
  let best = null;
  const yLimit = Math.floor(cardH * searchTop);

  for (const scale of scales) {
    const sw = Math.round(logoW * scale);
    const sh = Math.round(logoH * scale);
    if (sw < 24 || sh < 24 || sw > cardW || sh > yLimit) continue;

    for (let y = 0; y + sh <= yLimit; y += step) {
      for (let x = 0; x + sw <= cardW; x += step) {
        let sum = 0;
        let count = 0;
        // Muestreo del logo (cada 2 px) para que sea rápido.
        for (let ly = 0; ly < sh; ly += 2) {
          const sy = Math.min(logoH - 1, Math.floor(ly / scale));
          for (let lx = 0; lx < sw; lx += 2) {
            const sx = Math.min(logoW - 1, Math.floor(lx / scale));
            const a = logoAlpha[sy * logoW + sx];
            if (a < 160) continue; // solo píxeles sólidos del logo
            const cardPixel = cardGray[(y + ly) * cardW + (x + lx)];
            const logoPixel = logoGray[sy * logoW + sx];
            sum += Math.abs(cardPixel - logoPixel);
            count += 1;
          }
        }
        if (count < 40) continue;
        const score = sum / count;
        if (!best || score < best.score) {
          best = { x, y, width: sw, height: sh, scale, score: Number(score.toFixed(2)), samples: count };
        }
      }
    }
  }
  return best;
}

async function main() {
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  const pairs = dataset.vtubers
    .filter((v) => v.detail?.logo && v.assets?.logo && v.assets?.card)
    .filter((v) => fs.existsSync(path.join(ROOT, 'data', v.assets.card)) && fs.existsSync(path.join(ROOT, 'data', v.assets.logo)))
    .slice(0, LIMIT);

  console.log(`[calib] parejas carta+logo disponibles: ${pairs.length}`);
  const results = [];

  for (const card of pairs) {
    try {
      const cardRaw = await sharp(path.join(ROOT, 'data', card.assets.card)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const logoRaw = await sharp(path.join(ROOT, 'data', card.assets.logo)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const cardGray = toGray(cardRaw.data, cardRaw.info.width, cardRaw.info.height, cardRaw.info.channels);
      const logoGray = toGray(logoRaw.data, logoRaw.info.width, logoRaw.info.height, logoRaw.info.channels);
      const alpha = new Uint8Array(logoRaw.info.width * logoRaw.info.height);
      for (let p = 0, i = 3; p < alpha.length; p += 1, i += logoRaw.info.channels) alpha[p] = logoRaw.data[i];

      // Escalas: el logo del sitio se guardó a 900px de ancho como máximo, pero la
      // carta es 720: hay que probar desde bastante reducido hasta casi completo.
      const scales = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2];
      const found = locateLogo(cardGray, cardRaw.info.width, cardRaw.info.height, logoGray, logoRaw.info.width, logoRaw.info.height, alpha, scales);
      results.push({
        slug: card.slug,
        name: card.name,
        card: { width: cardRaw.info.width, height: cardRaw.info.height },
        logo: { width: logoRaw.info.width, height: logoRaw.info.height },
        found,
      });
      if (found) {
        console.log(
          `  ${card.slug.padEnd(26)} score ${String(found.score).padStart(6)} escala ${found.scale} en (${found.x},${found.y}) ${found.width}x${found.height}`,
        );
      } else {
        console.log(`  ${card.slug.padEnd(26)} NO ENCONTRADO`);
      }
    } catch (error) {
      // Un asset ausente no debe abortar la calibración completa (antes un solo
      // archivo borrado tumbaba el run entero y devolvía un ground truth parcial).
      console.warn(`  ${card.slug.padEnd(26)} OMITIDO (${String(error.message).slice(0, 60)})`);
    }
  }

  const ok = results.filter((r) => r.found);
  const scores = ok.map((r) => r.found.score).sort((a, b) => a - b);
  const scales = ok.map((r) => r.found.scale).sort((a, b) => a - b);
  const resumen = {
    parejas: results.length,
    localizados: ok.length,
    scoreMediana: scores.length ? scores[Math.floor(scores.length / 2)] : null,
    escalaMediana: scales.length ? scales[Math.floor(scales.length / 2)] : null,
    escalaMin: scales[0] ?? null,
    escalaMax: scales[scales.length - 1] ?? null,
  };
  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), resumen, results }, null, 1));
  console.log(`\n[calib] ${JSON.stringify(resumen)}`);
  console.log(`[calib] informe: out/logo-calibration.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[calib] ERROR', error);
    process.exit(1);
  });
}
