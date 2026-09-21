/**
 * Tests del parser del index y de las normalizaciones.
 * Se validan contra HTML representativo del sitio real (con sus rarezas).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseIndex } from '../src/parse-index.mjs';
import { parseCountries, languagesForCountries, parseDexNumber, slugify, normalizeText } from '../src/normalize.mjs';
import { buildFtsQueryEquivalent } from './helpers.mjs';

const INDEX_FIXTURE = `
<div class="card-container full-bleed">
  <div class="vtuber-card card0" data-pais="Colombia" data-group="" >
    <img src="fichas/vtuber0.jpg" alt="VTuber 0">
    <h2>EX: Porygon Z - Explicador de VTubers</h2>
  </div>
  <div class="vtuber-card card1" data-pais="México" data-group="" >
    <a href="YeicokpHarv.html">
      <img src="fichas/vtuber 1.jpg" alt="VTuber 1">
    </a>
    <h2>YEICOKP HARV</h2>
  </div>
  <div class="vtuber-card card16" data-pais="Chile" data-artist="PROJECT AR-AI.I, Rivery">
    <img src="fichas/vtuber16.jpg" alt="VTuber 16">
    <h2>madKoding</h2>
  </div>
  <div class="vtuber-card card31" data-pais="España, Canarias" data-group="Moonly, Celestials">
    <a href="vtubers/genuz.html"><img src="fichas/vtuber31.jpg" alt="VTuber 31"></a>
    <h2>Genu VT</h2>
  </div>
  <div class="vtuber-card card99" data-pais="Perú´">
    <img src="fichas/vtuber99.jpg" alt="VTuber 99">
    <h2>Arrocin</h2>
  </div>
</div>
`;

test('parseIndex extrae número, nombre, imagen y enlace de detalle', () => {
  const entries = parseIndex(INDEX_FIXTURE);
  assert.equal(entries.length, 5);

  const [first] = entries;
  assert.equal(first.dexNumber, 0);
  assert.equal(first.name, 'EX: Porygon Z - Explicador de VTubers');
  assert.equal(first.imageSrc, 'fichas/vtuber0.jpg');
  assert.equal(first.detailSlug, null);
  assert.deepEqual(first.countries, ['colombia']);

  const second = entries[1];
  assert.equal(second.detailSlug, 'YeicokpHarv');
  // La imagen con espacio conserva su nombre tal cual (se codifica al pedirla).
  assert.equal(second.imageSrc, 'fichas/vtuber 1.jpg');
});

test('parseIndex normaliza múltiples países, grupos y artistas', () => {
  const entries = parseIndex(INDEX_FIXTURE);
  const multi = entries.find((entry) => entry.dexNumber === 31);
  assert.deepEqual(multi.countries, ['espana', 'canarias']);
  assert.deepEqual(multi.groups, ['Moonly', 'Celestials']);
  assert.equal(multi.detailSlug, 'vtubers/genuz');

  const artist = entries.find((entry) => entry.dexNumber === 16);
  assert.deepEqual(artist.artists, ['PROJECT AR-AI.I', 'Rivery']);
});

test('parseCountries resuelve typos y variantes del sitio', () => {
  assert.deepEqual(parseCountries('Argetina'), ['argentina']);
  assert.deepEqual(parseCountries('Mexico'), ['mexico']);
  assert.deepEqual(parseCountries('Perú´'), ['peru']);
  assert.deepEqual(parseCountries('Paraguay,Corea Del Sur'), ['paraguay', 'corea-del-sur']);
  assert.deepEqual(parseCountries('Chile , Argentina'), ['chile', 'argentina']);
  assert.deepEqual(parseCountries('venezuela, argentina'), ['venezuela', 'argentina']);
  assert.deepEqual(parseCountries(''), []);
  // Duplicados colapsados por slug.
  assert.deepEqual(parseCountries('Chile, chile, CHILE'), ['chile']);
});

test('languagesForCountries deriva idiomas y siempre devuelve algo', () => {
  assert.deepEqual(languagesForCountries(['chile', 'mexico']), ['es']);
  assert.deepEqual(languagesForCountries(['japon', 'chile']), ['es', 'ja']);
  assert.deepEqual(languagesForCountries([]), ['es']);
});

test('parseDexNumber prioriza el primer candidato con dígitos', () => {
  assert.equal(parseDexNumber('card16', 'fichas/vtuber 1.jpg'), 16);
  assert.equal(parseDexNumber(null, 'fichas/vtuber 1.jpg'), 1);
  assert.equal(parseDexNumber('VTuber 42'), 42);
  assert.equal(parseDexNumber(null, null), null);
});

test('slugify y normalizeText producen claves estables', () => {
  assert.equal(slugify('Mizuno Arkss'), 'mizuno-arkss');
  assert.equal(slugify('GKuro Monochrome'), 'gkuro-monochrome');
  assert.equal(slugify('  Dra.Yusei  '), 'dra-yusei');
  assert.equal(normalizeText('MÉXICO'), 'mexico');
  assert.equal(normalizeText('  Pipa   Hiyoko '), 'pipa hiyoko');
});

test('la normalización del servidor y la del scraper coinciden', () => {
  // El servidor duplica normalizeText a propósito (no depende del scraper);
  // este test garantiza que ambas copias no divergen.
  const samples = ['MÉXICO', 'Perú´', '  GKuro  Monochrome ', 'Yeicokp Harv'];
  for (const sample of samples) {
    assert.equal(buildFtsQueryEquivalent(sample), normalizeText(sample));
  }
});
