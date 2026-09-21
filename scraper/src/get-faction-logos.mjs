/**
 * Descarga los logos de FACCIÓN que el sitio sirve en `facciones/<Nombre>.png`.
 *
 * Los nombres de archivo son irregulares (incluyen números de variante, tildes a
 * veces ausentes) y no siempre coinciden con el `alt`, así que no se adivinan: se
 * recogen de las páginas de detalle en caché, que es donde el sitio los enlaza.
 *
 * Nota: el sitio responde a CUALQUIER ruta desconocida con el index (soft-404),
 * así que se descarta la respuesta comparando su tamaño con el del index.
 */

import fs from 'node:fs';
import { promises as fsP } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as cheerio from 'cheerio';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const CACHE = path.join(HERE, '..', 'cache', 'detail');
const OUTDIR = path.join(ROOT, 'data', 'images', 'faction');
const REPORT = path.join(HERE, '..', 'out', 'faction-logos.json');
const BASE = 'https://vtuberdex.com/';

/** Tamaño del index: cualquier respuesta de ese tamaño es un soft-404. */
let indexSize = 0;

/** Nombres de archivo de facción referenciados en el HTML cacheado. */
export function collectFactionFiles(cacheDir = CACHE) {
  const files = new Set();
  for (const f of fs.readdirSync(cacheDir)) {
    if (!f.endsWith('.html')) continue;
    const $ = cheerio.load(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
    $('img').each((_, el) => {
      const src = $(el).attr('src') ?? '';
      if (!src.includes('facciones/')) return;
      const name = src.split('facciones/')[1];
      if (name) files.add(name);
    });
  }
  return [...files];
}

async function main() {
  await fsP.mkdir(OUTDIR, { recursive: true });
  const res = await fetch(BASE);
  indexSize = (await res.arrayBuffer()).byteLength;
  console.log(`[faction] index de referencia: ${indexSize} bytes`);

  const files = collectFactionFiles().filter((f) => !/\.html$/i.test(f));
  const results = [];
  let ok = 0;

  for (const file of files) {
    const url = `${BASE}facciones/${file}`;
    try {
      const r = await fetch(url);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf.byteLength === indexSize) {
        results.push({ file, status: 'soft-404', bytes: buf.byteLength });
        continue;
      }
      // Se normaliza a PNG con alfa (algunos vienen sin transparencia útil).
      const meta = await sharp(buf).metadata();
      const slug = path.basename(decodeURIComponent(file), path.extname(file))
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      const target = path.join(OUTDIR, `${slug}.png`);
      await sharp(buf).png().toFile(target);
      results.push({ file, slug, status: 'ok', width: meta.width, height: meta.height, bytes: buf.byteLength });
      ok += 1;
    } catch (error) {
      results.push({ file, status: 'error', detail: String(error.message).slice(0, 100) });
    }
  }

  const resumen = { referenciados: files.length, descargados: ok };
  fs.writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), resumen, results }, null, 1));
  console.log(`[faction] ${JSON.stringify(resumen)}`);
  console.log('[faction] informe: out/faction-logos.json');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[faction] ERROR', error);
    process.exit(1);
  });
}
