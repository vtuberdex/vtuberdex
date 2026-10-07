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

/** Helper del mantenedor: llamada autenticada con cuerpo JSON. */
const admin = (method, ruta, cuerpo) =>
  fetch(`${baseUrl}/api/admin${ruta}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

test('PATCH del mantenedor actualiza campos, relaciones y reindexa la búsqueda', async () => {
  // Las facciones son un catálogo cerrado: la que no existe NO se crea sola (así nacían las
  // variantes con errata), se da de alta aparte.
  const creada = await admin('POST', '/factions', { label: 'Mythical Legacy' });
  assert.equal(creada.status, 201);
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
  // El nombre ya NO reescribe la URL: el slug es un campo propio.
  assert.equal(body.slug, 'gkuro-monochrome');
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
  // Lo que dibuja el panel: estados que suman el total, países, facciones, grados y la cola.
  assert.equal(body.estados.published + body.estados.draft + body.estados.hidden, 2);
  assert.ok(body.totals.sinProblemas >= 0 && body.totals.sinProblemas <= 2);
  assert.ok(body.paises.some((pais) => pais.name && pais.count > 0));
  assert.ok(body.paises.length <= 10 && body.facciones.length <= 10);
  assert.ok(Array.isArray(body.grados));
  assert.equal(body.correo.con + body.correo.sin, 2);
  assert.deepEqual(Object.keys(body.solicitudes.pendientes).sort(), ['baja', 'inscripcion', 'modificacion']);
});

test('el número de dex solo se cambia a uno LIBRE y el anterior queda disponible', async () => {
  // El 30 lo tiene Drawchii: pedirlo para GKuro se rechaza, no se intercambia en silencio.
  const ocupado = await admin('PATCH', '/vtubers/1', { dexNumber: 30 });
  assert.equal(ocupado.status, 409);
  assert.equal((await ocupado.json()).error, 'dex_ocupado');

  // Mover Drawchii al final libera el 30...
  const alFinal = await admin('PATCH', '/vtubers/2', { dexNumber: 'end' });
  assert.equal(alFinal.status, 200);
  assert.equal((await alFinal.json()).dexNumber, 31);
  // ...y ahora sí se puede usar para GKuro.
  const libre = await admin('PATCH', '/vtubers/1', { dexNumber: 30 });
  assert.equal(libre.status, 200);
  assert.equal((await libre.json()).dexNumber, 30);
  const orden = (await get('/api/vtubers?sort=dex')).body.items.map((item) => item.dexNumber);
  assert.deepEqual(orden, [30, 31]);

  // Se restaura para no afectar a los tests siguientes (dex 18 y 30).
  await admin('PATCH', '/vtubers/1', { dexNumber: 18 });
  await admin('PATCH', '/vtubers/2', { dexNumber: 30 });
});

test('cambiar la URL de una ficha deja el slug anterior como alias', async () => {
  const response = await admin('PATCH', '/vtubers/2', { slug: 'Drawchii Oficial!' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).slug, 'drawchii-oficial');

  const nueva = await get('/api/vtubers/drawchii-oficial');
  assert.equal(nueva.status, 200);
  // La URL vieja sigue resolviendo (con el slug actual, para que el cliente redirija).
  const vieja = await get('/api/vtubers/drawchii');
  assert.equal(vieja.status, 200);
  assert.equal(vieja.body.slug, 'drawchii-oficial');

  const duplicado = await admin('PATCH', '/vtubers/1', { slug: 'drawchii-oficial' });
  assert.equal(duplicado.status, 409);
  assert.equal((await duplicado.json()).error, 'slug_duplicado');

  await admin('PATCH', '/vtubers/2', { slug: 'drawchii' });
});

test('las facciones: máximo dos, solo existentes y se fusionan los duplicados', async () => {
  const a = (await (await admin('POST', '/factions', { label: 'Aetherion Valor' })).json()).faction;
  const b = (await (await admin('POST', '/factions', { label: 'Netherbane' })).json()).faction;
  const dup = (await (await admin('POST', '/factions', { label: 'Netherbane2' })).json()).faction;

  // Tres facciones: rechazado por el esquema.
  const tres = await admin('PATCH', '/vtubers/2', { factions: [a.slug, b.slug, dup.slug] });
  assert.equal(tres.status, 400);
  // Una que no existe: rechazada, no se crea.
  const fantasma = await admin('PATCH', '/vtubers/2', { factions: ['no-existe'] });
  assert.equal(fantasma.status, 422);
  assert.equal((await fantasma.json()).error, 'faccion_desconocida');

  const ok = await admin('PATCH', '/vtubers/2', { factions: [a.slug, dup.slug] });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).factions, ['Aetherion Valor', 'Netherbane2']);

  // Fusionar el duplicado en la real: la ficha conserva dos facciones y la variante desaparece.
  const fusion = await admin('DELETE', `/factions/${dup.id}?mergeInto=${b.id}`);
  assert.equal(fusion.status, 200);
  const despues = await get('/api/vtubers/drawchii');
  assert.deepEqual(despues.body.factions, ['Aetherion Valor', 'Netherbane']);
  const etiquetas = (await (await admin('GET', '/factions')).json()).items.map((f) => f.label);
  assert.ok(!etiquetas.includes('Netherbane2'));
  // Y el emblema/faceta refleja el cambio.
  const faceta = (await get('/api/meta?language=es')).body.factions.find((f) => f.slug === 'netherbane');
  assert.equal(faceta.count, 1);

  await admin('PATCH', '/vtubers/2', { factions: [] });
});

test('el mantenedor edita lore, atributos, habilidades y redes de una ficha', async () => {
  const response = await admin('PATCH', '/vtubers/1', {
    cardText: 'Una historia nueva.',
    stats: [
      { label: 'HP', value: 120, max: 200 },
      { label: 'Ataque', value: 50 },
    ],
    skills: [{ category: 'active', name: 'Golpe', effect: 'Hace daño' }],
    socials: [{ platform: 'twitch', url: 'https://twitch.tv/gkuro' }],
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.cardText, 'Una historia nueva.');
  assert.equal(body.stats.length, 2);
  assert.equal(body.stats[0].slug, 'hp');
  assert.equal(body.skills[0].name, 'Golpe');
  assert.equal(body.socials[0].url, 'https://twitch.tv/gkuro');
  // El poder se recalcula desde los atributos nuevos (50 de ataque x 1.2 + 120 de hp x 0.3 = 96).
  assert.equal(body.powerScore, 96);

  // Una red con esquema peligroso se rechaza.
  const peligrosa = await admin('PATCH', '/vtubers/1', { socials: [{ platform: 'x', url: 'javascript:alert(1)' }] });
  assert.equal(peligrosa.status, 400);
});

test('el HTML con colores de una habilidad se guarda tal cual y el HTML ajeno se rechaza', async () => {
  const html = 'Ataque Base +45 y aplicas <span style="color:#074fcc; font-weight:bold;">Miedo</span> durante 2 turnos.<br>';
  const ok = await admin('PATCH', '/vtubers/1', {
    skills: [{ category: 'active', name: 'Golpe', effect: 'Ataque Base +45 y aplicas Miedo durante 2 turnos.', effectHtml: html }],
  });
  assert.equal(ok.status, 200);
  // Antes `mutations` lo ponía a null siempre: tocar una habilidad borraba los colores de todo el kit.
  assert.equal((await ok.json()).skills[0].effectHtml, html);

  for (const malo of ['<img src=x onerror=alert(1)>', '<span style="color:red" onclick="x">a</span>', '<span style="background:url(x)">a</span>']) {
    const r = await admin('PATCH', '/vtubers/1', { skills: [{ category: 'active', name: 'Golpe', effectHtml: malo }] });
    assert.equal(r.status, 400, malo);
  }
});

test('crear una carta nueva: nace en borrador, al final de la dex y visible solo en el mantenedor', async () => {
  const response = await admin('POST', '/vtubers', { name: 'Nueva Estrella', phrase: 'Recién llegada' });
  assert.equal(response.status, 201);
  const carta = await response.json();
  assert.equal(carta.slug, 'nueva-estrella');
  assert.equal(carta.status, 'draft');
  assert.equal(carta.dexNumber, 31);

  // El catálogo público no la ve; el listado del mantenedor sí.
  assert.equal((await get('/api/vtubers/nueva-estrella')).status, 404);
  const lista = await (await admin('GET', '/vtubers?status=draft')).json();
  assert.deepEqual(lista.items.map((item) => item.slug), ['nueva-estrella']);
  const detalle = await (await admin('GET', `/vtubers/${carta.id}`)).json();
  assert.equal(detalle.name, 'Nueva Estrella');

  // Publicarla la hace visible y encontrable por búsqueda.
  await admin('PATCH', `/vtubers/${carta.id}`, { status: 'published' });
  assert.equal((await get('/api/vtubers?q=estrella')).body.total, 1);

  // Nombre repetido: la URL colisiona.
  const repetida = await admin('POST', '/vtubers', { name: 'Nueva Estrella' });
  assert.equal(repetida.status, 409);
  // Un número ocupado: rechazado.
  const ocupada = await admin('POST', '/vtubers', { name: 'Otra', dexNumber: 18 });
  assert.equal(ocupada.status, 409);

  // Limpieza: se oculta para no contar en los demás tests.
  await admin('PATCH', `/vtubers/${carta.id}`, { status: 'hidden' });
});

test('el emblema de una facción se sube como PNG y la facción pasa a usarlo', async () => {
  const sharp = (await import('sharp')).default;
  const png = await sharp({ create: { width: 900, height: 600, channels: 4, background: '#ffffff' } }).png().toBuffer();
  const faccion = (await (await admin('POST', '/factions', { label: 'Con Emblema' })).json()).faction;
  const subida = await fetch(`${baseUrl}/api/admin/factions/${faccion.id}/image`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: png,
  });
  assert.equal(subida.status, 200);
  const cuerpo = await subida.json();
  assert.match(cuerpo.faction.icon, /^images\/faction\/con-emblema\.png\?v=\d+$/);
  // Se limita a 512 px de lado y se guarda en la carpeta canónica.
  assert.equal(cuerpo.asset.width, 512);
  assert.ok(fs.existsSync(path.join(path.dirname(dbPath), 'images', 'faction', 'con-emblema.png')));

  // Un archivo que no es imagen se rechaza.
  const basura = await fetch(`${baseUrl}/api/admin/factions/${faccion.id}/image`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', authorization: `Bearer ${token}` },
    body: Buffer.from('esto no es una imagen'),
  });
  assert.equal(basura.status, 400);
});

test('CORS habilita el dev-server de Vite', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { headers: { origin: 'http://localhost:5173' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('OPTIONS responde 204 para preflight', async () => {
  const response = await fetch(`${baseUrl}/api/admin/vtubers/1`, { method: 'OPTIONS' });
  assert.equal(response.status, 204);
});

test('una solicitud de modificación aprobada se aplica a la ficha existente', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { confirmarSolicitud, crearSolicitud, ejecutorSqlite, TERMINOS_VERSION } = await import('../src/solicitudes.mjs');
  // La cola es el MISMO archivo que abre el Express (`solicitudes.db`, junto a la base): así llegan
  // las solicitudes desde los formularios públicos de Next.
  const cola = new DatabaseSync(path.join(path.dirname(dbPath), 'solicitudes.db'));
  const { id } = await crearSolicitud(
    ejecutorSqlite(cola),
    {
      ficha: '/v/drawchii',
      email: 'drawchii@example.com',
      height: '1,70 m',
      favoriteAnime: 'Frieren',
      imageUrl: 'https://x.test/avatar.png',
      aceptaTerminos: true,
      terminosVersion: TERMINOS_VERSION,
    },
    { tipo: 'modificacion', ip: '9.9.9.9' },
  );
  await confirmarSolicitud(ejecutorSqlite(cola), id);
  cola.close();
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` };

  // Ya llegó a la cola como modificación.
  const lista = await (await fetch(`${baseUrl}/api/admin/solicitudes?tipo=modificacion`, { headers })).json();
  assert.equal(lista.pendientes.modificacion, 1);
  assert.equal(lista.items[0].tipo, 'modificacion');

  const resuelta = await fetch(`${baseUrl}/api/admin/solicitudes/${id}/resolver`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accion: 'aprobar' }),
  });
  assert.equal(resuelta.status, 200);
  assert.equal((await resuelta.json()).solicitud.vtuberSlug, 'drawchii');

  const ficha = await get('/api/vtubers/drawchii');
  assert.equal(ficha.body.height, '1,70 m');
  assert.ok(ficha.body.profile.some((fila) => fila.label === 'Anime favorito' && fila.value === 'Frieren'));
  assert.equal(ficha.body.name, 'Drawchii');

  // Una ficha que no existe deja la solicitud pendiente y el error llega tal cual.
  const cola2 = new DatabaseSync(path.join(path.dirname(dbPath), 'solicitudes.db'));
  const otra = await crearSolicitud(
    ejecutorSqlite(cola2),
    { ficha: '/v/nadie', email: 'x@example.com', height: '1', aceptaTerminos: true, terminosVersion: TERMINOS_VERSION },
    { tipo: 'modificacion', ip: '9.9.9.9' },
  );
  await confirmarSolicitud(ejecutorSqlite(cola2), otra.id);
  cola2.close();
  const fallida = await fetch(`${baseUrl}/api/admin/solicitudes/${otra.id}/resolver`, { method: 'POST', headers, body: JSON.stringify({ accion: 'aprobar' }) });
  assert.equal(fallida.status, 404);
  assert.equal((await fallida.json()).error, 'ficha_no_encontrada');
});
