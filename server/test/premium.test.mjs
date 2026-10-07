/**
 * Cartas premium: la escala de grados, la regla que las guarda, lo que devuelve la búsqueda y el
 * camino HTTP del mantenedor. Corre contra una base SQLite temporal, sin red.
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
import { MutationError, aplicarParche, aplicarOperacion, sellarPremium } from '../src/mutations.mjs';
import { searchVtubers, getVtuberBySlug, getNeighbors, tienePremium } from '../src/search.mjs';
import { vtuberUpdateSchema, listQuerySchema } from '../src/validation.mjs';
import {
  GRADOS,
  GRADOS_DEGRADADOS,
  GRADO_DE_BAJA,
  GRADO_INICIAL,
  GRADO_MAXIMO,
  TODOS_LOS_GRADOS,
  esBlackLabel,
  esGradoDegradado,
  esGradoValido,
  gradoSiguiente,
  numeroDeCertificado,
  rangoDeGrado,
  severidadDeGrado,
} from '../src/premium.mjs';

const vtuber = (dexNumber, slug, name) => ({
  dexNumber,
  slug,
  name,
  countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
  languages: ['es'],
  groups: [],
  artists: [],
  source: { indexImage: `fichas/vtuber${dexNumber}.jpg`, detailUrl: null, hasDetail: false },
  assets: { card: `images/ficha/${slug}.webp` },
  detail: null,
});

const DATASET = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'https://vtuberdex.com/',
  vtubers: [vtuber(16, 'madkoding', 'madKoding'), vtuber(30, 'drawchii', 'Drawchii'), vtuber(31, 'otra', 'Otra')],
};

let dir;
let db;
let baseUrl;
let server;
let token;
let dbPath;

const idDe = (slug) => db.prepare('SELECT id FROM vtuber WHERE slug = ?').get(slug).id;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-premium-'));
  dbPath = path.join(dir, 'app.db');
  db = openDatabase(dbPath);
  seedDatabase({ db, dataset: DATASET });
  db.prepare(`INSERT INTO admin_user (username, password_hash, role) VALUES ('tester', ?, 'admin')`).run(
    hashPassword('secreto123'),
  );
  // El Express abre su propia conexión sobre el mismo archivo: así el HTTP y las pruebas directas
  // ven la misma base, que es lo que importa para el camino completo.
  const app = createApp({ dbPath, imageRoot: path.join(dir, 'images'), webRoot: path.join(dir, 'dist') });
  await new Promise((resolve) => {
    server = app.app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(`${baseUrl}/api/admin/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'tester', password: 'secreto123' }),
  });
  token = (await login.json()).token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const admin = (method, ruta, cuerpo) =>
  fetch(`${baseUrl}/api/admin${ruta}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

test('la escala va de 6 a la Black Label en saltos de medio punto', () => {
  assert.deepEqual([...GRADOS], ['6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', 'BL']);
  assert.equal(GRADO_INICIAL, '6');
  assert.equal(GRADO_MAXIMO, 'BL');
  // Cada paso numérico es de 0,5: la regla de negocio (la escala de donación).
  const numericos = GRADOS.filter((g) => g !== 'BL').map(Number);
  numericos.slice(1).forEach((nota, i) => assert.equal(nota - numericos[i], 0.5));
});

test('gradoSiguiente recorre la escala y se detiene en la Black Label', () => {
  const recorrido = [];
  for (let grado = GRADO_INICIAL; grado; grado = gradoSiguiente(grado)) recorrido.push(grado);
  assert.deepEqual(recorrido, [...GRADOS]);
  assert.equal(gradoSiguiente('BL'), null);
  assert.equal(gradoSiguiente('3'), null, 'un grado de deterioro no sube con las donaciones');
  assert.equal(gradoSiguiente('11'), null, 'un grado que no existe no tiene siguiente');
  assert.equal(esBlackLabel('BL'), true);
  assert.equal(esBlackLabel('10'), false);
  assert.equal(rangoDeGrado('9.5'), 7);
  assert.equal(esGradoValido('8.5'), true);
  assert.equal(esGradoValido(8.5), false, 'el grado es texto: 8.5 numérico no es la clave');
  assert.equal(esGradoValido('11'), false);
});

test('el certificado se deriva del número de dex (#016 ⇒ VTD-016) y no cambia', () => {
  assert.equal(numeroDeCertificado(16), 'VTD-016');
  assert.equal(numeroDeCertificado(0), 'VTD-000');
  assert.equal(numeroDeCertificado(1005), 'VTD-1005');
  assert.equal(numeroDeCertificado(null), 'VTD-000');
});

test('una carta nueva no es premium', () => {
  assert.equal(getVtuberBySlug(db, 'madkoding').premium, null);
  assert.equal(searchVtubers(db, { premium: true }).total, 0);
});

test('aplicarParche convierte una ficha en premium y la API la devuelve con su certificado', () => {
  const id = idDe('madkoding');
  aplicarParche(db, id, { premium: { grade: '10', since: '2026-05-01', gradedAt: '2026-09-01' } });
  const carta = getVtuberBySlug(db, 'madkoding');
  assert.deepEqual(carta.premium, { grade: '10', since: '2026-05-01', gradedAt: '2026-09-01', cert: numeroDeCertificado(carta.dexNumber) });
  // El certificado es lo que el visitante lee en la carta: el MISMO número que su `#NNN`.
  assert.equal(carta.premium.cert, `VTD-${String(carta.dexNumber).padStart(3, '0')}`);
  // También sale en el listado (es lo que pinta el libro del catálogo).
  const enLista = searchVtubers(db, {}).items.find((item) => item.slug === 'madkoding');
  assert.equal(enLista.premium.grade, '10');
  assert.equal(searchVtubers(db, {}).items.find((item) => item.slug === 'drawchii').premium, null);
});

test('subir de grado cambia graded_at y conserva el alta; guardar el mismo grado no mueve nada', () => {
  const id = idDe('drawchii');
  aplicarParche(db, id, { premium: { grade: '8', since: '2026-01-10', gradedAt: '2026-01-10' } });
  aplicarParche(db, id, { premium: { grade: '8.5', gradedAt: '2026-02-10' } });
  let fila = db.prepare('SELECT grade, since, graded_at AS gradedAt FROM premium WHERE vtuber_id = ?').get(id);
  assert.deepEqual({ ...fila }, { grade: '8.5', since: '2026-01-10', gradedAt: '2026-02-10' });

  // Mismo grado sin fechas: ni el alta ni el último ascenso se tocan.
  aplicarParche(db, id, { premium: { grade: '8.5' } });
  fila = db.prepare('SELECT grade, since, graded_at AS gradedAt FROM premium WHERE vtuber_id = ?').get(id);
  assert.deepEqual({ ...fila }, { grade: '8.5', since: '2026-01-10', gradedAt: '2026-02-10' });
});

test('premium null devuelve la ficha a carta normal', () => {
  const id = idDe('drawchii');
  aplicarParche(db, id, { premium: null });
  assert.equal(getVtuberBySlug(db, 'drawchii').premium, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM premium WHERE vtuber_id = ?').get(id).n, 0);
});

test('un parche sin `premium` no toca el premium existente', () => {
  aplicarParche(db, idDe('madkoding'), { phrase: 'hola' });
  assert.equal(getVtuberBySlug(db, 'madkoding').premium.grade, '10');
});

test('un grado fuera de la escala se rechaza, en la regla y en el esquema', () => {
  assert.throws(
    () => aplicarParche(db, idDe('otra'), { premium: { grade: '11' } }),
    (error) => error instanceof MutationError && error.status === 400 && error.code === 'grado_invalido',
  );
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: '11' } }).success, false);
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: '7' } }).success, true, 'el 7 es de la escala de deterioro');
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: 8.5 } }).success, false, 'el grado viaja como texto');
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: 'BL' } }).success, true);
  assert.equal(vtuberUpdateSchema.safeParse({ premium: null }).success, true);
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: '9', since: 'ayer' } }).success, false);
});

test('la escala de deterioro va del 5 al 1 y severidadDeGrado crece hacia el 1', () => {
  assert.deepEqual([...GRADOS_DEGRADADOS], ['5', '4', '3', '2', '1']);
  assert.deepEqual([...TODOS_LOS_GRADOS], ['1', '2', '3', '4', '5', '6', '6.5', '7', '7.5', '8', '8.5', '9', '9.5', '10', 'BL']);
  assert.equal(GRADO_DE_BAJA, '1');
  assert.equal(severidadDeGrado('10'), 0, 'una premium no tiene daño');
  assert.equal(severidadDeGrado('1'), 1);
  const severidades = GRADOS_DEGRADADOS.map(severidadDeGrado);
  severidades.slice(1).forEach((s, i) => assert.ok(s > severidades[i], 'cada grado está más roto que el anterior'));
  assert.equal(esGradoDegradado('3'), true);
  assert.equal(esGradoDegradado('8'), false);
});

test('una carta degradada se guarda, pero NO sale en la sección pública Premium', () => {
  aplicarParche(db, idDe('otra'), { premium: { grade: '1' } });
  try {
    assert.equal(getVtuberBySlug(db, 'otra', { includeHidden: true }).premium.grade, '1', 'el mantenedor la ve');
    assert.deepEqual(searchVtubers(db, { premium: true }).items.map((i) => i.slug), ['madkoding'], 'el público solo ve las premium');
    const admin = searchVtubers(db, { premium: 'todas', includeHidden: true }).items.map((i) => i.slug).sort();
    assert.deepEqual(admin, ['madkoding', 'otra'], 'el mantenedor ve también las degradadas');
  } finally {
    aplicarParche(db, idDe('otra'), { premium: null });
  }
});

test('una ficha en grado 1 no tiene página pública: ni nombre, ni URL, ni vecinos; el mantenedor la ve entera', () => {
  const id = idDe('otra');
  db.prepare("UPDATE vtuber SET phrase = 'frase privada', card_text = 'historia privada' WHERE id = ?").run(id);
  aplicarParche(db, id, { premium: { grade: '1' }, socials: [{ platform: 'x', url: 'https://x.com/otra' }] });
  try {
    assert.equal(getVtuberBySlug(db, 'otra'), null, 'el detalle público es un 404');
    assert.equal(getVtuberBySlug(db, 'otra', { includeHidden: false }), null);

    // Tampoco por un alias antiguo de la URL.
    db.prepare('INSERT INTO slug_alias (slug, vtuber_id) VALUES (?, ?)').run('otra-vieja', id);
    assert.equal(getVtuberBySlug(db, 'otra-vieja'), null);

    const lista = searchVtubers(db, {}).items.find((i) => i.dexNumber === 31);
    assert.ok(lista, 'sigue en el catálogo (como carta rota)');
    assert.notEqual(lista.name, 'Otra');
    assert.doesNotMatch(lista.name, /[A-Za-z]/);
    assert.equal(lista.slug, 'deteriorada-31', 'la URL real no sale en el listado');
    assert.equal(lista.phrase, null);
    assert.equal(lista.images.logo, null);
    assert.equal(lista.dexNumber, 31, 'el número de dex se conserva');
    assert.equal(lista.premium.grade, '1');
    assert.equal(searchVtubers(db, { q: 'otra' }).total, 0, 'buscar por su nombre no la encuentra');

    assert.equal(getNeighbors(db, 30).next, null, 'no es vecino de nadie: no tiene página a la que ir');

    const admin = getVtuberBySlug(db, 'otra', { includeHidden: true });
    assert.equal(admin.name, 'Otra', 'el mantenedor la ve entera');
    assert.equal(admin.phrase, 'frase privada');
    assert.equal(admin.socials.length, 1);
    assert.equal(searchVtubers(db, { q: 'otra', includeHidden: true }).total, 1);
  } finally {
    db.prepare('DELETE FROM slug_alias WHERE slug = ?').run('otra-vieja');
    aplicarParche(db, id, { premium: null, socials: [] });
  }
  assert.equal(getVtuberBySlug(db, 'otra').name, 'Otra', 'sin el grado 1 vuelve a tener página');
});

test('en el grado 2 la ficha NO se oculta: solo el 1 es la ficha deteriorada', () => {
  aplicarParche(db, idDe('otra'), { premium: { grade: '2' } });
  try {
    assert.equal(getVtuberBySlug(db, 'otra').name, 'Otra');
  } finally {
    aplicarParche(db, idDe('otra'), { premium: null });
  }
});

test('el filtro premium devuelve solo las gradeadas y cuenta bien', () => {
  const resultado = searchVtubers(db, { premium: true });
  assert.equal(resultado.total, 1);
  assert.deepEqual(resultado.items.map((item) => item.slug), ['madkoding']);
  assert.equal(listQuerySchema.safeParse({ premium: '1' }).success, true);
  assert.equal(listQuerySchema.safeParse({ premium: 'quizas' }).success, false);
});

test('sellarPremium congela el día sin mutar el parche (el diario debe ser determinista)', () => {
  const original = { premium: { grade: '9' } };
  const sellado = sellarPremium(original, '2026-10-02');
  assert.deepEqual(sellado.premium, { grade: '9', ahora: '2026-10-02' });
  assert.deepEqual(original, { premium: { grade: '9' } }, 'no muta la entrada');
  assert.equal(sellarPremium({ premium: null }, '2026-10-02').premium, null);
  assert.deepEqual(sellarPremium({ name: 'x' }, '2026-10-02'), { name: 'x' });
  // Un día ya sellado no se vuelve a sellar: reproducir el diario no lo mueve.
  assert.equal(sellarPremium({ premium: { grade: '9', ahora: '2025-01-01' } }, '2026-10-02').premium.ahora, '2025-01-01');
});

test('subir de grado desde una operación sellada NO pisa la fecha de alta', () => {
  // Es el fallo que sellar `since` causaba: cada ascenso movía el alta a «hoy».
  const copia = openDatabase(path.join(dir, 'ascenso.db'));
  seedDatabase({ db: copia, dataset: DATASET });
  aplicarOperacion(copia, { tipo: 'vtuber.editar', id: 1, patch: sellarPremium({ premium: { grade: '8' } }, '2026-01-10') });
  aplicarOperacion(copia, { tipo: 'vtuber.editar', id: 1, patch: sellarPremium({ premium: { grade: '8.5' } }, '2026-02-10') });
  const fila = copia.prepare('SELECT grade, since, graded_at AS gradedAt FROM premium WHERE vtuber_id = 1').get();
  assert.deepEqual({ ...fila }, { grade: '8.5', since: '2026-01-10', gradedAt: '2026-02-10' });
  copia.close();
});

test('una operación del diario con premium se reproduce igual en otra base', () => {
  const copia = openDatabase(path.join(dir, 'replay.db'));
  seedDatabase({ db: copia, dataset: DATASET });
  const operacion = { tipo: 'vtuber.editar', id: 1, patch: sellarPremium({ premium: { grade: '9.5' } }, '2026-10-02') };
  aplicarOperacion(copia, operacion);
  aplicarOperacion(copia, operacion); // reproducir dos veces no cambia nada
  const fila = copia.prepare('SELECT grade, since, graded_at AS gradedAt FROM premium WHERE vtuber_id = 1').get();
  assert.deepEqual({ ...fila }, { grade: '9.5', since: '2026-10-02', gradedAt: '2026-10-02' });
  copia.close();
});

test('una base anterior a esta función (sin tabla premium) sigue sirviendo el catálogo', () => {
  const vieja = openDatabase(path.join(dir, 'vieja.db'));
  seedDatabase({ db: vieja, dataset: DATASET });
  vieja.exec('DROP TABLE premium');
  vieja.close();
  // La base empaquetada se abre en SOLO LECTURA y no aplica el esquema.
  const lectura = openDatabase(path.join(dir, 'vieja.db'), { readonly: true });
  assert.equal(tienePremium(lectura), false);
  const resultado = searchVtubers(lectura, {});
  assert.equal(resultado.total, 3);
  assert.ok(resultado.items.every((item) => item.premium === null));
  assert.equal(searchVtubers(lectura, { premium: true }).total, 0, 'sin tabla no hay premium, pero tampoco error');
  assert.equal(getVtuberBySlug(lectura, 'madkoding').premium, null);
  lectura.close();
});

test('HTTP: el mantenedor asigna y quita el premium y el filtro público lo refleja', async () => {
  const asignar = await admin('PATCH', `/vtubers/${idDe('otra')}`, { premium: { grade: '9' } });
  assert.equal(asignar.status, 200);
  const detalle = await asignar.json();
  assert.equal(detalle.premium.grade, '9');
  assert.match(detalle.premium.since, /^\d{4}-\d{2}-\d{2}$/);

  const publico = await (await fetch(`${baseUrl}/api/vtubers?premium=1`)).json();
  assert.deepEqual(publico.items.map((item) => item.slug).sort(), ['madkoding', 'otra']);

  const soloAdmin = await (await admin('GET', '/vtubers?premium=1')).json();
  assert.equal(soloAdmin.total, 2);

  const quitar = await admin('PATCH', `/vtubers/${idDe('otra')}`, { premium: null });
  assert.equal(quitar.status, 200);
  assert.equal((await quitar.json()).premium, null);
  assert.equal((await (await fetch(`${baseUrl}/api/vtubers?premium=1`)).json()).total, 1);
});

test('HTTP: una ficha en grado 1 da 404 al público pero el mantenedor sigue pudiendo verla y editarla', async () => {
  const id = idDe('otra');
  assert.equal((await admin('PATCH', `/vtubers/${id}`, { premium: { grade: '1' } })).status, 200);
  try {
    // Público: sin página, sin datos.
    assert.equal((await fetch(`${baseUrl}/api/vtubers/otra`)).status, 404);
    const listado = await (await fetch(`${baseUrl}/api/vtubers?perPage=100`)).json();
    assert.ok(!JSON.stringify(listado).includes('"Otra"'), 'el nombre real no sale en el listado público');

    // Mantenedor: la ficha sigue ahí, entera.
    const detalle = await admin('GET', `/vtubers/${id}`);
    assert.equal(detalle.status, 200);
    assert.equal((await detalle.json()).name, 'Otra');
    assert.ok((await (await admin('GET', '/vtubers?q=otra')).json()).items.some((i) => i.name === 'Otra'), 'aparece en su listado');

    // Y se puede seguir editando.
    const editada = await admin('PATCH', `/vtubers/${id}`, { phrase: 'sigue editable' });
    assert.equal(editada.status, 200);
    const cuerpo = await editada.json();
    assert.equal(cuerpo.name, 'Otra');
    assert.equal(cuerpo.phrase, 'sigue editable');
    assert.equal(cuerpo.premium.grade, '1');
  } finally {
    await admin('PATCH', `/vtubers/${id}`, { premium: null, phrase: null });
  }
  assert.equal((await fetch(`${baseUrl}/api/vtubers/otra`)).status, 200, 'al quitar el grado vuelve a tener página');
});

test('HTTP: un grado inválido da 400 y no toca la ficha', async () => {
  const respuesta = await admin('PATCH', `/vtubers/${idDe('otra')}`, { premium: { grade: '11' } });
  assert.equal(respuesta.status, 400);
  assert.equal((await respuesta.json()).error, 'payload_invalido');
  const consulta = await fetch(`${baseUrl}/api/vtubers?premium=quizas`);
  assert.equal(consulta.status, 400);
});

test('rachaDe: cuenta meses seguidos, se apaga si se rompe y no caduca en lo alto', async () => {
  const { rachaDe } = await import('../src/premium.mjs');
  assert.equal(rachaDe({ grade: '9', since: '2026-07-10', gradedAt: '2026-09-12' }, '2026-09-20'), 3);
  assert.equal(rachaDe({ grade: '8', since: '2026-09-10', gradedAt: '2026-09-10' }, '2026-09-20'), 0, 'un mes no es racha');
  assert.equal(rachaDe({ grade: '9', since: '2026-05-10', gradedAt: '2026-07-12' }, '2026-10-04'), 0, 'rota');
  assert.equal(rachaDe({ grade: '10', since: '2026-05-10', gradedAt: '2026-09-12' }, '2027-03-01'), 5, 'en el 10 no caduca');
  assert.equal(rachaDe({ grade: '3', since: '2026-01-01', gradedAt: '2026-09-01' }, '2026-09-20'), 0, 'degradada');
});

test('desgasteLeveDeGrado: la carta suelta lleva el máximo y baja hasta 0 en el 8; las degradadas no usan este camino', async () => {
  const { desgasteLeveDeGrado, DONACION_POR_GRADO } = await import('../src/premium.mjs');
  assert.equal(desgasteLeveDeGrado(null), 1);
  const leves = ['6', '6.5', '7', '7.5'].map(desgasteLeveDeGrado);
  leves.slice(1).forEach((v, i) => assert.ok(v < leves[i]));
  assert.ok(leves[0] < 1);
  for (const g of ['8', '10', 'BL', '3']) assert.equal(desgasteLeveDeGrado(g), 0, g);
  const montos = GRADOS.filter((g) => g !== 'BL').map((g) => DONACION_POR_GRADO[g]);
  montos.slice(1).forEach((m, i) => assert.ok(m > montos[i], 'cada grado pide más que el anterior'));
  assert.equal(DONACION_POR_GRADO['9.5'], 20);
  assert.equal(DONACION_POR_GRADO.BL, null);
});
