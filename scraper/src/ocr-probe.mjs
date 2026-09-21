/**
 * Prueba de OCR del texto personalizado que viene "cocido" en la imagen de la
 * carta (recuadro oscuro inferior derecho). Mide aciertos sobre cartas conocidas
 * antes de aplicarlo a las 574 sin ficha de detalle.
 */
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

const CASES = [
  ['crimson-kalo', 'payasita'],
  ['ex-porygon-z-explicador-de-vtubers', 'Porygon'],
  ['tsuki-akerman', null],
  ['esferita', null],
];

/** Recorte del recuadro de texto: mitad inferior derecha del arte. */
function textBox(width, height) {
  return {
    left: Math.round(width * 0.46),
    top: Math.round(height * 0.55),
    width: Math.round(width * 0.53),
    height: Math.round(height * 0.42),
  };
}

/** Preprocesado: escala y contraste ayudan mucho con texto claro sobre oscuro. */
async function prepare(file) {
  const meta = await sharp(file).metadata();
  const box = textBox(meta.width, meta.height);
  return sharp(file)
    .extract(box)
    .resize({ width: box.width * 3, kernel: 'lanczos3' })
    .grayscale()
    .normalize()
    .sharpen()
    .png()
    .toBuffer();
}

const worker = await createWorker('spa');
const results = [];

for (const [slug, expected] of CASES) {
  const buf = await prepare(`../data/images/card/${slug}.webp`);
  const { data } = await worker.recognize(buf);
  const text = data.text.replace(/\s+/g, ' ').trim();
  results.push({ slug, text, confidence: Math.round(data.confidence) });
  console.log('='.repeat(72));
  console.log(slug.padEnd(38), 'conf:', Math.round(data.confidence));
  console.log('  >', text.slice(0, 300));
  if (expected) {
    console.log('  ¿contiene "' + expected + '"?', text.toLowerCase().includes(expected.toLowerCase()) ? 'SÍ' : 'NO');
  }
}

await worker.terminate();
const avg = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
console.log('\nconfianza media:', Math.round(avg));
console.log('vacías:', results.filter((r) => r.text.length < 10).length, 'de', results.length);
