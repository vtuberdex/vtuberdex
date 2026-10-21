/** Misiones: contadores con metas, completado idempotente que paga XP una vez, y reclamo opcional de grado. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import { xpDeJuego } from '../src/minecraft.mjs';
import {
  AVANCE_POR_LOTE_MAX,
  GRADO_MAXIMO_POR_MISIONES,
  MISIONES,
  MisionError,
  elegibilidadDeGrado,
  listarReclamos,
  resumenDeMisiones,
  revocarReclamo,
  misionesDeFicha,
  reclamarGrado,
  registrarAvances,
  soltarReclamo,
} from '../src/misiones.mjs';
import { GRADOS } from '../src/premium.mjs';
import { ejecutorSqlite } from '../src/solicitudes.mjs';

const nuevo = () => ejecutorSqlite(new DatabaseSync(':memory:'));
const DIA = '2026-10-21';
const lote = (avances, extra = {}) => ({ vtuberId: 7, idLote: crypto.randomUUID(), avances, dia: DIA, ...extra });
const error = (p) => p.then(() => null, (e) => e);

test('el catálogo es coherente: ids únicos, metas positivas, contadores conocidos y grados ganables', () => {
  assert.equal(new Set(MISIONES.map((m) => m.id)).size, MISIONES.length);
  const tope = GRADOS.indexOf(GRADO_MAXIMO_POR_MISIONES);
  for (const m of MISIONES) {
    assert.ok(Object.keys(m.requisitos).length > 0, m.id);
    for (const meta of Object.values(m.requisitos)) assert.ok(Number.isInteger(meta) && meta > 0, m.id);
    if (m.tipo === 'grado') {
      assert.ok(GRADOS.indexOf(m.grado) >= 0 && GRADOS.indexOf(m.grado) <= tope, m.id);
      assert.equal(m.xp, 0, 'las de grado no pagan XP: el premio es el grado');
    }
  }
});

test('una misión se completa al llegar a la meta, paga su XP una vez y no sigue sumando', async () => {
  const e = nuevo();
  const a = await registrarAvances(e, lote({ jefes: 1 }));
  assert.deepEqual(a.completadas.map((m) => m.id), ['primer-jefe']);
  assert.equal(a.completadas[0].xp, 100);
  assert.equal(await xpDeJuego(e, 7), 100, 'la XP de misión entra a la barra');
  const b = await registrarAvances(e, lote({ jefes: 5 }));
  assert.deepEqual(b.completadas, []);
  assert.equal(await xpDeJuego(e, 7), 100);
});

test('un lote repetido no suma dos veces', async () => {
  const e = nuevo();
  const mismo = lote({ jefes: 1 });
  assert.equal((await registrarAvances(e, mismo)).completadas.length, 1);
  const otra = await registrarAvances(e, mismo);
  assert.equal(otra.duplicado, true);
  assert.equal(await xpDeJuego(e, 7), 100);
});

test('el progreso se acumula entre lotes y las diarias se reinician cada día', async () => {
  const e = nuevo();
  await registrarAvances(e, lote({ mobs: 30 }));
  let vista = await misionesDeFicha(e, { vtuberId: 7, dia: DIA });
  const cazador = vista.secundarias.find((m) => m.id === 'cazador-del-dia');
  assert.equal(cazador.requisitos[0].progreso, 30);
  assert.equal(cazador.completada, false);
  const r = await registrarAvances(e, lote({ mobs: 40 }));
  assert.ok(r.completadas.some((m) => m.id === 'cazador-del-dia'));
  assert.equal(await xpDeJuego(e, 7), 20);
  // Al día siguiente vuelve a empezar y paga de nuevo.
  vista = await misionesDeFicha(e, { vtuberId: 7, dia: '2026-10-22' });
  assert.equal(vista.secundarias.find((m) => m.id === 'cazador-del-dia').requisitos[0].progreso, 0);
  const manana = await registrarAvances(e, lote({ mobs: 50 }, { dia: '2026-10-22' }));
  assert.ok(manana.completadas.some((m) => m.id === 'cazador-del-dia'));
  assert.equal(await xpDeJuego(e, 7), 40);
});

test('otra ficha no comparte progreso', async () => {
  const e = nuevo();
  await registrarAvances(e, lote({ jefes: 1 }));
  const vista = await misionesDeFicha(e, { vtuberId: 8, dia: DIA });
  assert.equal(vista.secundarias.find((m) => m.id === 'primer-jefe').completada, false);
});

test('entradas inválidas se rechazan con un código explicable', async () => {
  const e = nuevo();
  for (const [avances, codigo] of [
    [{ volar: 3 }, 'contador_invalido'],
    [{ mobs: -1 }, 'payload_invalido'],
    [{ mobs: AVANCE_POR_LOTE_MAX + 1 }, 'payload_invalido'],
    [{ mobs: 1.5 }, 'payload_invalido'],
    [{}, 'payload_invalido'],
    [null, 'payload_invalido'],
  ]) {
    const fallo = await error(registrarAvances(e, lote(avances)));
    assert.ok(fallo instanceof MisionError, JSON.stringify(avances));
    assert.equal(fallo.code, codigo);
  }
  assert.equal((await error(registrarAvances(e, lote({ mobs: 1 }, { idLote: 'nope' })))).code, 'payload_invalido');
});

test('elegibilidad: nunca baja un grado, no toca deterioradas y no pasa del tope', () => {
  assert.deepEqual(elegibilidadDeGrado(null, '6'), { ok: true });
  assert.deepEqual(elegibilidadDeGrado('6', '7'), { ok: true });
  assert.equal(elegibilidadDeGrado('7', '7').motivo, 'ya_tiene_igual_o_mayor');
  assert.equal(elegibilidadDeGrado('9', '7').motivo, 'ya_tiene_igual_o_mayor');
  assert.equal(elegibilidadDeGrado('BL', '6').motivo, 'ya_tiene_igual_o_mayor');
  assert.equal(elegibilidadDeGrado('3', '6').motivo, 'ficha_deteriorada');
  assert.equal(elegibilidadDeGrado(null, '8.5').motivo, 'grado_no_ganable');
  assert.equal(elegibilidadDeGrado(null, 'BL').motivo, 'grado_no_ganable');
});

test('el grado se reclama una sola vez, solo si la misión está completa, y se puede soltar si falla', async () => {
  const e = nuevo();
  const g6 = MISIONES.find((m) => m.id === 'grado-6');
  assert.equal((await error(reclamarGrado(e, { vtuberId: 7, misionId: 'grado-6' }))).code, 'mision_incompleta');
  for (const [contador, meta] of Object.entries(g6.requisitos))
    for (let hecho = 0; hecho < meta; hecho += AVANCE_POR_LOTE_MAX)
      await registrarAvances(e, lote({ [contador]: Math.min(AVANCE_POR_LOTE_MAX, meta - hecho) }));
  let vista = await misionesDeFicha(e, { vtuberId: 7, dia: DIA });
  assert.equal(vista.grado.find((m) => m.id === 'grado-6').reclamable, true);

  assert.deepEqual(await reclamarGrado(e, { vtuberId: 7, misionId: 'grado-6' }), { grado: '6', mision: 'grado-6' });
  assert.equal((await error(reclamarGrado(e, { vtuberId: 7, misionId: 'grado-6' }))).code, 'ya_reclamada');

  await soltarReclamo(e, { vtuberId: 7, misionId: 'grado-6' });
  vista = await misionesDeFicha(e, { vtuberId: 7, dia: DIA });
  assert.equal(vista.grado.find((m) => m.id === 'grado-6').reclamable, true, 'tras soltar se puede reintentar');

  // Con la carta ya en 6 la misión del 6 no se puede reclamar: lo dice la vista y lo exige el servidor.
  vista = await misionesDeFicha(e, { vtuberId: 7, dia: DIA, gradoActual: '6' });
  const m6 = vista.grado.find((m) => m.id === 'grado-6');
  assert.equal(m6.reclamable, false);
  assert.equal(m6.motivo, 'ya_tiene_igual_o_mayor');
  assert.equal((await error(reclamarGrado(e, { vtuberId: 7, misionId: 'grado-6', gradoActual: '6' }))).code, 'ya_tiene_igual_o_mayor');
});

test('una misión secundaria no se puede reclamar como grado', async () => {
  const e = nuevo();
  assert.equal((await error(reclamarGrado(e, { vtuberId: 7, misionId: 'primer-jefe' }))).code, 'mision_no_encontrada');
});

test('un reclamo deja rastro con el grado anterior, se puede revocar una vez y no se puede volver a reclamar', async () => {
  const e = nuevo();
  const g7 = MISIONES.find((m) => m.id === 'grado-7');
  for (const [contador, meta] of Object.entries(g7.requisitos))
    for (let hecho = 0; hecho < meta; hecho += AVANCE_POR_LOTE_MAX)
      await registrarAvances(e, lote({ [contador]: Math.min(AVANCE_POR_LOTE_MAX, meta - hecho) }));
  await reclamarGrado(e, { vtuberId: 7, misionId: 'grado-7', gradoActual: '6' });
  const [reclamo] = await listarReclamos(e);
  assert.deepEqual({ ...reclamo, reclamado: undefined }, { vtuberId: 7, misionId: 'grado-7', grado: '7', gradoPrevio: '6', reclamado: undefined, revocado: null });

  assert.deepEqual(await revocarReclamo(e, { vtuberId: 7, misionId: 'grado-7' }), { grado: '7', gradoPrevio: '6' });
  assert.equal((await error(revocarReclamo(e, { vtuberId: 7, misionId: 'grado-7' }))).code, 'reclamo_no_encontrado');
  assert.ok((await listarReclamos(e))[0].revocado);
  // Revocado, la misión sigue reclamada: no hay forma de volver a pedir el grado.
  assert.equal((await error(reclamarGrado(e, { vtuberId: 7, misionId: 'grado-7' }))).code, 'ya_reclamada');
});

test('una carta sin grado previo guarda null; soltar un reclamo que falló borra su rastro', async () => {
  const e = nuevo();
  const g6 = MISIONES.find((m) => m.id === 'grado-6');
  for (const [contador, meta] of Object.entries(g6.requisitos))
    for (let hecho = 0; hecho < meta; hecho += AVANCE_POR_LOTE_MAX)
      await registrarAvances(e, lote({ [contador]: Math.min(AVANCE_POR_LOTE_MAX, meta - hecho) }));
  await reclamarGrado(e, { vtuberId: 7, misionId: 'grado-6' });
  assert.equal((await listarReclamos(e))[0].gradoPrevio, null);
  await soltarReclamo(e, { vtuberId: 7, misionId: 'grado-6' });
  assert.deepEqual(await listarReclamos(e), []);
});

test('el resumen cuenta quién completó cada misión y el avance de quienes van en camino', async () => {
  const e = nuevo();
  await registrarAvances(e, lote({ jefes: 1 })); // completa «primer-jefe» (ficha 7)
  for (let i = 0; i < 5; i += 1) await registrarAvances(e, lote({ distancia: 1000 }, { vtuberId: 8 })); // «gran-explorador» al 50 %
  await registrarAvances(e, lote({ distancia: 1000 }, { vtuberId: 9 })); // al 10 %
  const r = Object.fromEntries((await resumenDeMisiones(e)).map((m) => [m.id, m]));
  assert.equal(r['primer-jefe'].completaron, 1);
  assert.equal(r['gran-explorador'].completaron, 0);
  assert.equal(r['gran-explorador'].enCamino, 2);
  assert.equal(r['gran-explorador'].avanceMedio, 30);
  assert.equal(r['gran-explorador'].avanceMaximo, 50);
  assert.equal(r['grado-8'].enCamino, 3, 'los contadores comunes también avanzan las misiones de grado');
});
