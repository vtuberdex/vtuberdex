/**
 * Compara la calidad de OCR entre la carta reducida (720px, la que usa la app)
 * y el original del sitio (~1920px). Sirve para decidir a qué resolución hay que
 * leer el texto impreso en la imagen.
 */
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { fetchBinary } from './http.mjs';

const CASES = [
  { slug: 'crimson-kalo', src: 'fichas/vtuber4.jpg' },
  { slug: 'esferita', src: 'fichas/vtuber174.jpg' },
  { slug: 'tsuki-akerman', src: 'fichas/vtuber33.jpg' },
];

function textBox(width, height) {
  return {
    left: Math.round(width * 0.46),
    top: Math.round(height * 0.55),
    width: Math.round(width * 0.53),
    height: Math.round(height * 0.42),
  };
}

async function ocr(worker, input, label) {
  const meta = await sharp(input).metadata();
  const box = textBox(meta.width, meta.height);
  const buf = await sharp(input)
    .extract(box)
    .resize({ width: Math.min(box.width * 2, 2400), kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .png()
    .toBuffer();
  const { data } = await worker.recognize(buf);
  const text = data.text.replace(/\s+/g, ' ').trim();
  console.log(`  [${label}] ${meta.width}x${meta.height} -> conf ${Math.round(data.confidence)}`);
  console.log(`     ${text.slice(0, 240)}`);
  return { text, confidence: data.confidence };
}

const worker = await createWorker('spa');
for (const { slug, src } of CASES) {
  console.log('='.repeat(74));
  console.log(slug);
  const original = await fetchBinary(src);
  if (!original) {
    console.log('  no se pudo bajar', src);
    continue;
  }
  await sharp(original).toFile(`/tmp/full-${slug}.jpg`);
  const a = await ocr(worker, `../data/images/card/${slug}.webp`, 'carta 720px');
  const b = await ocr(worker, `/tmp/full-${slug}.jpg`, 'original  ');
  console.log(`  -> mejora de confianza: ${Math.round(b.confidence - a.confidence)} puntos`);
}
await worker.terminate();
