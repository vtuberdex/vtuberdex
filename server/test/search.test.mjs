/**
 * Tests de la API: búsqueda, facetas, detalle, auth y mantenedor.
 * Cada test corre contra una base SQLite temporal sembrada con un dataset de
 * ejemplo (no toca la base de producción ni la red).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openDatabase } from '../src/db/index.mjs';
import { seedDatabase } from '../src/seed.mjs';
import { searchVtubers, facetCounts, getVtuberBySlug, getNeighbors } from '../src/search.mjs';
import { hashPassword, verifyPassword } from '../src/auth.mjs';
import { buildFtsQuery } from '../src/search.mjs';

const SAMPLE = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'https://vtuberdex.com/',
  vtubers: [
    {
      dexNumber: 16,
      slug: 'madkoding',
      name: 'madKoding',
      alt: 'VTuber 16',
      countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
      languages: ['es'],
      groups: [],
      artists: [],
      source: { indexImage: 'fichas/vtuber16.jpg', detailSlug: null, detailUrl: null, hasDetail: false },
      assets: { card: 'images/card/madkoding.webp', thumb: 'images/thumb/madkoding.webp', logo: null, character: null, radar: null },
      detail: null,
    },
    {
      dexNumber: 18,
      slug: 'gkuro-monochrome',
      name: 'GKuro Monochrome',
      alt: 'VTuber 18',
      countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
      languages: ['es'],
      groups: ['Moonly'],
      artists: ['PROJECT AR-AI.I'],
      source: {
        indexImage: 'fichas/vtuber18.jpg',
        detailSlug: 'GKuroMonochrome',
        detailUrl: 'https://vtuberdex.com/GKuroMonochrome',
        hasDetail: true,
      },
      assets: {
        card: 'images/card/gkuro-monochrome.webp',
        thumb: 'images/thumb/gkuro-monochrome.webp',
        logo: 'images/logo/gkuro-monochrome.webp',
        character: 'images/character/gkuro-monochrome.webp',
        radar: 'images/radar/gkuro-monochrome.webp',
      },
      detail: {
        theme: '#616161',
        logo: 'logos/gkuromonochrome.png',
        phrase: 'Hola causas, soy pixelartista',
        phraseHtml: 'Hola causas',
        socials: [
          { platform: 'x', label: 'X', url: 'https://twitter.com/GKuroMonochrome', icon: 'icons/x.png' },
          { platform: 'twitch', label: 'Twitch', url: 'https://twitch.tv/gkuro_monochrome', icon: 'icons/twitch.png' },
        ],
        profile: [{ label: 'Cumpleaños', value: '23 de Mayo' }],
        birthday: '23 de Mayo',
        height: '1.72 m',
        hashtag: '(no tengo)',
        favoriteColor: 'Blanco/Negro',
        factions: ['Mythical Legacy', 'Netherbane'],
        stats: {
          Nivel: 3,
          EXP: { current: 65, max: 500 },
          HP: { current: 1710, max: 1710 },
          MP: { current: 1200, max: 1200 },
          Ataque: 142,
          'Ataque Mágico': 233,
          Velocidad: 123,
        },
        level: 3,
        experience: { current: 65, max: 500 },
        radar: 'diagrama/gkuromonochrome.png',
        gallery: [{ src: 'Avatares/gkuromonochrome.png', caption: 'Principal', isInline: false }],
        inlineThumbCount: 0,
        skills: [
          {
            category: 'active',
            section: 'Active Skills',
            type: 'Ofensivo',
            name: 'Monochrome Resolve',
            effect: 'Ataque Mágico Base +30.',
            effectHtml: 'Ataque Mágico Base +30.',
            factions: [{ src: 'facciones/Veilbreaker.png', name: 'Mythical Legacy' }],
            position: 0,
          },
        ],
        sections: ['Perfil / Presentación', 'Stats / Facciones / Radar', 'Skills'],
        hasSkills: true,
      },
    },
    {
      dexNumber: 200,
      slug: 'mizuno-arkss',
      name: 'Mizuno Arkss',
      alt: 'VTuber 200',
      countries: [
        { slug: 'mexico', name: 'México', flag: '🇲🇽' },
        { slug: 'japon', name: 'Japón', flag: '🇯🇵' },
      ],
      languages: ['es', 'ja'],
      groups: ['Mystic Wonderland'],
      artists: [],
      source: { indexImage: 'fichas/vtuber200.jpg', detailSlug: 'MizunoArkss', detailUrl: null, hasDetail: true },
      assets: { card: 'images/card/mizuno-arkss.webp', thumb: null, logo: null, character: null, radar: null },
      detail: {
        theme: '#a855f7',
        logo: null,
        phrase: 'Idol interdimensional',
        socials: [],
        profile: [],
        factions: [],
        stats: {},
        level: 1,
        experience: null,
        gallery: [],
        skills: [],
        sections: [],
        hasSkills: false,
      },
    },
  ],
};

let db;
let dbPath;

before(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-test-'));
  dbPath = path.join(dir, 'test.db');
  db = openDatabase(dbPath);
  seedDatabase({ db, dataset: SAMPLE });
  db.prepare(`INSERT INTO admin_user (username, password_hash, role) VALUES (?, ?, 'admin')`).run(
    'tester',
    hashPassword('secreto123'),
  );
});

after(() => {
  db?.close();
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

test('la semilla importa todas las cartas y sus hijos', () => {
  const counts = {
    vtubers: db.prepare('SELECT COUNT(*) AS n FROM vtuber').get().n,
    countries: db.prepare('SELECT COUNT(*) AS n FROM country').get().n,
    skills: db.prepare('SELECT COUNT(*) AS n FROM skill').get().n,
    profile: db.prepare('SELECT COUNT(*) AS n FROM profile_field').get().n,
    assets: db.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
    fts: db.prepare('SELECT COUNT(*) AS n FROM vtuber_fts').get().n,
  };
  assert.equal(counts.vtubers, 3);
  assert.equal(counts.countries, 3);
  assert.equal(counts.skills, 1);
  assert.equal(counts.profile, 1);
  assert.equal(counts.assets, 8);
  assert.equal(counts.fts, 3);
});

test('el puntaje de poder solo se calcula con stats y ordena de mayor a menor', () => {
  const rows = db.prepare('SELECT name, power_score FROM vtuber ORDER BY power_score DESC').all();
  assert.equal(rows[0].name, 'GKuro Monochrome');
  assert.ok(rows[0].power_score > 0);
  assert.equal(rows[1].power_score, 0);
  assert.equal(rows[2].power_score, 0);
});

test('búsqueda por nombre encuentra coincidencias parciales', () => {
  const result = searchVtubers(db, { q: 'gku' });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].slug, 'gkuro-monochrome');
});

test('búsqueda por número de dex funciona exacto', () => {
  assert.deepEqual(searchVtubers(db, { q: '200' }).items.map((item) => item.dexNumber), [200]);
  assert.deepEqual(searchVtubers(db, { q: '16' }).items.map((item) => item.dexNumber), [16]);
});

test('búsqueda por etiquetas indexadas (país, grupo, facción)', () => {
  assert.deepEqual(searchVtubers(db, { q: 'moonly' }).items.map((item) => item.slug), ['gkuro-monochrome']);
  assert.deepEqual(searchVtubers(db, { q: 'netherbane' }).items.map((item) => item.slug), ['gkuro-monochrome']);
  assert.deepEqual(searchVtubers(db, { q: 'mexico' }).items.map((item) => item.slug), ['mizuno-arkss']);
});

test('la búsqueda ignora acentos y mayúsculas', () => {
  assert.equal(searchVtubers(db, { q: 'MÉXICO' }).total, 1);
  assert.equal(searchVtubers(db, { q: 'GKURO' }).total, 1);
});

test('filtros facetados por país (slug o nombre) e idioma', () => {
  assert.deepEqual(searchVtubers(db, { countries: ['chile'] }).items.map((item) => item.slug).sort(), [
    'gkuro-monochrome',
    'madkoding',
  ]);
  assert.deepEqual(searchVtubers(db, { countries: ['Chile'] }).total, 2);
  assert.deepEqual(searchVtubers(db, { countries: ['mexico', 'chile'] }).total, 3);
  assert.deepEqual(searchVtubers(db, { languages: ['ja'] }).items.map((item) => item.slug), ['mizuno-arkss']);
});

test('filtros combinados (país + idioma + facción)', () => {
  const result = searchVtubers(db, { countries: ['chile'], factions: ['mythical-legacy'] });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].slug, 'gkuro-monochrome');
  assert.equal(searchVtubers(db, { countries: ['chile'], factions: ['inexistente'] }).total, 0);
});

test('orden y paginación son coherentes', () => {
  const first = searchVtubers(db, { sort: 'dex', perPage: 2, page: 1 });
  assert.equal(first.items.length, 2);
  assert.equal(first.pageCount, 2);
  assert.deepEqual(first.items.map((item) => item.dexNumber), [16, 18]);

  const second = searchVtubers(db, { sort: 'dex', perPage: 2, page: 2 });
  assert.deepEqual(second.items.map((item) => item.dexNumber), [200]);

  const byName = searchVtubers(db, { sort: 'name' });
  assert.deepEqual(byName.items.map((item) => item.name), ['GKuro Monochrome', 'madKoding', 'Mizuno Arkss']);

  const byPower = searchVtubers(db, { sort: 'power' });
  assert.equal(byPower.items[0].slug, 'gkuro-monochrome');
});

test('la vista de carta trae imágenes, países y preview de stats', () => {
  const card = searchVtubers(db, { q: 'gkuro' }).items[0];
  // Rutas absolutas: si fueran relativas se romperían en /v/:slug.
  assert.equal(card.images.card, '/images/card/gkuro-monochrome.webp');
  assert.equal(card.images.radar, '/images/radar/gkuro-monochrome.webp');
  assert.deepEqual(card.countries, [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }]);
  assert.deepEqual(card.factions, ['Mythical Legacy', 'Netherbane']);
  assert.equal(card.socialCount, 2);
  assert.ok(card.statsPreview.length > 0);
  assert.equal(card.themeColor, '#616161');
});

test('facetas cuentan sobre el conjunto filtrado y respetan el idioma', () => {
  const all = facetCounts(db, { language: 'es' });
  // Mizuno habla es+ja: entra por "es" y aporta México y Japón a las facetas.
  assert.deepEqual(all.countries.map((country) => country.slug).sort(), ['chile', 'japon', 'mexico']);
  assert.equal(all.totals.total, 3);
  assert.equal(all.totals.withDetail, 2);
  assert.equal(all.languages.find((language) => language.code === 'ja').count, 1);

  const japanese = facetCounts(db, { language: 'ja' });
  assert.equal(japanese.totals.total, 1);
  assert.deepEqual(japanese.countries.map((country) => country.slug).sort(), ['japon', 'mexico']);

  const withQuery = facetCounts(db, { language: 'es', q: 'gku' });
  assert.equal(withQuery.totals.total, 1);
  assert.deepEqual(withQuery.countries.map((country) => country.slug), ['chile']);
});

test('el detalle incluye perfil, stats, skills, sociales y experiencia', () => {
  const detail = getVtuberBySlug(db, 'gkuro-monochrome');
  assert.equal(detail.name, 'GKuro Monochrome');
  assert.equal(detail.profile[0].value, '23 de Mayo');
  assert.equal(detail.stats.find((stat) => stat.slug === 'magicAttack').label, 'Ataque Mágico');
  assert.equal(detail.skills.length, 1);
  assert.equal(detail.skills[0].factions[0].name, 'Mythical Legacy');
  assert.equal(detail.socials.length, 2);
  assert.equal(detail.assets.length, 5);
  assert.deepEqual(detail.experience, { current: 65, max: 500 });
  assert.equal(detail.hasDetail, true);
  assert.equal(detail.hashtag, '(no tengo)');
});

test('el detalle de una ficha incompleta no inventa datos', () => {
  const detail = getVtuberBySlug(db, 'mizuno-arkss');
  assert.deepEqual(detail.profile, []);
  assert.deepEqual(detail.stats, []);
  assert.deepEqual(detail.skills, []);
  assert.equal(detail.experience, null);
  assert.deepEqual(detail.countries.map((country) => country.slug), ['mexico', 'japon']);
  assert.equal(detail.images.thumb, null);
});

test('getVtuberBySlug devuelve null para slugs inexistentes', () => {
  assert.equal(getVtuberBySlug(db, 'no-existe'), null);
});

test('los vecinos de dex saltan los huecos y respetan extremos', () => {
  assert.deepEqual(getNeighbors(db, 18), {
    prev: { dexNumber: 16, slug: 'madkoding', name: 'madKoding' },
    next: { dexNumber: 200, slug: 'mizuno-arkss', name: 'Mizuno Arkss' },
  });
  assert.equal(getNeighbors(db, 16).prev, null);
  assert.equal(getNeighbors(db, 999).next, null);
});

test('buildFtsQuery escapa la entrada del usuario', () => {
  assert.equal(buildFtsQuery('mizuno ark'), '"mizuno"* AND "ark"*');
  // Sin sintaxis FTS filtrada del usuario.
  assert.equal(buildFtsQuery('foo" OR "bar'), '"foo"* AND "or"* AND "bar"*');
  assert.equal(buildFtsQuery('   '), null);
  assert.equal(buildFtsQuery('a'.repeat(50)).split(' AND ').length, 1);
});

test('hashPassword/verifyPassword rechazan contraseñas incorrectas', () => {
  const hash = hashPassword('secreto123');
  assert.match(hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.equal(verifyPassword('secreto123', hash), true);
  assert.equal(verifyPassword('secreto124', hash), false);
  assert.equal(verifyPassword('x', 'formato-invalido'), false);
  // Sal distinta -> hash distinto (no hay tabla precalculable).
  assert.notEqual(hashPassword('secreto123'), hashPassword('secreto123'));
});
