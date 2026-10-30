/**
 * MISIONES de Minecraft: secundarias que dan experiencia y misiones DIFÍCILES que desbloquean un grado de carta.
 * JS puro sobre un EJECUTOR `{ execute, exec }` (como `minecraft.mjs`); el plugin solo REPORTA contadores y la web decide
 * qué se completó, cuánta XP vale y qué grado se puede reclamar: el plugin no calcula nada.
 *
 * CONTADORES, NO EVENTOS SUELTOS
 * ------------------------------
 * El plugin junta lo que pasó unos segundos y manda `{ mobs: 12, mineria: 40 }` con un `idLote` (UUID). Cada misión pide
 * uno o varios contadores (`requisitos`) y se completa cuando TODOS llegan a su meta. Un mismo contador alimenta a todas
 * las misiones que lo piden. Las diarias cuentan por día de Chile (`periodo` = el día), las semanales de lunes a domingo (`semana:<lunes>`), las únicas para siempre.
 *
 * IDEMPOTENCIA
 * ------------
 * Un lote repetido (reintento tras un corte) no suma dos veces: su id es clave primaria de `mision_lote`. Completar una
 * misión es UN `INSERT … ON CONFLICT DO NOTHING` sobre `mision_estado`: solo el que gana paga la XP, y esa XP es otra
 * fila con clave `ficha:mision:periodo` (no se paga dos veces ni con lotes simultáneos).
 *
 * MISIONES DE GRADO (opcionales)
 * ------------------------------
 * Completar una da el DERECHO a reclamar un grado de carta (6 … `GRADO_MAXIMO_POR_MISIONES`); reclamarlo es decisión de la
 * persona. Las misiones no pasan del 8: del 8,5 a la Black Label se queda para la donación, que sostiene el proyecto.
 * Reclamar nunca baja un grado, no toca una carta deteriorada y no sustituye el grado que dio una donación.
 */
import { prepararTablasMinecraft, uuidValido } from './minecraft.mjs';
import { GRADOS, esGradoDegradado } from './premium.mjs';
import { preparadorDeTablas } from './db/tablas.mjs';

/** El grado más alto que se gana jugando. Subirlo es una decisión de negocio, no un detalle técnico. */
export const GRADO_MAXIMO_POR_MISIONES = '8';
/** Cuánto puede sumar un contador en un lote: más es un plugin roto o trucado. */
export const AVANCE_POR_LOTE_MAX = 1000;

/** Lo que el plugin puede reportar. `etiqueta` es para mostrarlo en la web. */
export const CONTADORES = Object.freeze({
  mobs: 'monstruos derrotados',
  jefes: 'jefes derrotados',
  mineria: 'minerales extraídos',
  pesca: 'peces pescados',
  cosecha: 'cultivos cosechados',
  cria: 'animales criados',
  entregas: 'entregas completadas',
  distancia: 'metros recorridos',
});

const unica = (m) => Object.freeze({ repetible: null, xp: 0, ...m });
const diaria = (m) => Object.freeze({ repetible: 'diaria', xp: 0, ...m });
const semanal = (m) => Object.freeze({ repetible: 'semanal', xp: 0, ...m });

/** Catálogo. Para ajustar dificultad o recompensas se toca SOLO esto. */
export const MISIONES = Object.freeze([
  // --- secundarias: dan XP
  diaria({ id: 'cazador-del-dia', tipo: 'secundaria', nombre: 'Cazador del día', descripcion: 'Derrota 50 monstruos hoy.', requisitos: { mobs: 50 }, xp: 25 }),
  diaria({ id: 'minero-del-dia', tipo: 'secundaria', nombre: 'Minero del día', descripcion: 'Extrae 64 minerales hoy.', requisitos: { mineria: 64 }, xp: 25 }),
  diaria({ id: 'pescador-del-dia', tipo: 'secundaria', nombre: 'Pescador del día', descripcion: 'Pesca 10 peces hoy.', requisitos: { pesca: 10 }, xp: 20 }),
  diaria({ id: 'granjero-del-dia', tipo: 'secundaria', nombre: 'Granjero del día', descripcion: 'Cosecha 64 cultivos hoy.', requisitos: { cosecha: 64 }, xp: 20 }),
  semanal({ id: 'cazador-semanal', tipo: 'secundaria', nombre: 'Cazador de la semana', descripcion: 'Derrota 500 monstruos esta semana.', requisitos: { mobs: 500 }, xp: 80 }),
  semanal({ id: 'repartidor-semanal', tipo: 'secundaria', nombre: 'Repartidor de la semana', descripcion: 'Completa 10 entregas esta semana.', requisitos: { entregas: 10 }, xp: 120 }),
  unica({ id: 'primer-jefe', tipo: 'secundaria', nombre: 'Primer jefe', descripcion: 'Derrota a tu primer jefe.', requisitos: { jefes: 1 }, xp: 100 }),
  unica({ id: 'repartidor-novato', tipo: 'secundaria', nombre: 'Repartidor novato', descripcion: 'Completa 5 entregas.', requisitos: { entregas: 5 }, xp: 60 }),
  unica({ id: 'gran-explorador', tipo: 'secundaria', nombre: 'Gran explorador', descripcion: 'Recorre 10.000 metros.', requisitos: { distancia: 10000 }, xp: 80 }),
  unica({ id: 'criador', tipo: 'secundaria', nombre: 'Criador', descripcion: 'Cría 20 animales.', requisitos: { cria: 20 }, xp: 50 }),
  // --- de grado: DIFÍCILES, sin XP; el premio es poder reclamar el grado
  unica({ id: 'grado-6', tipo: 'grado', grado: '6', nombre: 'Carta gradeada · 6', descripcion: 'Demuestra que juegas en serio.', requisitos: { mobs: 1000, mineria: 1500, entregas: 10 } }),
  unica({ id: 'grado-6.5', tipo: 'grado', grado: '6.5', nombre: 'Carta gradeada · 6,5', descripcion: 'Un paso más allá del oficio.', requisitos: { mobs: 2500, jefes: 2, entregas: 25, pesca: 200 } }),
  unica({ id: 'grado-7', tipo: 'grado', grado: '7', nombre: 'Carta gradeada · 7', descripcion: 'Veterano de todos los frentes.', requisitos: { mobs: 5000, jefes: 5, entregas: 50, distancia: 100000, cosecha: 1000 } }),
  unica({ id: 'grado-7.5', tipo: 'grado', grado: '7.5', nombre: 'Carta gradeada · 7,5', descripcion: 'Casi una leyenda del servidor.', requisitos: { mobs: 10000, jefes: 10, entregas: 100, cria: 200 } }),
  unica({ id: 'grado-8', tipo: 'grado', grado: '8', nombre: 'Carta gradeada · 8', descripcion: 'La cima de lo que se gana jugando.', requisitos: { mobs: 20000, jefes: 25, entregas: 250, mineria: 20000, distancia: 500000 } }),
]);

const porId = new Map(MISIONES.map((m) => [m.id, m]));
export const misionPorId = (id) => porId.get(String(id)) ?? null;

export class MisionError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.name = 'MisionError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? code;
  }
}

const DDL = `
  CREATE TABLE IF NOT EXISTS mision_lote (
    id_lote   TEXT PRIMARY KEY,
    creado    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mision_progreso (
    vtuber_id INTEGER NOT NULL,
    mision_id TEXT NOT NULL,
    periodo   TEXT NOT NULL,
    contador  TEXT NOT NULL,
    progreso  INTEGER NOT NULL,
    PRIMARY KEY (vtuber_id, mision_id, periodo, contador)
  );
  CREATE TABLE IF NOT EXISTS mision_reclamo (
    vtuber_id    INTEGER NOT NULL,
    mision_id    TEXT NOT NULL,
    grado        TEXT NOT NULL,
    grado_previo TEXT,
    reclamado    TEXT NOT NULL,
    revocado     TEXT,
    PRIMARY KEY (vtuber_id, mision_id)
  );
  CREATE TABLE IF NOT EXISTS mision_estado (
    vtuber_id  INTEGER NOT NULL,
    mision_id  TEXT NOT NULL,
    periodo    TEXT NOT NULL,
    completada TEXT NOT NULL,
    reclamada  TEXT,
    PRIMARY KEY (vtuber_id, mision_id, periodo)
  );
`;
const propias = preparadorDeTablas(DDL);
async function conTablas(ejecutor) {
  return propias(await prepararTablasMinecraft(ejecutor));
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const UN_DIA_MS = 24 * 60 * 60 * 1000;
/**
 * El lunes de la semana de un día (YYYY-MM-DD): las semanales cuentan de lunes a domingo, con el día de Chile que decide quien
 * llama. Se calcula en UTC sobre la fecha ya resuelta, así que no depende del huso del servidor.
 */
export function lunesDe(dia) {
  const [a, m, d] = String(dia).split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  fecha.setUTCDate(fecha.getUTCDate() - ((fecha.getUTCDay() + 6) % 7));
  return fecha.toISOString().slice(0, 10);
}

/** Las diarias cuentan por día, las semanales por semana y las únicas, siempre en el mismo periodo. */
const periodoDe = (mision, dia) => (mision.repetible === 'diaria' ? dia : mision.repetible === 'semanal' ? `semana:${lunesDe(dia)}` : 'unica');

/** Avances válidos: solo contadores conocidos, enteros 1…`AVANCE_POR_LOTE_MAX`. Lanza si no cuadra. */
function avancesValidos(avances) {
  if (!avances || typeof avances !== 'object' || Array.isArray(avances))
    throw new MisionError(400, 'payload_invalido', 'Faltan los avances.');
  const limpio = {};
  for (const [contador, cantidad] of Object.entries(avances)) {
    if (!(contador in CONTADORES))
      throw new MisionError(400, 'contador_invalido', `Contador desconocido: ${contador}.`);
    if (!Number.isInteger(cantidad) || cantidad < 0 || cantidad > AVANCE_POR_LOTE_MAX)
      throw new MisionError(400, 'payload_invalido', `Un avance es un entero entre 0 y ${AVANCE_POR_LOTE_MAX}.`);
    if (cantidad > 0) limpio[contador] = cantidad;
  }
  if (!Object.keys(limpio).length) throw new MisionError(400, 'payload_invalido', 'El lote no trae avances.');
  return limpio;
}

/**
 * Suma un lote de avances a la ficha y devuelve las misiones que ESTE lote completó (con la XP que pagaron).
 * @param {{ vtuberId: number, idLote: string, avances: Record<string, number>, dia: string, ahora?: number }} entrada
 * @returns {Promise<{ duplicado: boolean, completadas: Array<{ id: string, nombre: string, tipo: string, xp: number, grado?: string }> }>}
 */
export async function registrarAvances(ejecutor, { vtuberId, idLote, avances, dia, ahora = Date.now() }) {
  if (!uuidValido(idLote)) throw new MisionError(400, 'payload_invalido', 'El lote necesita un id (UUID).');
  if (!DIA.test(String(dia))) throw new Error(`día inválido: ${dia}`);
  const limpio = avancesValidos(avances);
  const id = Number(vtuberId);
  const e = await conTablas(ejecutor);

  // Los lotes viejos no sirven para nada: un reintento llega en segundos. Se poda de paso, sin trabajo programado.
  await e.execute('DELETE FROM mision_lote WHERE creado < ?', [ahora - 7 * UN_DIA_MS]);
  const nuevo = await e.execute(
    'INSERT INTO mision_lote (id_lote, creado) VALUES (?, ?) ON CONFLICT (id_lote) DO NOTHING',
    [idLote.toLowerCase(), ahora],
  );
  if (!Number(nuevo.rowsAffected ?? 0)) return { duplicado: true, completadas: [] };

  const completadas = [];
  for (const mision of MISIONES) {
    const tocados = Object.keys(mision.requisitos).filter((c) => c in limpio);
    if (!tocados.length) continue;
    const periodo = periodoDe(mision, dia);
    const hecha = await e.execute(
      'SELECT 1 FROM mision_estado WHERE vtuber_id = ? AND mision_id = ? AND periodo = ?',
      [id, mision.id, periodo],
    );
    if (hecha.rows.length) continue;
    for (const contador of tocados) {
      // MIN en la misma sentencia: el progreso nunca pasa de la meta, aunque lleguen dos lotes a la vez.
      const meta = mision.requisitos[contador];
      await e.execute(
        `INSERT INTO mision_progreso (vtuber_id, mision_id, periodo, contador, progreso) VALUES (?, ?, ?, ?, MIN(?, ?))
         ON CONFLICT (vtuber_id, mision_id, periodo, contador) DO UPDATE SET progreso = MIN(?, progreso + ?)`,
        [id, mision.id, periodo, contador, limpio[contador], meta, meta, limpio[contador]],
      );
    }
    const { rows } = await e.execute(
      'SELECT contador, progreso FROM mision_progreso WHERE vtuber_id = ? AND mision_id = ? AND periodo = ?',
      [id, mision.id, periodo],
    );
    const actual = new Map(rows.map((r) => [r.contador, Number(r.progreso)]));
    const cumple = Object.entries(mision.requisitos).every(([c, meta]) => (actual.get(c) ?? 0) >= meta);
    if (!cumple) continue;
    const gano = await e.execute(
      'INSERT INTO mision_estado (vtuber_id, mision_id, periodo, completada) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
      [id, mision.id, periodo, new Date(ahora).toISOString()],
    );
    if (!Number(gano.rowsAffected ?? 0)) continue;
    if (mision.xp > 0)
      await e.execute(
        'INSERT INTO xp_mision (id_mision, vtuber_id, cantidad, dia, creado) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
        [`${id}:${mision.id}:${periodo}`, id, mision.xp, dia, new Date(ahora).toISOString()],
      );
    completadas.push({ id: mision.id, nombre: mision.nombre, tipo: mision.tipo, xp: mision.xp, ...(mision.grado ? { grado: mision.grado } : {}) });
  }
  return { duplicado: false, completadas };
}

/**
 * ¿Puede esta ficha reclamar el grado de una misión? `gradoActual` es el que tiene hoy (`null` si es una carta normal).
 * @returns {{ ok: true } | { ok: false, motivo: 'grado_no_ganable' | 'ficha_deteriorada' | 'ya_tiene_igual_o_mayor' }}
 */
export function elegibilidadDeGrado(gradoActual, gradoMision) {
  const tope = GRADOS.indexOf(GRADO_MAXIMO_POR_MISIONES);
  const objetivo = GRADOS.indexOf(String(gradoMision));
  if (objetivo < 0 || objetivo > tope) return { ok: false, motivo: 'grado_no_ganable' };
  const actual = gradoActual == null || gradoActual === '' ? null : String(gradoActual);
  if (actual === null) return { ok: true };
  if (esGradoDegradado(actual)) return { ok: false, motivo: 'ficha_deteriorada' };
  if (GRADOS.indexOf(actual) >= objetivo) return { ok: false, motivo: 'ya_tiene_igual_o_mayor' };
  return { ok: true };
}

/**
 * Las misiones de una ficha con su progreso. Las diarias muestran el de HOY.
 * @param {{ vtuberId: number, dia: string, gradoActual?: string | null }} entrada
 */
export async function misionesDeFicha(ejecutor, { vtuberId, dia, gradoActual = null }) {
  if (!DIA.test(String(dia))) throw new Error(`día inválido: ${dia}`);
  const id = Number(vtuberId);
  const e = await conTablas(ejecutor);
  const [progresos, estados] = await Promise.all([
    e.execute('SELECT mision_id, periodo, contador, progreso FROM mision_progreso WHERE vtuber_id = ?', [id]),
    e.execute('SELECT mision_id, periodo, completada, reclamada FROM mision_estado WHERE vtuber_id = ?', [id]),
  ]);
  const vista = MISIONES.map((m) => {
    const periodo = periodoDe(m, dia);
    const estado = estados.rows.find((r) => r.mision_id === m.id && r.periodo === periodo);
    const mias = progresos.rows.filter((r) => r.mision_id === m.id && r.periodo === periodo);
    const elegible = m.tipo === 'grado' ? elegibilidadDeGrado(gradoActual, m.grado) : null;
    return {
      id: m.id,
      tipo: m.tipo,
      nombre: m.nombre,
      descripcion: m.descripcion,
      xp: m.xp,
      repetible: m.repetible,
      requisitos: Object.entries(m.requisitos).map(([contador, meta]) => ({
        contador,
        etiqueta: CONTADORES[contador],
        meta,
        progreso: estado ? meta : Number(mias.find((r) => r.contador === contador)?.progreso ?? 0),
      })),
      completada: Boolean(estado),
      ...(m.grado
        ? {
            grado: m.grado,
            reclamada: Boolean(estado?.reclamada),
            reclamable: Boolean(estado) && !estado.reclamada && elegible.ok,
            motivo: estado && !estado.reclamada && !elegible.ok ? elegible.motivo : null,
          }
        : {}),
    };
  });
  return {
    secundarias: vista.filter((m) => m.tipo === 'secundaria'),
    grado: vista.filter((m) => m.tipo === 'grado'),
  };
}

/**
 * Reclama el grado de una misión de grado ya completada: la marca como reclamada y devuelve el grado a aplicar. Quien llama
 * aplica el grado a la carta y, si eso falla, llama a `soltarReclamo` para que se pueda reintentar.
 * La marca va PRIMERO y es un UPDATE condicional: dos clics a la vez no reclaman dos veces.
 */
export async function reclamarGrado(ejecutor, { vtuberId, misionId, gradoActual = null, ahora = Date.now() }) {
  const mision = misionPorId(misionId);
  if (!mision || mision.tipo !== 'grado') throw new MisionError(404, 'mision_no_encontrada', 'Esa misión no existe o no da un grado.');
  const elegible = elegibilidadDeGrado(gradoActual, mision.grado);
  if (!elegible.ok) throw new MisionError(409, elegible.motivo, 'Tu carta ya no puede reclamar este grado.');
  const e = await conTablas(ejecutor);
  const r = await e.execute(
    `UPDATE mision_estado SET reclamada = ? WHERE vtuber_id = ? AND mision_id = ? AND periodo = 'unica' AND reclamada IS NULL`,
    [new Date(ahora).toISOString(), Number(vtuberId), mision.id],
  );
  if (!Number(r.rowsAffected ?? 0)) {
    const hecha = await e.execute(
      `SELECT reclamada FROM mision_estado WHERE vtuber_id = ? AND mision_id = ? AND periodo = 'unica'`,
      [Number(vtuberId), mision.id],
    );
    if (!hecha.rows.length) throw new MisionError(409, 'mision_incompleta', 'Aún no completas esta misión.');
    throw new MisionError(409, 'ya_reclamada', 'Este grado ya se reclamó.');
  }
  // El rastro del reclamo (con el grado que tenía antes) es lo que permite al mantenedor revisarlo y revocarlo.
  await e.execute(
    `INSERT INTO mision_reclamo (vtuber_id, mision_id, grado, grado_previo, reclamado) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (vtuber_id, mision_id) DO UPDATE SET grado = excluded.grado, grado_previo = excluded.grado_previo, reclamado = excluded.reclamado, revocado = NULL`,
    [Number(vtuberId), mision.id, mision.grado, gradoActual == null || gradoActual === '' ? null : String(gradoActual), new Date(ahora).toISOString()],
  );
  return { grado: mision.grado, mision: mision.id };
}

/** Todos los reclamos de grado, el más reciente primero (para el mantenedor). */
export async function listarReclamos(ejecutor) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    'SELECT vtuber_id, mision_id, grado, grado_previo, reclamado, revocado FROM mision_reclamo ORDER BY reclamado DESC',
  );
  return rows.map((r) => ({
    vtuberId: Number(r.vtuber_id),
    misionId: String(r.mision_id),
    grado: String(r.grado),
    gradoPrevio: r.grado_previo == null ? null : String(r.grado_previo),
    reclamado: String(r.reclamado),
    revocado: r.revocado == null ? null : String(r.revocado),
  }));
}

/**
 * Revoca un reclamo: lo marca (UPDATE condicional, una sola vez) y devuelve qué grado quitar y a cuál volver. La misión
 * sigue completada y reclamada: quien abusó no puede volver a reclamarla. Aplicar el cambio a la carta lo hace quien llama,
 * y solo si la carta todavía lleva ese grado (si una donación la subió después, no se toca).
 * @returns {Promise<{ grado: string, gradoPrevio: string | null }>}
 */
export async function revocarReclamo(ejecutor, { vtuberId, misionId, ahora = Date.now() }) {
  const e = await conTablas(ejecutor);
  const r = await e.execute(
    'UPDATE mision_reclamo SET revocado = ? WHERE vtuber_id = ? AND mision_id = ? AND revocado IS NULL',
    [new Date(ahora).toISOString(), Number(vtuberId), String(misionId)],
  );
  if (!Number(r.rowsAffected ?? 0)) throw new MisionError(404, 'reclamo_no_encontrado', 'No hay un reclamo vigente de esa misión.');
  const { rows } = await e.execute('SELECT grado, grado_previo FROM mision_reclamo WHERE vtuber_id = ? AND mision_id = ?', [Number(vtuberId), String(misionId)]);
  return { grado: String(rows[0].grado), gradoPrevio: rows[0].grado_previo == null ? null : String(rows[0].grado_previo) };
}

/** Deshace la marca de `reclamarGrado` (el grado no se pudo aplicar a la carta). */
export async function soltarReclamo(ejecutor, { vtuberId, misionId }) {
  const e = await conTablas(ejecutor);
  await e.execute(
    `UPDATE mision_estado SET reclamada = NULL WHERE vtuber_id = ? AND mision_id = ? AND periodo = 'unica'`,
    [Number(vtuberId), String(misionId)],
  );
  await e.execute('DELETE FROM mision_reclamo WHERE vtuber_id = ? AND mision_id = ?', [Number(vtuberId), String(misionId)]);
}

/**
 * Cómo van las misiones en la práctica, para AJUSTAR la dificultad con datos y no a ojo: por misión, cuántas fichas la
 * completaron y, de las que están en camino (misiones únicas), el avance medio y el mejor. Si una misión de grado nadie la
 * toca después de semanas de juego, sus metas están altas; si la completan en un día, bajas.
 * @returns {Promise<Array<{ id: string, tipo: string, completaron: number, veces: number, enCamino: number, avanceMedio: number, avanceMaximo: number }>>}
 */
export async function resumenDeMisiones(ejecutor) {
  const e = await conTablas(ejecutor);
  const [estados, progresos] = await Promise.all([
    e.execute('SELECT mision_id, COUNT(DISTINCT vtuber_id) AS fichas, COUNT(*) AS veces FROM mision_estado GROUP BY mision_id'),
    e.execute("SELECT vtuber_id, mision_id, contador, progreso FROM mision_progreso WHERE periodo = 'unica'"),
  ]);
  const hechas = new Set(
    (await e.execute("SELECT vtuber_id, mision_id FROM mision_estado WHERE periodo = 'unica'")).rows.map((r) => `${r.vtuber_id}:${r.mision_id}`),
  );
  return MISIONES.map((m) => {
    const fila = estados.rows.find((r) => r.mision_id === m.id);
    const avances = new Map();
    for (const r of progresos.rows) {
      if (r.mision_id !== m.id || hechas.has(`${r.vtuber_id}:${m.id}`)) continue;
      const meta = m.requisitos[r.contador];
      if (meta) avances.set(Number(r.vtuber_id), (avances.get(Number(r.vtuber_id)) ?? 0) + Math.min(1, Number(r.progreso) / meta));
    }
    const porcentajes = [...avances.values()].map((suma) => Math.round((100 * suma) / Object.keys(m.requisitos).length));
    return {
      id: m.id,
      tipo: m.tipo,
      completaron: Number(fila?.fichas ?? 0),
      veces: Number(fila?.veces ?? 0),
      enCamino: porcentajes.length,
      avanceMedio: porcentajes.length ? Math.round(porcentajes.reduce((a, b) => a + b, 0) / porcentajes.length) : 0,
      avanceMaximo: porcentajes.length ? Math.max(...porcentajes) : 0,
    };
  });
}
