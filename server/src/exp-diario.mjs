/**
 * EXP automática por el diario de cambios: +10 por cada acción crear / modificar / aprobar.
 *
 * Libro de eventos `exp_evento` con clave primaria = id del cambio: cada acción otorga EXP UNA sola vez
 * (idempotencia), llegue por el hook automático o por el cómputo retroactivo. La EXP del perfil (el actor) es
 * la suma del libro, no un contador aparte, así que no puede desincronizarse.
 */
export const EXP_POR_ACCION = 10;
/** Tipos de operación del diario que dan EXP. */
export const TIPOS_CON_EXP = ["vtuber.crear", "vtuber.editar", "vtuber.estado"];

const DDL = `CREATE TABLE IF NOT EXISTS exp_evento (
  cambio_id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  tipo TEXT NOT NULL,
  cantidad INTEGER NOT NULL,
  creado TEXT NOT NULL
)`;

async function tabla(ejecutor) {
  await ejecutor.execute(DDL, []);
  return ejecutor;
}

/** Otorga EXP por un cambio del diario. Devuelve lo sumado (0 si el tipo no cuenta o ya estaba otorgado). */
export async function otorgarExp(ejecutor, { cambioId, tipo, actor, ahora = Date.now() }) {
  if (!TIPOS_CON_EXP.includes(tipo)) return 0;
  const id = Number(cambioId);
  if (!Number.isInteger(id)) throw new Error(`cambio inválido: ${cambioId}`);
  const e = await tabla(ejecutor);
  const r = await e.execute(
    "INSERT OR IGNORE INTO exp_evento (cambio_id, actor, tipo, cantidad, creado) VALUES (?, ?, ?, ?, ?)",
    [id, String(actor), tipo, EXP_POR_ACCION, new Date(ahora).toISOString()],
  );
  return Number(r.rowsAffected ?? 0) ? EXP_POR_ACCION : 0;
}

/** EXP acumulada del perfil (actor). */
export async function expDePerfil(ejecutor, actor) {
  const e = await tabla(ejecutor);
  const { rows } = await e.execute(
    "SELECT COALESCE(SUM(cantidad), 0) AS n FROM exp_evento WHERE actor = ?",
    [String(actor)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Cómputo retroactivo único: otorga las acciones del historial de `cambio` del actor que aún no tienen evento.
 * Seguro de repetir. Devuelve la EXP sumada en esta pasada.
 */
export async function expRetroactiva(ejecutor, actor) {
  const e = await tabla(ejecutor);
  const marcas = TIPOS_CON_EXP.map(() => "?").join(",");
  const r = await e.execute(
    `INSERT OR IGNORE INTO exp_evento (cambio_id, actor, tipo, cantidad, creado)
     SELECT seq, actor, tipo, ?, ? FROM cambio WHERE actor = ? AND tipo IN (${marcas})`,
    [EXP_POR_ACCION, new Date().toISOString(), String(actor), ...TIPOS_CON_EXP],
  );
  return Number(r.rowsAffected ?? 0) * EXP_POR_ACCION;
}
