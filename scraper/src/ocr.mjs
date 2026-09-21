/**
 * Extrae el texto personalizado que viene IMPRESO en la imagen de cada carta.
 *
 * Descubrimiento: el párrafo que el VTuber escribe sobre sí mismo está "cocido"
 * dentro del arte (recuadro oscuro en la mitad inferior derecha), no en el HTML.
 * Las fichas con página de detalle además tienen una frase corta (`phrase`), pero
 * es OTRO campo: el párrafo de la imagen no aparece en el HTML.
 *
 * Calidad: leer el original a 1920px da ~90 de confianza frente a ~60 leyendo la
 * miniatura de 720px guardada en data/images/card (que está reducida para la app).
 * Por eso se baja el original del sitio, se lee y se descarta: solo se guarda el
 * texto, no el JPEG de ~250 KB.
 *
 * Uso:
 *   node src/ocr.mjs --sample 12        # validación contra frases conocidas
 *   node src/ocr.mjs                    # todas las cartas (reanudable)
 *   node src/ocr.mjs --limit 50
 * El resultado se acumula en out/ocr.json (se salta lo ya hecho).
 */
import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

import { fetchBinary, mapLimit } from './http.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'out');
const DATASET = path.join(OUT, 'dataset.json');
const RESULT = path.join(OUT, 'ocr.json');
const RAW_DIR = path.join(OUT, 'ocr-raw');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const SAMPLE = Number(value('sample', '0')) || 0;
const LIMIT = Number(value('limit', '0')) || Infinity;
const CONCURRENCY = Number(value('concurrency', '3'));
const LANGS = value('lang', 'spa');
const KEEP_RAW = flag('keep-raw');

/** Recuadro del texto en la carta (proporcional, layout consistente del origen). */
const BOX = { left: 0.46, top: 0.55, width: 0.53, height: 0.42 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normaliza para comparar (minúsculas, sin acentos ni puntuación). */
const normalize = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Solapamiento de palabras (Jaccard sobre conjuntos) para validar el OCR. */
export function wordOverlap(a, b) {
  const setA = new Set(normalize(a).split(' ').filter(Boolean));
  const setB = new Set(normalize(b).split(' ').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  let comunes = 0;
  for (const w of setA) if (setB.has(w)) comunes += 1;
  return comunes / Math.max(setA.size, setB.size);
}

/** Prepara el recuadro de texto del original para el OCR. */
async function cropForOcr(buffer) {
  const meta = await sharp(buffer).metadata();
  const box = {
    left: Math.round(meta.width * BOX.left),
    top: Math.round(meta.height * BOX.top),
    width: Math.round(meta.width * BOX.width),
    height: Math.round(meta.height * BOX.height),
  };
  // Se limita el ancho para no pasarse de resolución útil (OCR no mejora por
  // encima de ~2400px de ancho y sí encarece mucho el cómputo).
  const target = Math.min(box.width * 2, 2400);
  return {
    image: await sharp(buffer)
      .extract(box)
      .resize({ width: target, kernel: 'lanczos3' })
      .grayscale()
      .normalize()
      .sharpen({ sigma: 0.8 })
      .png()
      .toBuffer(),
    box,
    sourceWidth: meta.width,
  };
}

/** Un worker de tesseract con reintento: a veces falla al inicializar. */
async function makeWorker() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await createWorker(LANGS);
    } catch (error) {
      if (attempt === 3) throw error;
      await sleep(1500 * attempt);
    }
  }
  throw new Error('no se pudo crear el worker de OCR');
}

async function main() {
  if (!fs.existsSync(DATASET)) {
    console.error('✖ falta scraper/out/dataset.json; corre primero el scrape');
    process.exit(1);
  }
  const dataset = JSON.parse(fs.readFileSync(DATASET, 'utf8'));
  await mkdir(OUT, { recursive: true });
  if (KEEP_RAW) await mkdir(RAW_DIR, { recursive: true });

  // Reanudable: se conserva lo ya leído.
  const previous = fs.existsSync(RESULT) ? JSON.parse(fs.readFileSync(RESULT, 'utf8')) : { items: [] };
  const done = new Map(previous.items.map((item) => [item.dexNumber, item]));

  let targets = dataset.vtubers.filter((v) => v.source?.indexImage);
  if (SAMPLE > 0) {
    // Muestra estratificada: mezcla cartas con y sin ficha de detalle.
    const step = Math.max(1, Math.floor(targets.length / SAMPLE));
    targets = targets.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  }
  targets = targets.slice(0, LIMIT);

  const pending = targets.filter((v) => !done.has(v.dexNumber));
  console.log(`[ocr] ${targets.length} cartas objetivo, ${pending.length} por leer (${done.size} ya hechas)`);

  const workers = await Promise.all(Array.from({ length: CONCURRENCY }, makeWorker));
  let cursor = 0;
  let ok = 0;
  let empty = 0;
  const started = Date.now();

  const items = [...previous.items];
  let escritos = 0;
  /** Guarda el progreso: una corrida larga no debe perderse si se corta. */
  const flush = () => {
    const ordenado = [...items].sort((a, b) => a.dexNumber - b.dexNumber);
    fs.writeFileSync(
      RESULT,
      JSON.stringify({ generatedAt: new Date().toISOString(), langs: LANGS, box: BOX, items: ordenado }, null, 1),
    );
    return ordenado;
  };

  const results = await mapLimit(pending, CONCURRENCY, async (card) => {
    const worker = workers[cursor++ % workers.length];
    const src = card.source.indexImage;
    try {
      const original = await fetchBinary(src);
      if (!original) return { dexNumber: card.dexNumber, error: 'descarga-fallida', src };
      const { image, box } = await cropForOcr(original);
      const { data } = await worker.recognize(image);
      const text = data.text.replace(/\s+/g, ' ').trim();
      if (KEEP_RAW) {
        await writeFile(path.join(RAW_DIR, `${card.slug}.png`), image).catch(() => undefined);
        await writeFile(path.join(RAW_DIR, `${card.slug}.jpg`), original).catch(() => undefined);
      }
      if (text.length < 12) empty += 1;
      else ok += 1;
      const result = {
        dexNumber: card.dexNumber,
        slug: card.slug,
        name: card.name,
        src,
        text,
        confidence: Math.round(data.confidence),
        box,
        // La frase del HTML (si existe) va aparte: sirve para validar el OCR.
        htmlPhrase: card.detail?.phrase ?? null,
        overlap: card.detail?.phrase ? Number(wordOverlap(text, card.detail.phrase).toFixed(3)) : null,
      };
      items.push(result);
      escritos += 1;
      if (escritos % 25 === 0) {
        flush();
        console.log(`[ocr] guardado parcial: ${items.length} en total`);
      }
      return result;
    } catch (error) {
      return { dexNumber: card.dexNumber, slug: card.slug, src, error: String(error).slice(0, 160) };
    }
  });

  items.push(...results.filter((r) => r.error));
  flush();

  await Promise.all(workers.map((w) => w.terminate()));

  const errors = results.filter((r) => r.error).length;
  const confs = results.filter((r) => typeof r.confidence === 'number').map((r) => r.confidence);
  const avg = confs.length ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;

  console.log(`\n[ocr] leídas ${results.length} en ${((Date.now() - started) / 1000).toFixed(0)}s`);
  console.log(`[ocr] con texto: ${ok} | vacías: ${empty} | errores: ${errors}`);
  console.log(`[ocr] confianza media: ${avg}`);
  console.log(`[ocr] total acumulado en ${path.relative(process.cwd(), RESULT)}: ${items.length}`);

  // Validación: ¿el OCR reproduce la frase del HTML cuando la hay?
  const withPhrase = items.filter((i) => i.htmlPhrase && i.text);
  if (withPhrase.length > 0) {
    const overlaps = withPhrase.map((i) => i.overlap).filter((v) => typeof v === 'number');
    overlaps.sort((a, b) => a - b);
    const media = overlaps.reduce((a, b) => a + b, 0) / overlaps.length;
    console.log(`\n[ocr] validación contra la frase del HTML (${withPhrase.length} cartas que la tienen):`);
    console.log(`      solapamiento de palabras: p10=${overlaps[Math.floor(overlaps.length * 0.1)]} p50=${overlaps[Math.floor(overlaps.length * 0.5)]} media=${media.toFixed(2)}`);
    const bajas = withPhrase.filter((i) => (i.overlap ?? 0) < 0.3).slice(0, 4);
    if (bajas.length) {
      console.log('      ejemplos con solapamiento bajo (¿layout distinto?):');
      for (const b of bajas) {
        console.log(`        · ${b.name} [${b.overlap}]`);
        console.log(`            imagen: ${b.text.slice(0, 110)}`);
        console.log(`            html  : ${b.htmlPhrase.slice(0, 110)}`);
      }
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[ocr] ERROR', error);
    process.exit(1);
  });
}
