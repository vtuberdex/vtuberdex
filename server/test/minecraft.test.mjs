/** Minecraft: vínculo por código de un uso y XP de juego por lotes con tope diario, sobre SQLite en memoria. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { XP_JUEGO_MAX_DIA, XP_POR_LIKE, experienciaConLikes } from '../src/experiencia.mjs';
import {
  CODIGO_TTL_MS,
  ENVIOS,
  MinecraftError,
  XP_POR_LOTE_MAX,
  crearCodigoDeVinculo,
  desvincular,
  envioDeCodigoPermitido,
  requiereSesion,
  sesionVigente,
  SESION_DIAS,
  sumarXp,
  vincular,
  vinculoDeFicha,
  vinculoDeJugador,
  xpDeJuego,
} from '../src/minecraft.mjs';
import { ejecutorSqlite } from '../src/solicitudes.mjs';

const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const JUGADOR = '069a79f4-44e9-4726-a5be-fca90e38aaf5';
const OTRO = '61699b2e-d327-4a01-9f1e-0ea8c3f06bc6';
const DIA = '2026-10-07';
const error = async (promesa) => promesa.then(() => null, (e) => e);
const lote = (detalle, extra = {}) => ({ uuid: JUGADOR, idLote: crypto.randomUUID(), detalle, dia: DIA, ...extra });

async function vinculado(e, vtuberId = 7, uuid = JUGADOR) {
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId });
  await vincular(e, { codigo, uuid, jugador: 'Steve' });
}

test('la XP de juego se suma a la barra como la de los likes', () => {
  const soloLikes = experienciaConLikes({}, 5);
  const conJuego = experienciaConLikes({}, 5, 20);
  assert.equal(conJuego.total, soloLikes.total + 20);
  assert.equal(conJuego.current, 5 * XP_POR_LIKE + 20);
  // Valores absurdos no restan.
  assert.equal(experienciaConLikes({}, 0, -50).total, 0);
  assert.equal(experienciaConLikes({}, 0, 'x').total, 0);
  // Llena un nivel solo jugando: los niveles ganados (y con ellos los puntos) salen igual.
  assert.equal(experienciaConLikes({}, 0, 100).nivelesGanados, 1);
});

test('el código vincula una vez, normaliza lo escrito y caduca', async () => {
  const e = nuevo();
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId: 7, ahora: 1000 });
  assert.match(codigo, /^[2-9A-HJ-NP-TV-Z]{8}$/);
  const escrito = `${codigo.slice(0, 4).toLowerCase()}-${codigo.slice(4)}`;
  assert.deepEqual(await vincular(e, { codigo: escrito, uuid: JUGADOR.toUpperCase(), jugador: 'Steve', ahora: 2000 }), { vtuberId: 7 });
  assert.equal((await vinculoDeJugador(e, JUGADOR)).vtuberId, 7);
  assert.equal((await vinculoDeFicha(e, 7)).jugador, 'Steve');
  assert.equal((await error(vincular(e, { codigo, uuid: JUGADOR, ahora: 3000 }))).code, 'codigo_caducado');

  const viejo = await crearCodigoDeVinculo(e, { vtuberId: 8, ahora: 0 });
  assert.equal((await error(vincular(e, { codigo: viejo.codigo, uuid: OTRO, ahora: CODIGO_TTL_MS + 1 }))).code, 'codigo_caducado');
});

test('pedir otro código invalida el anterior', async () => {
  const e = nuevo();
  const primero = await crearCodigoDeVinculo(e, { vtuberId: 7 });
  await crearCodigoDeVinculo(e, { vtuberId: 7 });
  assert.equal((await error(vincular(e, { codigo: primero.codigo, uuid: JUGADOR }))).code, 'codigo_caducado');
});

test('una ficha, una cuenta: vincular otra reemplaza por los dos lados', async () => {
  const e = nuevo();
  await vinculado(e, 7, JUGADOR);
  await vinculado(e, 7, OTRO);
  assert.equal(await vinculoDeJugador(e, JUGADOR), null);
  assert.equal((await vinculoDeFicha(e, 7)).uuid, OTRO);
  await vinculado(e, 8, OTRO);
  assert.equal(await vinculoDeFicha(e, 7), null);
  assert.equal(await desvincular(e, { uuid: OTRO }), true);
  assert.equal(await vinculoDeFicha(e, 8), null);
});

test('entradas inválidas se rechazan con un código explicable', async () => {
  const e = nuevo();
  assert.equal((await error(vincular(e, { codigo: 'ABCDEFGH', uuid: 'no-es-uuid' }))).code, 'uuid_invalido');
  assert.equal((await error(vincular(e, { codigo: 'ABC', uuid: JUGADOR }))).code, 'codigo_invalido');
  assert.equal((await error(sumarXp(e, lote({ mob: 5 })))).code, 'sin_vinculo');
  await vinculado(e);
  assert.equal((await error(sumarXp(e, lote({ trampa: 5 })))).code, 'motivo_invalido');
  assert.equal((await error(sumarXp(e, lote({ mob: 1.5 })))).code, 'payload_invalido');
  assert.equal((await error(sumarXp(e, lote({ mob: 0 })))).code, 'payload_invalido');
  assert.equal((await error(sumarXp(e, lote({ mob: XP_POR_LOTE_MAX + 1 })))).code, 'lote_excesivo');
  assert.equal((await error(sumarXp(e, lote({ mob: 5 }, { idLote: 'x' })))).code, 'payload_invalido');
  assert.ok((await error(sumarXp(e, lote({ mob: 5 })))) === null);
  assert.ok((await error(sumarXp(e, lote({ mob: 5 }, { uuid: OTRO })))) instanceof MinecraftError);
});

test('un lote repetido no suma dos veces', async () => {
  const e = nuevo();
  await vinculado(e);
  const mismo = lote({ mob: 30, tiempo: 10 });
  const a = await sumarXp(e, mismo);
  const b = await sumarXp(e, mismo);
  assert.equal(a.sumado, 40);
  assert.equal(b.duplicado, true);
  assert.equal(await xpDeJuego(e, 7), 40);
});

test('el tope diario recorta el último lote y deja pasar al día siguiente', async () => {
  const e = nuevo();
  await vinculado(e);
  let sumado = 0;
  while (sumado < XP_JUEGO_MAX_DIA) sumado += (await sumarXp(e, lote({ mob: 70 }))).sumado;
  assert.equal(sumado, XP_JUEGO_MAX_DIA);
  const topado = await sumarXp(e, lote({ mob: 70 }));
  assert.equal(topado.sumado, 0);
  assert.equal(topado.hoy, XP_JUEGO_MAX_DIA);
  assert.equal((await sumarXp(e, lote({ mob: 70 }, { dia: '2026-10-08' }))).sumado, 70);
  assert.equal(await xpDeJuego(e, 7), XP_JUEGO_MAX_DIA + 70);
});

test('lotes concurrentes no pasan del tope', async () => {
  const e = nuevo();
  await vinculado(e);
  const resultados = await Promise.all(Array.from({ length: 10 }, () => sumarXp(e, lote({ jefe: 100 }))));
  assert.equal(resultados.reduce((s, r) => s + r.sumado, 0), XP_JUEGO_MAX_DIA);
});

test('desvincular corta la XP pero conserva la ganada', async () => {
  const e = nuevo();
  await vinculado(e);
  await sumarXp(e, lote({ logro: 50 }));
  assert.equal(await desvincular(e, { vtuberId: 7 }), true);
  assert.equal((await error(sumarXp(e, lote({ mob: 5 })))).code, 'sin_vinculo');
  assert.equal(await xpDeJuego(e, 7), 50);
});

test('un código pedido desde el juego solo lo canjea la cuenta que lo pidió', async () => {
  const e = nuevo();
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: JUGADOR });
  assert.equal((await error(vincular(e, { codigo, uuid: OTRO }))).code, 'codigo_caducado');
  assert.deepEqual(await vincular(e, { codigo, uuid: JUGADOR }), { vtuberId: 7 });
});

test('/vtd email: espera de un minuto y topes por correo y por cuenta', async () => {
  const e = nuevo();
  const t0 = 1_000_000_000;
  assert.deepEqual(await envioDeCodigoPermitido(e, { email: 'Luna@Example.com', uuid: JUGADOR, ahora: t0 }), { ok: true });
  assert.equal((await envioDeCodigoPermitido(e, { email: 'luna@example.com', uuid: JUGADOR, ahora: t0 + 1000 })).motivo, 'espera');
  for (let i = 1; i < ENVIOS.porCorreoDia; i += 1) {
    assert.equal((await envioDeCodigoPermitido(e, { email: 'luna@example.com', uuid: OTRO, ahora: t0 + i * ENVIOS.esperaMs + 1 })).ok, true);
  }
  assert.equal((await envioDeCodigoPermitido(e, { email: 'luna@example.com', uuid: OTRO, ahora: t0 + 99 * ENVIOS.esperaMs })).motivo, 'tope_correo');
  // Una cuenta que prueba correo tras correo también se topa.
  const f = nuevo();
  for (let i = 0; i < ENVIOS.porCuentaDia; i += 1) await envioDeCodigoPermitido(f, { email: `x${i}@example.com`, uuid: JUGADOR, ahora: t0 });
  assert.equal((await envioDeCodigoPermitido(f, { email: 'nuevo@example.com', uuid: JUGADOR, ahora: t0 })).motivo, 'tope_cuenta');
  // Al día siguiente vuelve a poder.
  assert.equal((await envioDeCodigoPermitido(f, { email: 'nuevo@example.com', uuid: JUGADOR, ahora: t0 + 25 * 60 * 60 * 1000 })).ok, true);
});

test('un jugador de Bedrock (Floodgate: «.» delante y UUID de Xbox) vincula y guarda su nombre', async () => {
  const e = nuevo();
  const bedrock = '00000000-0000-0000-0009-01f2a3b4c5d6';
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: bedrock });
  await vincular(e, { codigo, uuid: bedrock, jugador: '.Luna_Movil' });
  assert.equal((await vinculoDeFicha(e, 7)).jugador, '.Luna_Movil');
  assert.equal((await vinculoDeJugador(e, bedrock)).vtuberId, 7);
});

/* Cuentas sin verificar (servidor offline): UUID versión 3, derivado del nombre. */
const OFFLINE = '5c1f7a2e-9b3d-3e4f-8a1b-2c3d4e5f6a7b';
const RED_A = 'a'.repeat(32);
const RED_B = 'b'.repeat(32);

test('solo las cuentas offline (UUID v3) necesitan sesión', () => {
  assert.equal(requiereSesion(OFFLINE), true);
  assert.equal(requiereSesion(JUGADOR), false); // v4: premium verificada
  assert.equal(requiereSesion('00000000-0000-0000-0009-01f2a3b4c5d6'), false); // Floodgate (Bedrock)
});

test('offline: vincular abre sesión SOLO para esa red y vence a los SESION_DIAS', async () => {
  const e = nuevo();
  const t0 = 1_000_000_000_000;
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: OFFLINE, ahora: t0 });
  await vincular(e, { codigo, uuid: OFFLINE, red: RED_A, ahora: t0 });
  assert.equal(await sesionVigente(e, { uuid: OFFLINE, red: RED_A, ahora: t0 + 1000 }), true);
  // Alguien con el mismo nombre (mismo UUID) desde otra red: no tiene sesión.
  assert.equal(await sesionVigente(e, { uuid: OFFLINE, red: RED_B, ahora: t0 + 1000 }), false);
  assert.equal(await sesionVigente(e, { uuid: OFFLINE, red: RED_A, ahora: t0 + SESION_DIAS * 86_400_000 + 1 }), false);
  // El vínculo sigue guardado: vuelve a pedir el código y entra sin perder la ficha.
  assert.equal((await vinculoDeJugador(e, OFFLINE)).vtuberId, 7);
});

test('offline sin red: no se gasta el código', async () => {
  const e = nuevo();
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: OFFLINE });
  assert.equal((await error(vincular(e, { codigo, uuid: OFFLINE }))).code, 'falta_red');
  assert.deepEqual(await vincular(e, { codigo, uuid: OFFLINE, red: RED_A }), { vtuberId: 7 });
});

test('desvincular borra también las sesiones', async () => {
  const e = nuevo();
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: OFFLINE });
  await vincular(e, { codigo, uuid: OFFLINE, red: RED_A });
  await desvincular(e, { vtuberId: 7 });
  assert.equal(await sesionVigente(e, { uuid: OFFLINE, red: RED_A }), false);
});

test('/vtd email: tope por red aunque se cambie de nombre (cuenta) y de correo', async () => {
  const e = nuevo();
  const t0 = 2_000_000_000_000;
  for (let i = 0; i < ENVIOS.porRedDia; i += 1) {
    const uuid = `5c1f7a2e-9b3d-3e4f-8a1b-${String(i).padStart(12, '0')}`;
    assert.equal((await envioDeCodigoPermitido(e, { email: `n${i}@example.com`, uuid, red: RED_A, ahora: t0 })).ok, true);
  }
  assert.equal((await envioDeCodigoPermitido(e, { email: 'otro@example.com', uuid: OFFLINE, red: RED_A, ahora: t0 })).motivo, 'tope_red');
  assert.equal((await envioDeCodigoPermitido(e, { email: 'otro@example.com', uuid: OFFLINE, red: RED_B, ahora: t0 })).ok, true);
});

test('una sola red por cuenta: confirmar desde otra red cierra la sesión de la anterior', async () => {
  const e = nuevo();
  const t0 = 3_000_000_000_000;
  const a = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: OFFLINE, ahora: t0 });
  await vincular(e, { codigo: a.codigo, uuid: OFFLINE, red: RED_A, ahora: t0 });
  const b = await crearCodigoDeVinculo(e, { vtuberId: 7, uuid: OFFLINE, ahora: t0 + 1000 });
  await vincular(e, { codigo: b.codigo, uuid: OFFLINE, red: RED_B, ahora: t0 + 1000 });
  assert.equal(await sesionVigente(e, { uuid: OFFLINE, red: RED_B, ahora: t0 + 2000 }), true);
  assert.equal(await sesionVigente(e, { uuid: OFFLINE, red: RED_A, ahora: t0 + 2000 }), false);
});
