/**
 * Tests de integración HTTP: rutas públicas + flujo completo del mantenedor
 * (login, edición, reindexado de búsqueda, validaciones y auditoría).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createApp } from '../src/index.mjs';
import { seedDatabase } from '../src/seed.mjs';
import { openDatabase } from '../src/db/index.mjs';
import { hashPassword } from '../src/auth.mjs';

const DATASET = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'https://vtuberdex.com/',
  vtubers: [
    {
      dexNumber: 18,
      slug: 'gkuro-monochrome',
      name: 'GKuro Monochrome',
      alt: 'VTuber 18',
      countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
      languages: ['es'],
      groups: [],
      artists: [],
      source: { indexImage: 'fichas/vtuber18.jpg', detailUrl: null, hasDetail: true },
      assets: { card: 'images/ficha/gkuro-monochrome.webp' },
      detail: {
        theme: '#616161',
        phrase: 'pixelartista',
        profile: [],
        factions: [],
        stats: {},
        skills: [],
        socials: [],
        gallery: [],
      },
    },
    {
      dexNumber: 30,
      slug: 'drawchii',
      name: 'Drawchii',
      countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
      languages: ['es'],
      groups: ['Moonly'],
      artists: [],
      source: { indexImage: 'fichas/vtuber30.jpg', detailUrl: null, hasDetail: false },
      assets: { card: 'images/ficha/drawchii.webp' },
      detail: null,
    },
  ],
};

let server;
let baseUrl;
let dbPath;
let token;

before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-http-'));
  dbPath = path.join(dir, 'app.db');
  const db = openDatabase(dbPath);
  seedDatabase({ db, dataset: DATASET });
  db.prepare(`INSERT INTO admin_user (username, password_hash, role) VALUES ('tester', ?, 'admin')`).run(
    hashPassword('secreto123'),
  );
  db.close();

  const app = createApp({ dbPath, imageRoot: path.join(dir, 'images'), webRoot: path.join(dir, 'dist') });
  await new Promise((resolve) => {
    server = app.app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
});

const get = async (url) => {
  const response = await fetch(`${baseUrl}${url}`);
  return { status: response.status, body: await response.json() };
};

test('GET /api/health reporta el catálogo publicado', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.vtubers, 2);
  assert.equal(body.withDetail, 1);
});

test('GET /api/vtubers devuelve items, total, paginación y facetas', async () => {
  const { status, body } = await get('/api/vtubers?facet=all');
  assert.equal(status, 200);
  assert.equal(body.total, 2);
  assert.equal(body.pageCount, 1);
  assert.equal(body.items.length, 2);
  assert.ok(body.facets.countries.some((country) => country.slug === 'chile'));
});

test('GET /api/vtubers rechaza query inválida con detalle del campo', async () => {
  const { status, body } = await get('/api/vtubers?perPage=9999');
  assert.equal(status, 400);
  assert.equal(body.error, 'query_invalida');
  assert.equal(body.issues[0].path, 'perPage');
});

test('GET /api/vtubers/:slug devuelve detalle y vecinos; 404 si no existe', async () => {
  const found = await get('/api/vtubers/gkuro-monochrome');
  assert.equal(found.status, 200);
  assert.equal(found.body.dexNumber, 18);
  assert.equal(found.body.neighbors.next.slug, 'drawchii');
  assert.equal(found.body.neighbors.prev, null);

  const missing = await get('/api/vtubers/no-existe');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'no_encontrado');
});

test('GET /api/meta expone facetas y fecha del dataset', async () => {
  const { status, body } = await get('/api/meta?language=es');
  assert.equal(status, 200);
  assert.equal(body.totals.total, 2);
  assert.equal(body.generatedAt, '2026-01-01T00:00:00.000Z');
});

test('el mantenedor exige sesión en rutas de administración', async () => {
  const anonymous = await fetch(`${baseUrl}/api/admin/stats`);
  assert.equal(anonymous.status, 401);
  const withBadToken = await fetch(`${baseUrl}/api/admin/stats`, {
    headers: { authorization: 'Bearer inventado' },
  });
  assert.equal(withBadToken.status, 401);
});

test('login: credenciales inválidas -> 401 y payload inválido -> 400', async () => {
  const bad = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'incorrecta' }),
  });
  assert.equal(bad.status, 401);

  const malformed = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester' }),
  });
  assert.equal(malformed.status, 400);
});

test('login correcto entrega token utilizable', async () => {
  const response = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'secreto123' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.token, /^[A-Za-z0-9_-]{20,}$/);
  token = body.token;

  const session = await fetch(`${baseUrl}/api/admin/session`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).user.username, 'tester');
});

test('PATCH del mantenedor actualiza campos, relaciones y reindexa la búsqueda', async () => {
  const response = await fetch(`${baseUrl}/api/admin/vtubers/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'GKuro Monochrome VT',
      themeColor: '#22d3ee',
      hashtag: '#MonochromeArte',
      status: 'published',
      factions: ['Mythical Legacy'],
      groups: ['Moonly', 'Celestials'],
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.name, 'GKuro Monochrome VT');
  assert.equal(body.slug, 'gkuro-monochrome-vt');
  assert.equal(body.themeColor, '#22d3ee');
  assert.deepEqual(body.factions, ['Mythical Legacy']);
  assert.deepEqual(body.groups, ['Moonly', 'Celestials']);

  // El nombre nuevo es encontrable y el viejo también (por la ficha original).
  const byNewName = await get('/api/vtubers?q=monochrome%20vt');
  assert.equal(byNewName.body.total, 1);
  // Las etiquetas nuevas entraron al índice full-text.
  const byGroup = await get('/api/vtubers?q=celestials');
  assert.equal(byGroup.body.total, 1);
});

test('PATCH valida el formato del color y los países desconocidos', async () => {
  const badColor = await fetch(`${baseUrl}/api/admin/vtubers/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ themeColor: 'azul' }),
  });
  assert.equal(badColor.status, 400);
  assert.equal((await badColor.json()).issues[0].path, 'themeColor');

  const badCountry = await fetch(`${baseUrl}/api/admin/vtubers/1`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ countries: ['atlantida'] }),
  });
  assert.equal(badCountry.status, 422);
});

test('ocultar una ficha la saca del catálogo público y recompone las facetas', async () => {
  const before = (await get('/api/meta?language=es')).body.groups.find((group) => group.slug === 'moonly');
  assert.equal(before.count, 2);

  const response = await fetch(`${baseUrl}/api/admin/vtubers/2`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'hidden' }),
  });
  assert.equal(response.status, 200);

  const publicList = await get('/api/vtubers?facet=all');
  assert.equal(publicList.body.total, 1);
  assert.ok(!publicList.body.items.some((item) => item.slug === 'drawchii'));

  // El contador de la faceta baja con la ficha oculta (ya no cuenta "Moonly" 2 veces).
  const after = (await get('/api/meta?language=es')).body.groups.find((group) => group.slug === 'moonly');
  assert.equal(after.count, 1);

  // Y el grupo que solo existía en la ficha oculta desaparece del catálogo.
  const hiddenOnly = await fetch(`${baseUrl}/api/admin/vtubers/2`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ groups: ['SoloDrawchii'] }),
  });
  assert.equal(hiddenOnly.status, 200);
  const facets = (await get('/api/meta?language=es')).body.groups.map((group) => group.slug);
  assert.ok(!facets.includes('solodrawchii'));

  // Se restaura el estado para no afectar a los tests siguientes.
  await fetch(`${baseUrl}/api/admin/vtubers/2`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: 'published', groups: ['Moonly'] }),
  });
  assert.equal((await get('/api/vtubers')).body.total, 2);
});

test('bulk-status cambia la visibilidad de varios y la auditoría lo registra', async () => {
  const response = await fetch(`${baseUrl}/api/admin/vtubers/bulk-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: [1, 2], status: 'draft' }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { updated: 2, status: 'draft' });
  assert.equal((await get('/api/vtubers')).body.total, 0);

  await fetch(`${baseUrl}/api/admin/vtubers/bulk-status`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ ids: [1, 2], status: 'published' }),
  });

  const audit = await fetch(`${baseUrl}/api/admin/audit`, { headers: { authorization: `Bearer ${token}` } });
  const actions = (await audit.json()).items.map((entry) => entry.action);
  assert.ok(actions.includes('login'));
  assert.ok(actions.includes('update'));
  assert.ok(actions.includes('bulk-status'));
});

test('GET /api/admin/stats resume totales y calidad', async () => {
  const response = await fetch(`${baseUrl}/api/admin/stats`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.totals.total, 2);
  assert.equal(body.totals.notPublished, 0);
  assert.ok(body.quality.length > 0);
});

test('CORS habilita el dev-server de Vite', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('OPTIONS responde 204 para preflight', async () => {
  const response = await fetch(`${baseUrl}/api/admin/vtubers/1`, { method: 'OPTIONS' });
  assert.equal(response.status, 204);
});
