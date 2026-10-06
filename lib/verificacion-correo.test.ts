/**
 * Correo de confirmación y enlace mágico: de punta a punta, con Turso falso (SQLite en memoria) y un
 * transporte de correo falso que guarda lo que se «enviaría». Lo que se fija aquí es lo que ninguna
 * otra suite ve: que una solicitud NO llega a la cola sin confirmar el correo, que cada enlace sirve
 * UNA vez, que una baja solo se aplica sola con el correo del titular y que el enlace del mantenedor
 * no revela quién es admin.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

import { TERMINOS_VERSION } from '@/server/src/terminos-version.mjs';

const turso = new DatabaseSync(':memory:');
const clienteFalso = {
  execute: async (arg: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof arg === 'string' ? arg : arg.sql;
    const args = (typeof arg === 'string' ? [] : (arg.args ?? [])) as never[];
    const sentencia = turso.prepare(sql);
    if (/^\s*(select|pragma)/i.test(sql)) return { rows: sentencia.all(...args).map((f) => ({ ...f })), rowsAffected: 0 };
    const info = sentencia.run(...args);
    return { rows: [], rowsAffected: Number(info.changes), lastInsertRowid: BigInt(info.lastInsertRowid) };
  },
  executeMultiple: async (sql: string) => {
    turso.exec(sql);
  },
  batch: async () => ({}),
};
vi.mock('@libsql/client/node', () => ({ createClient: () => clienteFalso }));

const DATASET = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  vtubers: [
    { dexNumber: 18, slug: 'gkuro', name: 'GKuro', countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }], languages: ['es'], groups: [], artists: [], source: { hasDetail: true }, assets: {}, detail: { phrase: 'hola', profile: [], factions: [], stats: {}, skills: [], socials: [] } },
    { dexNumber: 30, slug: 'drawchii', name: 'Drawchii', countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }], languages: ['es'], groups: [], artists: [], source: { hasDetail: false }, assets: {}, detail: null },
  ],
};

let dir: string;
type Correos = typeof import('@/lib/correo.mjs');
let correo: Correos;
let sol: typeof import('@/lib/solicitudes.mjs');
let nucleo: typeof import('@/server/src/solicitudes.mjs');
let ver: typeof import('@/server/src/verificacion.mjs');
let enlace: typeof import('@/lib/admin-enlace.mjs');
let auth: typeof import('@/lib/admin-auth.mjs');
let diario: typeof import('@/lib/diario.mjs');
let buscar: typeof import('@/server/src/search.mjs');

const enviados: Array<{ to: string; subject: string; text: string }> = [];
let fallaElCorreo = false;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-verif-'));
  const dbPath = path.join(dir, 'catalogo.db');
  const { openDatabase } = await import('@/server/src/db/index.mjs');
  const { seedDatabase } = await import('@/server/src/seed.mjs');
  const db = openDatabase(dbPath);
  seedDatabase({ db, dataset: DATASET });
  db.close();
  process.env.VTUBERDEX_DB = dbPath;
  process.env.TURSO_DATABASE_URL = 'http://turso-de-mentira';
  process.env.TURSO_AUTH_TOKEN = 'no-hace-falta';
  process.env.SITE_URL = 'https://vtuberdex.test';
});

afterAll(() => {
  diario.reiniciarDiario();
  fs.rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  turso.exec('DROP TABLE IF EXISTS solicitud; DROP TABLE IF EXISTS ficha_correo; DROP TABLE IF EXISTS token_correo; DROP TABLE IF EXISTS borrador; DROP TABLE IF EXISTS cambio; DROP TABLE IF EXISTS sesion_admin; DROP TABLE IF EXISTS edicion; DROP TABLE IF EXISTS asset_remoto;');
  enviados.length = 0;
  fallaElCorreo = false;
  vi.resetModules();
  correo = await import('@/lib/correo.mjs');
  correo.__usarTransporte({
    sendMail: async (m: { to: string; subject: string; text: string }) => {
      if (fallaElCorreo) throw new Error('buzón inexistente');
      enviados.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    },
  });
  sol = await import('@/lib/solicitudes.mjs');
  nucleo = await import('@/server/src/solicitudes.mjs');
  ver = await import('@/server/src/verificacion.mjs');
  enlace = await import('@/lib/admin-enlace.mjs');
  auth = await import('@/lib/admin-auth.mjs');
  diario = await import('@/lib/diario.mjs');
  buscar = await import('@/server/src/search.mjs');
  enlace.__reiniciarLimiteDeRed();
  // Las tablas se crean al primer uso: se fuerzan aquí para poder tocarlas directamente en los tests.
  const e = await sol.ejecutorDeSolicitudes();
  await nucleo.listarSolicitudes(e);
  await ver.envioPermitido(e, { email: 'x@x.cl', proposito: 'solicitud' });
  await (await import('@/server/src/borradores.mjs')).leerBorrador(e, { email: 'x@x.cl' });
  // Modificación y baja exigen que el correo ya tenga una ficha: estos correos de los tests la tienen.
  for (const [id, email] of [[9001, 'luna@example.com'], [9002, 'otra@example.com'], [9003, 'titular@example.com']] as const) {
    await nucleo.fijarCorreoDeFicha(e, id, email);
  }
});

const peticion = (cuerpo: unknown, metodo = 'POST') =>
  new Request('http://localhost/api/x', { method: metodo, headers: { 'content-type': 'application/json', host: 'localhost' }, body: JSON.stringify(cuerpo) });

const baseBaja = (extra: Record<string, unknown> = {}) => ({
  email: 'titular@example.com',
  aceptaTerminos: true,
  terminosVersion: TERMINOS_VERSION,
  ...extra,
});

const inscripcion = (extra: Record<string, unknown> = {}) => ({
  name: 'Luna Test', email: 'luna@example.com', country: 'chile', languages: ['es'], phrase: 'Hola', cardText: 'Una historia', height: '1,60 m',
  birthday: '12 de marzo', favoriteFood: 'a', dislikedFood: 'b', favoriteGame: 'c', favoriteSeries: 'd', favoriteMusic: 'e', favoriteAnime: 'f',
  favoriteAnimal: 'g', favoriteColor: 'h', modeler: 'Riko', hashtag: '#x', imageUrl: 'https://i.test/a.png', logoUrl: 'https://i.test/b.png',
  socials: [{ platform: 'Twitch', url: 'https://twitch.tv/luna' }], aceptaTerminos: true, terminosVersion: TERMINOS_VERSION, ...extra,
});

const tokenDe = (texto: string, clave: 't' | 'entrar') => texto.match(new RegExp(`#${clave}=([\\w-]+)`))![1];
const estadoDe = (id: number) => (turso.prepare('SELECT estado FROM solicitud WHERE id = ?').get(id) as { estado: string } | undefined)?.estado;

describe('confirmar el correo de una baja (el mismo mecanismo de las solicitudes que se envían primero)', () => {
  test('entra sin verificar, el correo lleva el enlace con el token en el fragmento y solo al confirmarlo llega a la cola', async () => {
    const respuesta = await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    expect(respuesta.status).toBe(201);
    expect(await respuesta.json()).toEqual({ ok: true, estado: 'sin_verificar' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('luna@example.com');
    expect(enviados[0].text).toContain('https://vtuberdex.test/verificar#t=');

    // El mantenedor no la ve todavía.
    const e = await sol.ejecutorDeSolicitudes();
    expect((await nucleo.listarSolicitudes(e)).items).toHaveLength(0);
    expect(estadoDe(1)).toBe('sin_verificar');

    const token = tokenDe(enviados[0].text, 't');
    const confirmada = await sol.confirmarVerificacion(token);
    expect(confirmada).toMatchObject({ status: 200, cuerpo: { ok: true, tipo: 'baja', resultado: 'sin_ficha' } });
    expect((await nucleo.listarSolicitudes(e)).items).toHaveLength(1);
  });

  test('el enlace sirve UNA vez, y un token inventado o ajeno no sirve', async () => {
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    const token = tokenDe(enviados[0].text, 't');
    expect((await sol.confirmarVerificacion(token)).status).toBe(200);
    expect((await sol.confirmarVerificacion(token)).status).toBe(410);
    expect((await sol.confirmarVerificacion('x'.repeat(43))).status).toBe(410);
    expect((await sol.confirmarVerificacion('')).status).toBe(410);
  });

  test('en la base solo queda el hash del token, nunca el token', async () => {
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    const token = tokenDe(enviados[0].text, 't');
    const filas = turso.prepare('SELECT * FROM token_correo').all();
    expect(JSON.stringify(filas)).not.toContain(token);
  });

  test('un token caducado no sirve', async () => {
    const e = await sol.ejecutorDeSolicitudes();
    const token = await ver.crearToken(e, { proposito: 'solicitud', email: 'a@x.cl', solicitudId: 1, ahora: Date.now() - 25 * 60 * 60 * 1000 });
    expect(await ver.consumirToken(e, token, 'solicitud')).toBeNull();
  });

  test('un token de acceso no confirma solicitudes ni al revés', async () => {
    const e = await sol.ejecutorDeSolicitudes();
    const token = await ver.crearToken(e, { proposito: 'admin', email: 'madkoding@gmail.com' });
    expect(await ver.consumirToken(e, token, 'solicitud')).toBeNull();
    expect(await ver.consumirToken(e, token, 'admin')).toMatchObject({ email: 'madkoding@gmail.com' });
  });

  test('pedir otro correo enseguida se rechaza y NO borra la solicitud que ya tiene su correo en camino', async () => {
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    const segundo = await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    expect(segundo.status).toBe(429);
    expect(enviados).toHaveLength(1);
    expect(estadoDe(1)).toBe('sin_verificar');
    expect((await sol.confirmarVerificacion(tokenDe(enviados[0].text, 't'))).status).toBe(200);
  });

  test('reenviar pasado el tiempo de espera REEMPLAZA la anterior: el enlace viejo ya no sirve', async () => {
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    turso.exec('UPDATE token_correo SET creado = creado - 120000');
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    expect(enviados).toHaveLength(2);
    expect((await sol.confirmarVerificacion(tokenDe(enviados[0].text, 't'))).status).toBe(410);
    expect((await sol.confirmarVerificacion(tokenDe(enviados[1].text, 't'))).status).toBe(200);
    expect(turso.prepare("SELECT COUNT(*) n FROM solicitud").get()).toEqual({ n: 1 });
  });

  test('tope diario por correo', async () => {
    for (let i = 0; i < ver.MAX_ENVIOS_POR_CORREO_Y_DIA; i += 1) {
      turso.exec('UPDATE token_correo SET creado = creado - 120000');
      expect((await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja')).status).toBe(201);
    }
    turso.exec('UPDATE token_correo SET creado = creado - 120000');
    const respuesta = await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    expect(respuesta.status).toBe(429);
    expect((await respuesta.json()).detail).toMatch(/máximo/);
  });

  test('si el correo no se puede enviar, la solicitud no queda colgada y se avisa', async () => {
    fallaElCorreo = true;
    const respuesta = await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    expect(respuesta.status).toBe(503);
    expect((await respuesta.json()).error).toBe('correo_no_disponible');
    expect(turso.prepare('SELECT COUNT(*) n FROM solicitud').get()).toEqual({ n: 0 });
  });

  test('una solicitud sin confirmar no se puede resolver desde el mantenedor', async () => {
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'luna@example.com' })), 'baja');
    const e = await sol.ejecutorDeSolicitudes();
    await expect(nucleo.resolverSolicitud(e, 1, { estado: 'procesada' })).rejects.toMatchObject({ code: 'ya_resuelta' });
  });
});

describe('la baja por correo', () => {
  /** Una inscripción ya aprobada de `slug`, con el correo del titular guardado. */
  const inscripcionAprobada = (email: string, slug = 'gkuro') =>
    turso
      .prepare(
        `INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado, vtuber_slug)
         VALUES ('inscripcion', 'aprobada', '{}', ?, 'r', 'v', 'f', 'f', ?)`,
      )
      .run(JSON.stringify({ email }), slug);

  const gradoDe = async (slug: string) => {
    const f = buscar.getVtuberBySlug(await diario.dbConDiario(), slug, { includeHidden: true }) as { premium: { grade: string } | null };
    return f.premium?.grade ?? null;
  };
  const bajaDe = () => turso.prepare("SELECT estado, contacto, resuelto_por FROM solicitud WHERE tipo = 'baja'").get() as Record<string, unknown>;
  const confirmarUltimo = () => sol.confirmarVerificacion(tokenDe(enviados.at(-1)!.text, 't'));

  test('solo con el correo (sin escribir la ficha) la ficha asociada pasa al grado 1 y se borran los contactos', async () => {
    inscripcionAprobada('titular@example.com');
    await sol.recibirSolicitud(peticion(baseBaja()), 'baja');
    const resultado = await confirmarUltimo();
    expect(resultado.cuerpo).toMatchObject({ ok: true, tipo: 'baja', resultado: 'baja_aplicada', fichas: ['GKuro'] });
    expect(await gradoDe('gkuro')).toBe('1');
    expect(bajaDe()).toMatchObject({ estado: 'procesada', contacto: null, resuelto_por: 'baja-verificada' });
    expect(turso.prepare("SELECT contacto FROM solicitud WHERE tipo = 'inscripcion'").get()).toEqual({ contacto: null });
  });

  test('el correo de la baja lleva también el código para pegarlo en la página', async () => {
    inscripcionAprobada('titular@example.com');
    await sol.recibirSolicitud(peticion(baseBaja()), 'baja');
    const token = tokenDe(enviados[0].text, 't');
    expect(enviados[0].text).toContain(`O pega este código en la página de baja:\n${token}`);
  });

  test('con varias fichas inscritas con el mismo correo y sin ficha escrita, se dan de baja todas y se dicen', async () => {
    inscripcionAprobada('titular@example.com', 'gkuro');
    inscripcionAprobada('titular@example.com', 'drawchii');
    await sol.recibirSolicitud(peticion(baseBaja()), 'baja');
    const resultado = await confirmarUltimo();
    expect(resultado.cuerpo).toMatchObject({ resultado: 'baja_aplicada', fichas: ['GKuro', 'Drawchii'] });
    expect(await gradoDe('gkuro')).toBe('1');
    expect(await gradoDe('drawchii')).toBe('1');
  });

  test('si escribe una de ellas, solo esa', async () => {
    inscripcionAprobada('titular@example.com', 'gkuro');
    inscripcionAprobada('titular@example.com', 'drawchii');
    await sol.recibirSolicitud(peticion(baseBaja({ ficha: '/v/drawchii' })), 'baja');
    const resultado = await confirmarUltimo();
    expect(resultado.cuerpo).toMatchObject({ resultado: 'baja_aplicada', fichas: ['Drawchii'] });
    expect(await gradoDe('drawchii')).toBe('1');
    expect(await gradoDe('gkuro')).toBeNull();
  });

  test('una ficha escrita que NO es del correo no se toca (ni se baja la que sí lo es)', async () => {
    inscripcionAprobada('titular@example.com', 'gkuro');
    await sol.recibirSolicitud(peticion(baseBaja({ ficha: '/v/drawchii' })), 'baja');
    const resultado = await confirmarUltimo();
    expect(resultado.cuerpo).toMatchObject({ resultado: 'en_revision' });
    expect(await gradoDe('drawchii')).toBeNull();
    expect(await gradoDe('gkuro')).toBeNull();
    expect(bajaDe()).toMatchObject({ estado: 'pendiente' });
  });

  test('un correo sin fichas y sin ficha escrita: no se aplica nada y queda pendiente para escribirle', async () => {
    inscripcionAprobada('titular@example.com');
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'otra@example.com' })), 'baja');
    const resultado = await confirmarUltimo();
    expect(resultado.cuerpo).toMatchObject({ ok: true, tipo: 'baja', resultado: 'sin_ficha' });
    expect(await gradoDe('gkuro')).toBeNull();
    expect(bajaDe()).toMatchObject({ estado: 'pendiente' });
  });

  test('una ficha del scrape (sin correo guardado) escrita a mano queda para una persona', async () => {
    await sol.recibirSolicitud(peticion(baseBaja({ ficha: '/v/drawchii' })), 'baja');
    const resultado = await confirmarUltimo();
    expect(resultado.cuerpo).toMatchObject({ resultado: 'en_revision' });
    expect(await gradoDe('drawchii')).toBeNull();
  });

  test('el correo escrito no cambia mayúsculas: se compara normalizado', async () => {
    inscripcionAprobada('titular@example.com');
    await sol.recibirSolicitud(peticion(baseBaja({ email: 'Titular@Example.com' })), 'baja');
    expect((await confirmarUltimo()).cuerpo).toMatchObject({ resultado: 'baja_aplicada' });
  });
});

describe('enlace mágico del mantenedor', () => {
  test('un admin recibe el enlace y entra una sola vez; la sesión lleva su correo', async () => {
    const acuse = await enlace.pedirEnlaceDeAcceso({ email: 'MadKoding@gmail.com', ip: '1.1.1.1' }, { esperar: true });
    expect(acuse).toEqual({ status: 200, cuerpo: { ok: true } });
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('madkoding@gmail.com');
    expect(enviados[0].text).toContain('https://vtuberdex.test/admin#entrar=');

    const token = tokenDe(enviados[0].text, 'entrar');
    const entrada = await enlace.entrarConEnlace(token);
    expect(entrada.status).toBe(200);
    const sesion = (entrada.cuerpo as { token: string }).token;
    expect(await auth.leerSesion(sesion)).toEqual({ username: 'madkoding@gmail.com', role: 'admin' });
    expect((await enlace.entrarConEnlace(token)).status).toBe(410);
  });

  test('el otro admin de la lista también', async () => {
    await enlace.pedirEnlaceDeAcceso({ email: 'ritcher.recomienda@gmail.com', ip: '1.1.1.1' }, { esperar: true });
    expect(enviados[0]?.to).toBe('ritcher.recomienda@gmail.com');
  });

  test('un correo que no es admin recibe la MISMA respuesta y no se le envía nada', async () => {
    const acuse = await enlace.pedirEnlaceDeAcceso({ email: 'intruso@example.com', ip: '1.1.1.1' }, { esperar: true });
    expect(acuse).toEqual({ status: 200, cuerpo: { ok: true } });
    expect(enviados).toHaveLength(0);
    expect(turso.prepare('SELECT COUNT(*) n FROM token_correo').get()).toEqual({ n: 0 });
  });

  test('un enlace de acceso de alguien que ya no es admin no entra', async () => {
    const e = await sol.ejecutorDeSolicitudes();
    const token = await ver.crearToken(e, { proposito: 'admin', email: 'intruso@example.com' });
    expect((await enlace.entrarConEnlace(token)).status).toBe(410);
  });

  test('VTUBERDEX_ADMIN_EMAILS reemplaza la lista', async () => {
    const lista = enlace.correosDeAdmin({ VTUBERDEX_ADMIN_EMAILS: ' Otro@x.cl , ' } as never);
    expect(lista).toEqual(['otro@x.cl']);
  });

  test('un token de solicitud no abre sesión', async () => {
    const e = await sol.ejecutorDeSolicitudes();
    const token = await ver.crearToken(e, { proposito: 'solicitud', email: 'madkoding@gmail.com', solicitudId: 1 });
    expect((await enlace.entrarConEnlace(token)).status).toBe(410);
  });

  test('freno por red: a la décima petición seguida responde 429', async () => {
    for (let i = 0; i < 10; i += 1) expect((await enlace.pedirEnlaceDeAcceso({ email: 'x@x.cl', ip: '5.5.5.5' }, { esperar: true })).status).toBe(200);
    expect((await enlace.pedirEnlaceDeAcceso({ email: 'x@x.cl', ip: '5.5.5.5' }, { esperar: true })).status).toBe(429);
  });

  test('un correo mal formado es 400', async () => {
    expect((await enlace.pedirEnlaceDeAcceso({ email: 'no-es-un-correo', ip: '1.1.1.1' })).status).toBe(400);
  });
});

describe('inscripción: código, sesión y borrador', () => {
  const pedir = (email = 'luna@example.com', extra: Record<string, unknown> = {}) => sol.pedirCodigo(peticion({ email, ...extra }), 'inscripcion');
  const canjear = (token: string) => sol.verificarCodigo(peticion({ token }), 'inscripcion');
  const guardar = (sesion: string, datos: Record<string, unknown>) => sol.guardarBorradorDeInscripcion(peticion({ sesion, datos }, 'PUT'));
  /** Pide el código, lo canjea y devuelve la sesión. */
  const entrar = async (email = 'luna@example.com') => {
    await pedir(email);
    const resultado = await (await canjear(tokenDe(enviados.at(-1)!.text, 't'))).json();
    return resultado as { sesion: string; borrador: { datos: Record<string, unknown>; actualizado: string } | null };
  };
  const solicitudes = () => turso.prepare("SELECT tipo, estado, contacto FROM solicitud WHERE tipo = 'inscripcion'").all();

  test('pedir el código manda el correo con el enlace al formulario y NO guarda ninguna solicitud', async () => {
    expect((await pedir()).status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].text).toContain('https://vtuberdex.test/inscripcion#t=');
    expect(enviados[0].text).toMatch(/O pega este código en el formulario de inscripción/);
    expect(solicitudes()).toHaveLength(0);
  });

  test('el código se canjea UNA vez por una sesión; sin borrador previo no trae nada', async () => {
    await pedir();
    const token = tokenDe(enviados[0].text, 't');
    const primero = await canjear(token);
    expect(primero.status).toBe(200);
    expect(await primero.json()).toMatchObject({ ok: true, borrador: null });
    expect((await canjear(token)).status).toBe(410);
  });

  test('el campo trampa, un correo malo y el tope por correo', async () => {
    expect((await pedir('luna@example.com', { website: 'http://spam' })).status).toBe(200);
    expect(enviados).toHaveLength(0);
    expect((await pedir('no-es-correo')).status).toBe(400);
    expect((await pedir()).status).toBe(200);
    expect((await pedir()).status).toBe(429);
    expect(enviados).toHaveLength(1);
  });

  test('un código de cambios de ficha no abre una sesión de inscripción', async () => {
    await sol.pedirCodigo(peticion({ email: 'luna@example.com' }), 'modificacion');
    expect((await canjear(tokenDe(enviados[0].text, 't'))).status).toBe(410);
  });

  test('guardar el borrador exige sesión, se puede repetir y solo guarda los campos del formulario', async () => {
    const { sesion } = await entrar();
    const primera = await guardar(sesion, { name: 'Luna', phrase: 'Hola', paso: 4, intruso: 'x', email: 'otro@x.cl', aceptaTerminos: true, website: 'bot' });
    expect(primera.status).toBe(200);
    expect((await guardar(sesion, { name: 'Luna', phrase: 'Hola de nuevo', paso: 3 })).status).toBe(200);
    const fila = turso.prepare('SELECT email, datos FROM borrador').get() as { email: string; datos: string };
    expect(fila.email).toBe('luna@example.com');
    const datos = JSON.parse(fila.datos);
    expect(datos).toMatchObject({ name: 'Luna', phrase: 'Hola de nuevo', paso: 3 });
    for (const sobra of ['intruso', 'email', 'aceptaTerminos', 'website']) expect(datos).not.toHaveProperty(sobra);
    expect(turso.prepare('SELECT COUNT(*) n FROM borrador').get()).toEqual({ n: 1 });
  });

  test('sin sesión válida no se guarda nada', async () => {
    expect((await guardar('x'.repeat(43), { name: 'Luna' })).status).toBe(410);
    expect((await guardar('', { name: 'Luna' })).status).toBe(410);
    const e = await sol.ejecutorDeSolicitudes();
    const permiso = await ver.crearToken(e, { proposito: 'permiso', email: 'luna@example.com' });
    expect((await guardar(permiso, { name: 'Luna' })).status).toBe(410);
    expect(turso.prepare('SELECT COUNT(*) n FROM borrador').get()).toEqual({ n: 0 });
  });

  test('un borrador enorme se rechaza', async () => {
    const { sesion } = await entrar();
    const respuesta = await guardar(sesion, { name: 'x', socials: Array.from({ length: 10 }, () => ({ platform: 'a'.repeat(40), url: 'u'.repeat(500) })), cardText: 'y'.repeat(4000), phrase: 'z'.repeat(600) });
    expect(respuesta.status).toBe(200); // lo máximo permitido por los límites de campo cabe
  });

  test('volver con el mismo correo y un código nuevo recupera lo guardado, y otro correo no ve nada', async () => {
    const primera = await entrar();
    await guardar(primera.sesion, { name: 'Luna', phrase: 'Frase guardada', cardText: 'Lore', socials: [{ platform: 'Twitch', url: 'https://twitch.tv/luna' }], languages: ['es'], paso: 4 });
    turso.exec('UPDATE token_correo SET creado = creado - 120000');
    const segunda = await entrar();
    expect(segunda.sesion).not.toBe(primera.sesion);
    expect(segunda.borrador?.datos).toMatchObject({ name: 'Luna', phrase: 'Frase guardada', cardText: 'Lore', languages: ['es'], paso: 4 });
    expect(segunda.borrador?.datos.socials).toEqual([{ platform: 'Twitch', url: 'https://twitch.tv/luna' }]);
    const ajena = await entrar('otra@example.com');
    expect(ajena.borrador).toBeNull();
  });

  test('un borrador de hace más de 60 días ya no se recupera', async () => {
    const { sesion } = await entrar();
    await guardar(sesion, { name: 'Luna' });
    turso.exec("UPDATE borrador SET actualizado = '2026-01-01T00:00:00.000Z'");
    turso.exec('UPDATE token_correo SET creado = creado - 120000');
    expect((await entrar()).borrador).toBeNull();
  });

  test('enviar con la sesión crea la solicitud pendiente con el correo VERIFICADO, borra el borrador y gasta la sesión', async () => {
    const { sesion } = await entrar();
    await guardar(sesion, { name: 'Luna', paso: 4 });
    const respuesta = await sol.recibirSolicitud(peticion(inscripcion({ sesion, email: 'suplantado@example.com' })), 'inscripcion');
    expect(respuesta.status).toBe(201);
    expect(await respuesta.json()).toEqual({ ok: true, estado: 'pendiente' });
    expect(enviados).toHaveLength(1); // solo el código: no hay segundo correo
    const filas = solicitudes() as Array<{ estado: string; contacto: string }>;
    expect(filas).toHaveLength(1);
    expect(filas[0].estado).toBe('pendiente');
    expect(JSON.parse(filas[0].contacto)).toEqual({ email: 'luna@example.com' });
    expect(turso.prepare('SELECT COUNT(*) n FROM borrador').get()).toEqual({ n: 0 });
    const e = await sol.ejecutorDeSolicitudes();
    expect((await nucleo.listarSolicitudes(e)).items).toHaveLength(1);
    // La sesión ya está gastada.
    expect((await sol.recibirSolicitud(peticion(inscripcion({ sesion })), 'inscripcion')).status).toBe(410);
  });

  test('un envío inválido NO gasta la sesión: se corrige y se vuelve a enviar', async () => {
    const { sesion } = await entrar();
    const mala = await sol.recibirSolicitud(peticion(inscripcion({ sesion, cardText: '' })), 'inscripcion');
    expect(mala.status).toBe(400);
    const sinTerminos = await sol.recibirSolicitud(peticion(inscripcion({ sesion, aceptaTerminos: false })), 'inscripcion');
    expect(sinTerminos.status).toBe(400);
    expect((await sol.recibirSolicitud(peticion(inscripcion({ sesion })), 'inscripcion')).status).toBe(201);
  });

  test('sin sesión, con una caducada o con otra credencial, no entra nada a la cola', async () => {
    expect((await sol.recibirSolicitud(peticion(inscripcion()), 'inscripcion')).status).toBe(400);
    expect((await sol.recibirSolicitud(peticion(inscripcion({ sesion: 'z'.repeat(43) })), 'inscripcion')).status).toBe(410);
    const e = await sol.ejecutorDeSolicitudes();
    const permiso = await ver.crearToken(e, { proposito: 'permiso', email: 'luna@example.com' });
    expect((await sol.recibirSolicitud(peticion(inscripcion({ sesion: permiso })), 'inscripcion')).status).toBe(410);
    expect(solicitudes()).toHaveLength(0);
  });

  test('un solo pendiente por correo: la segunda inscripción con el mismo correo se rechaza', async () => {
    const { sesion } = await entrar();
    await sol.recibirSolicitud(peticion(inscripcion({ sesion })), 'inscripcion');
    turso.exec('UPDATE token_correo SET creado = creado - 120000');
    const otra = await entrar();
    const repetida = await sol.recibirSolicitud(peticion(inscripcion({ sesion: otra.sesion })), 'inscripcion');
    expect(repetida.status).toBe(409);
    expect(solicitudes()).toHaveLength(1);
  });
});

describe('cambios de ficha: código y permiso', () => {
  const pedir = (email = 'titular@example.com') => sol.pedirCodigo(peticion({ email }), 'modificacion');
  const canjear = async (email = 'titular@example.com') => {
    await pedir(email);
    return (await (await sol.verificarCodigo(peticion({ token: tokenDe(enviados.at(-1)!.text, 't') }), 'modificacion')).json()) as {
      permiso: string;
      fichas: Array<{ slug: string; name: string }>;
    };
  };
  const cambios = (extra: Record<string, unknown> = {}) => ({ ficha: 'gkuro', height: '1,70 m', aceptaTerminos: true, terminosVersion: TERMINOS_VERSION, ...extra });
  const filas = () => turso.prepare("SELECT estado, contacto FROM solicitud WHERE tipo = 'modificacion'").all() as Array<{ estado: string; contacto: string }>;

  test('el correo lleva el código y el enlace que abre el formulario de cambios', async () => {
    await pedir();
    expect(enviados[0].text).toContain('https://vtuberdex.test/modificacion#t=');
    expect(enviados[0].text).toMatch(/O pega este código en el formulario de actualización/);
  });

  test('sin fichas inscritas con ese correo, el permiso viene con la lista vacía; con una, trae su nombre', async () => {
    expect((await canjear()).fichas).toEqual([]);
    await sol.ejecutorDeSolicitudes();
    turso
      .prepare(
        `INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado, vtuber_slug)
         VALUES ('inscripcion', 'aprobada', '{}', ?, 'r', 'v', 'f', 'f', 'gkuro')`,
      )
      .run(JSON.stringify({ email: 'titular@example.com' }));
    turso.exec('UPDATE token_correo SET creado = creado - 120000');
    expect((await canjear()).fichas).toEqual([{ slug: 'gkuro', name: 'GKuro' }]);
  });

  test('enviar con el permiso crea la solicitud pendiente con el correo verificado y gasta el permiso', async () => {
    const { permiso } = await canjear();
    const respuesta = await sol.recibirSolicitud(peticion(cambios({ permiso, email: 'suplantado@example.com' })), 'modificacion');
    expect(respuesta.status).toBe(201);
    expect(await respuesta.json()).toEqual({ ok: true, estado: 'pendiente' });
    expect(enviados).toHaveLength(1);
    expect(filas()).toHaveLength(1);
    expect(filas()[0].estado).toBe('pendiente');
    expect(JSON.parse(filas()[0].contacto)).toEqual({ email: 'titular@example.com' });
    expect((await sol.recibirSolicitud(peticion(cambios({ permiso })), 'modificacion')).status).toBe(410);
  });

  test('sin permiso no se acepta, y un error de validación no lo gasta', async () => {
    expect((await sol.recibirSolicitud(peticion(cambios()), 'modificacion')).status).toBe(400);
    const { permiso } = await canjear();
    expect((await sol.recibirSolicitud(peticion(cambios({ permiso, height: '' })), 'modificacion')).status).toBe(400);
    expect((await sol.recibirSolicitud(peticion(cambios({ permiso, aceptaTerminos: false })), 'modificacion')).status).toBe(400);
    expect((await sol.recibirSolicitud(peticion(cambios({ permiso })), 'modificacion')).status).toBe(201);
  });

  test('una sesión de inscripción no sirve de permiso para cambiar una ficha', async () => {
    const e = await sol.ejecutorDeSolicitudes();
    const sesion = await ver.crearToken(e, { proposito: 'sesion', email: 'titular@example.com' });
    expect((await sol.recibirSolicitud(peticion(cambios({ permiso: sesion })), 'modificacion')).status).toBe(410);
  });
});
