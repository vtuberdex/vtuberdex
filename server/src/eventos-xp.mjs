// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * EVENTOS GLOBALES DE XP y REGALOS de XP a todas las fichas vinculadas. JS puro sobre un EJECUTOR `{ execute, exec }`.
 *
 * Los dos existen para poder hacer eventos para toda la comunidad SIN chocar con la XP diaria del juego:
 *
 * - EVENTO con fechas: un multiplicador (1,5x, 2x…) activo entre `inicio` y `fin`. Cada lote de XP que el juego suma
 *   durante el evento paga ADEMÁS un bono (`sumado × (multiplicador − 1)`) en su propia tabla `xp_evento`. Ese bono NO
 *   cuenta para el tope diario (`xp_juego` no lo ve), así que un evento no se come el cupo normal ni al revés. Si hay
 *   varios eventos a la vez gana el de mayor multiplicador (no se apilan). Es idempotente por `lote:evento`.
 * - REGALO único: una cantidad fija para TODAS las fichas con cuenta vinculada, de una vez. Se anota en `regalo_xp` y
 *   cada ficha recibe una fila de `xp_manual` (motivo «Regalo #N: …»), así que se ve en su historial y se puede corregir.
 */
import { prepararTablasMinecraft, XP_MANUAL_MAX } from './minecraft.mjs';

/** Multiplicador máximo de un evento: más que esto es un error de dedo (x100) más que un evento. */
export const MULTIPLICADOR_EVENTO_MAX = 10;
/** Duración máxima de un evento. Uno permanente es una regla del juego, no un evento. */
export const EVENTO_DURACION_MAX_DIAS = 60;
const UN_DIA_MS = 24 * 60 * 60 * 1000;

const nombreValido = (t) => t.length >= 3 && t.length <= 80 && !/\p{Cc}/u.test(t);

/** Una fecha ISO válida como milisegundos, o `NaN`. */
const ms = (texto) => (typeof texto === 'string' ? Date.parse(texto) : Number.NaN);

/**
 * Crea un evento. `multiplicador` > 1 (x2 = el doble: el bono iguala lo ganado jugando). `inicio`/`fin` son fechas ISO.
 * @returns {Promise<{ ok: true, id: number } | { ok: false, status: number, cuerpo: object }>}
 */
export async function crearEvento(ejecutor, { nombre, multiplicador, inicio, fin, actor, ahora = Date.now() }) {
  const texto = String(nombre ?? '').trim();
  const m = Number(multiplicador);
  const desde = ms(inicio);
  const hasta = ms(fin);
  const quien = String(actor ?? '').trim();
  let cuerpo = null;
  if (!nombreValido(texto)) {
    cuerpo = { error: 'nombre_invalido', detail: 'entre 3 y 80 caracteres, en una línea' };
  } else if (!(m > 1) || m > MULTIPLICADOR_EVENTO_MAX) {
    cuerpo = { error: 'multiplicador_invalido', detail: `mayor que 1 y hasta ${MULTIPLICADOR_EVENTO_MAX} (2 = el doble)` };
  } else if (Number.isNaN(desde) || Number.isNaN(hasta)) {
    cuerpo = { error: 'fecha_invalida', detail: 'inicio y fin son fechas ISO' };
  } else if (hasta <= desde || hasta <= ahora) {
    cuerpo = { error: 'rango_invalido', detail: 'el fin debe ser posterior al inicio y estar en el futuro' };
  } else if (hasta - desde > EVENTO_DURACION_MAX_DIAS * UN_DIA_MS) {
    cuerpo = { error: 'rango_invalido', detail: `un evento dura como mucho ${EVENTO_DURACION_MAX_DIAS} días` };
  } else if (!quien) {
    cuerpo = { error: 'actor_invalido' };
  }
  if (cuerpo) {
    return { ok: false, status: 400, cuerpo };
  }
  const e = await prepararTablasMinecraft(ejecutor);
  const r = await e.execute(
    'INSERT INTO evento_xp (nombre, multiplicador, inicio, fin, actor, creado) VALUES (?, ?, ?, ?, ?, ?)',
    [texto, m, new Date(desde).toISOString(), new Date(hasta).toISOString(), quien, new Date(ahora).toISOString()],
  );
  return { ok: true, id: Number(r.lastInsertRowid) };
}

/** `programado`, `activo`, `terminado` o `cancelado`. */
function estadoDe(fila, ahora) {
  if (fila.cancelado) {
    return 'cancelado';
  }
  if (ms(fila.inicio) > ahora) {
    return 'programado';
  }
  return ms(fila.fin) > ahora ? 'activo' : 'terminado';
}

/** Los últimos eventos (el más reciente primero) con su estado y cuánta XP de bono pagaron. */
export async function listarEventos(ejecutor, { ahora = Date.now(), limite = 30 } = {}) {
  const e = await prepararTablasMinecraft(ejecutor);
  const { rows } = await e.execute(
    `SELECT v.id, v.nombre, v.multiplicador, v.inicio, v.fin, v.actor, v.cancelado,
            COALESCE(SUM(x.cantidad), 0) AS pagado, COUNT(DISTINCT x.vtuber_id) AS fichas
       FROM evento_xp v LEFT JOIN xp_evento x ON x.evento_id = v.id
      GROUP BY v.id ORDER BY v.id DESC LIMIT ?`,
    [Math.min(Math.max(Math.trunc(Number(limite)) || 30, 1), 100)],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    nombre: String(r.nombre),
    multiplicador: Number(r.multiplicador),
    inicio: String(r.inicio),
    fin: String(r.fin),
    actor: String(r.actor),
    estado: estadoDe({ inicio: r.inicio, fin: r.fin, cancelado: r.cancelado }, ahora),
    xpPagada: Number(r.pagado),
    fichas: Number(r.fichas),
  }));
}

/** Cancela un evento (programado o en curso). Lo ya pagado se queda. @returns {Promise<boolean>} `false` si no existía o ya estaba cancelado. */
export async function cancelarEvento(ejecutor, { id, ahora = Date.now() }) {
  const e = await prepararTablasMinecraft(ejecutor);
  const r = await e.execute('UPDATE evento_xp SET cancelado = ? WHERE id = ? AND cancelado IS NULL', [
    new Date(ahora).toISOString(),
    Number(id),
  ]);
  return Number(r.rowsAffected ?? 0) > 0;
}

/** El evento en curso de mayor multiplicador, o `null`. */
export async function eventoActivo(ejecutor, ahora = Date.now()) {
  const e = await prepararTablasMinecraft(ejecutor);
  const iso = new Date(ahora).toISOString();
  const { rows } = await e.execute(
    'SELECT id, nombre, multiplicador FROM evento_xp WHERE cancelado IS NULL AND inicio <= ? AND fin > ? ORDER BY multiplicador DESC, id DESC LIMIT 1',
    [iso, iso],
  );
  return rows.length ? { id: Number(rows[0].id), nombre: String(rows[0].nombre), multiplicador: Number(rows[0].multiplicador) } : null;
}

/**
 * Paga el bono del evento en curso por un lote que YA sumó `sumado` XP de juego. Idempotente por `lote:evento`: un
 * reintento del plugin no lo paga dos veces. No toca `xp_juego`, así que no gasta el tope diario.
 * @returns {Promise<{ eventoId: number, nombre: string, bono: number } | null>} `null` si no había evento o el bono es 0.
 */
export async function pagarBonoDeEvento(ejecutor, { vtuberId, idLote, sumado, dia, ahora = Date.now() }) {
  if (!(sumado > 0)) {
    return null;
  }
  const evento = await eventoActivo(ejecutor, ahora);
  if (!evento) {
    return null;
  }
  const bono = Math.floor(sumado * (evento.multiplicador - 1));
  if (bono < 1) {
    return null;
  }
  const e = await prepararTablasMinecraft(ejecutor);
  const r = await e.execute(
    'INSERT INTO xp_evento (id, evento_id, vtuber_id, cantidad, dia, creado) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING',
    [`${String(idLote).toLowerCase()}:${evento.id}`, evento.id, Number(vtuberId), bono, dia, new Date(ahora).toISOString()],
  );
  return Number(r.rowsAffected ?? 0) ? { eventoId: evento.id, nombre: evento.nombre, bono } : null;
}

/**
 * Regala `cantidad` XP a TODAS las fichas con cuenta vinculada, una sola vez. Cada ficha recibe su fila de `xp_manual`, así
 * que sale en su historial y se corrige como cualquier ajuste.
 * @returns {Promise<{ ok: true, id: number, fichas: number } | { ok: false, status: number, cuerpo: object }>}
 */
export async function regalarXpATodas(ejecutor, { cantidad, motivo, actor, ahora = Date.now() }) {
  const n = Number(cantidad);
  const razon = String(motivo ?? '').trim();
  const quien = String(actor ?? '').trim();
  let cuerpo = null;
  if (!Number.isInteger(n) || n < 1 || n > XP_MANUAL_MAX) {
    cuerpo = { error: 'cantidad_invalida', detail: `un entero de 1 a ${XP_MANUAL_MAX}` };
  } else if (razon.length < 3 || razon.length > 150 || /\p{Cc}/u.test(razon)) {
    cuerpo = { error: 'motivo_invalido', detail: 'entre 3 y 150 caracteres, en una línea' };
  } else if (!quien) {
    cuerpo = { error: 'actor_invalido' };
  }
  if (cuerpo) {
    return { ok: false, status: 400, cuerpo };
  }
  const e = await prepararTablasMinecraft(ejecutor);
  const iso = new Date(ahora).toISOString();
  const { rows } = await e.execute('SELECT COUNT(*) AS n FROM vinculo_minecraft');
  const fichas = Number(rows[0]?.n ?? 0);
  if (fichas === 0) {
    return { ok: false, status: 409, cuerpo: { error: 'sin_fichas_vinculadas', detail: 'no hay ninguna ficha con cuenta vinculada' } };
  }
  const alta = await e.execute('INSERT INTO regalo_xp (motivo, cantidad, fichas, actor, creado) VALUES (?, ?, ?, ?, ?)', [
    razon,
    n,
    fichas,
    quien,
    iso,
  ]);
  const id = Number(alta.lastInsertRowid);
  await e.execute(
    'INSERT INTO xp_manual (vtuber_id, cantidad, motivo, actor, creado) SELECT vtuber_id, ?, ?, ?, ? FROM vinculo_minecraft',
    [n, `Regalo #${id}: ${razon}`, quien, iso],
  );
  return { ok: true, id, fichas };
}

/** Los últimos regalos a todas las fichas, el más reciente primero. */
export async function listarRegalos(ejecutor, limite = 20) {
  const e = await prepararTablasMinecraft(ejecutor);
  const { rows } = await e.execute('SELECT id, motivo, cantidad, fichas, actor, creado FROM regalo_xp ORDER BY id DESC LIMIT ?', [
    Math.min(Math.max(Math.trunc(Number(limite)) || 20, 1), 100),
  ]);
  return rows.map((r) => ({
    id: Number(r.id),
    motivo: String(r.motivo),
    cantidad: Number(r.cantidad),
    fichas: Number(r.fichas),
    actor: String(r.actor),
    creado: String(r.creado),
  }));
}
