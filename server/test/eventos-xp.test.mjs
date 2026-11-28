/** Eventos globales de XP y regalos a todas las fichas vinculadas, sobre SQLite en memoria. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
  cancelarEvento,
  crearEvento,
  eventoActivo,
  listarEventos,
  listarRegalos,
  pagarBonoDeEvento,
  regalarXpATodas,
} from '../src/eventos-xp.mjs';
import { crearCodigoDeVinculo, sumarXp, vincular, xpDeJuego, xpDeHoyTodas } from '../src/minecraft.mjs';
import { ejecutorSqlite } from '../src/solicitudes.mjs';

const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const AHORA = Date.parse('2026-12-01T12:00:00Z');
const HORA = 3600_000;
const DIA = '2026-12-01';
const iso = (ms) => new Date(ms).toISOString();
const uuid = (n) => `069a79f4-44e9-4726-a5be-fca90e38aa0${n}`;

async function vinculado(e, vtuberId, n) {
  const { codigo } = await crearCodigoDeVinculo(e, { vtuberId });
  await vincular(e, { codigo, uuid: uuid(n), jugador: 'Steve' });
}
const evento = (extra = {}) => ({
  nombre: 'Fin de semana doble',
  multiplicador: 2,
  inicio: iso(AHORA - HORA),
  fin: iso(AHORA + HORA),
  actor: 'admin@x.cl',
  ahora: AHORA,
  ...extra,
});

test('crearEvento valida nombre, multiplicador, fechas y duración', async () => {
  const e = nuevo();
  for (const [extra, error] of [
    [{ nombre: 'ab' }, 'nombre_invalido'],
    [{ multiplicador: 1 }, 'multiplicador_invalido'],
    [{ multiplicador: 11 }, 'multiplicador_invalido'],
    [{ inicio: 'ayer' }, 'fecha_invalida'],
    [{ fin: iso(AHORA - 5) }, 'rango_invalido'],
    [{ fin: iso(AHORA + 90 * 24 * HORA) }, 'rango_invalido'],
    [{ actor: ' ' }, 'actor_invalido'],
  ]) {
    const r = await crearEvento(e, evento(extra));
    assert.equal(r.ok, false, error);
    assert.equal(r.cuerpo.error, error);
  }
  assert.equal((await crearEvento(e, evento())).ok, true);
});

test('el evento activo paga bono aparte, sin gastar el tope diario, y es idempotente', async () => {
  const e = nuevo();
  await vinculado(e, 7, 1);
  await crearEvento(e, evento());
  const idLote = crypto.randomUUID();
  const r = await sumarXp(e, { uuid: uuid(1), idLote, detalle: { mob: 50 }, dia: DIA });
  assert.equal(r.sumado, 50);
  const bono = await pagarBonoDeEvento(e, { vtuberId: 7, idLote, sumado: r.sumado, dia: DIA, ahora: AHORA });
  assert.equal(bono.bono, 50); // x2 = otro tanto igual
  assert.equal(await pagarBonoDeEvento(e, { vtuberId: 7, idLote, sumado: 50, dia: DIA, ahora: AHORA }), null);
  assert.equal(await xpDeJuego(e, 7), 100);
  assert.equal((await xpDeHoyTodas(e, 7, DIA)), 100);
  // El cupo diario (xp_juego) solo ve los 50 jugados: el bono no lo gasta.
  assert.equal(r.hoy, 50);
});

test('sin evento, cancelado o fuera de fechas no hay bono; gana el mayor multiplicador', async () => {
  const e = nuevo();
  await vinculado(e, 7, 1);
  assert.equal(await eventoActivo(e, AHORA), null);
  const { id } = await crearEvento(e, evento({ multiplicador: 1.5 }));
  await crearEvento(e, evento({ nombre: 'Triple', multiplicador: 3 }));
  assert.equal((await eventoActivo(e, AHORA)).multiplicador, 3);
  assert.equal(await eventoActivo(e, AHORA + 3 * HORA), null);
  assert.equal(await cancelarEvento(e, { id, ahora: AHORA }), true);
  assert.equal(await cancelarEvento(e, { id }), false);
  const lista = await listarEventos(e, { ahora: AHORA });
  assert.equal(lista.find((x) => x.id === id).estado, 'cancelado');
  assert.equal(lista.find((x) => x.nombre === 'Triple').estado, 'activo');
});

test('regalarXpATodas suma a todas las fichas vinculadas y queda registrado', async () => {
  const e = nuevo();
  await vinculado(e, 7, 1);
  await vinculado(e, 8, 2);
  const mala = await regalarXpATodas(e, { cantidad: 0, motivo: 'Navidad', actor: 'a@x.cl' });
  assert.equal(mala.cuerpo.error, 'cantidad_invalida');
  const r = await regalarXpATodas(e, { cantidad: 500, motivo: 'Navidad', actor: 'a@x.cl', ahora: AHORA });
  assert.deepEqual([r.ok, r.fichas], [true, 2]);
  assert.equal(await xpDeJuego(e, 7), 500);
  assert.equal(await xpDeJuego(e, 8), 500);
  const [regalo] = await listarRegalos(e);
  assert.deepEqual([regalo.cantidad, regalo.fichas, regalo.motivo], [500, 2, 'Navidad']);
});

test('regalar sin fichas vinculadas se rechaza', async () => {
  const r = await regalarXpATodas(nuevo(), { cantidad: 10, motivo: 'Prueba', actor: 'a@x.cl' });
  assert.equal(r.status, 409);
});
