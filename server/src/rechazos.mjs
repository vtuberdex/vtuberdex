/**
 * RECHAZOS: un registro mínimo de los envíos que los formularios públicos NO aceptaron.
 *
 * Por qué existe: una validación que falla responde 400/409/410 y no deja rastro (solo los 503 se
 * imprimen), así que si una persona no podía terminar su inscripción nadie podía saber dónde se
 * atascaba. Aquí queda QUÉ formulario, QUÉ código y QUÉ campo, para verlo agregado en el mantenedor.
 *
 * LO QUE NO SE GUARDA, A PROPÓSITO: ni el correo, ni el contenido de ningún campo, ni la red, ni el
 * mensaje de error (puede citar lo escrito). Los términos prometen que el correo es confidencial y
 * esto es un diagnóstico, no un archivo de personas. Solo se conservan 30 días.
 *
 * Es JS puro sobre un EJECUTOR `{ execute, exec }`, igual que `solicitudes.mjs`: mismo SQL en
 * producción (Turso/`file:`) y en los tests (SQLite). `registrarRechazo` NUNCA lanza: si la base
 * falla, perder un apunte es mejor que convertir un 400 en un 500.
 */
const DDL = `
  CREATE TABLE IF NOT EXISTS rechazo (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    creado      TEXT NOT NULL,
    formulario  TEXT NOT NULL,
    codigo      TEXT NOT NULL,
    status      INTEGER NOT NULL,
    campos      TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_rechazo_creado ON rechazo (creado);
`;

/** Días que se conserva un apunte. */
export const VIDA_RECHAZOS_DIAS = 30;

const DIA_MS = 24 * 60 * 60 * 1000;
const tablasListas = new WeakMap();

async function conTabla(ejecutor) {
  if (!tablasListas.has(ejecutor)) {
    const promesa = Promise.resolve(ejecutor.exec(DDL)).catch((error) => {
      tablasListas.delete(ejecutor);
      throw error;
    });
    tablasListas.set(ejecutor, promesa);
  }
  await tablasListas.get(ejecutor);
  return ejecutor;
}

/** Solo rutas de campo (`socials.0.url`): una lista blanca de caracteres, acotada, sin texto libre. */
function camposDeLasIssues(issues) {
  if (!Array.isArray(issues)) return '';
  const rutas = [];
  for (const issue of issues) {
    const ruta = String(issue?.path ?? '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 60);
    if (ruta && !rutas.includes(ruta)) rutas.push(ruta);
    if (rutas.length === 5) break;
  }
  return rutas.join(',');
}

/**
 * Apunta un rechazo y poda los de más de 30 días.
 * @param {{ execute: Function, exec: Function }} ejecutor
 * @param {{ formulario: string, codigo: string, status: number, issues?: Array<{ path?: string }>, ahora?: Date }} rechazo
 */
export async function registrarRechazo(ejecutor, { formulario, codigo, status, issues, ahora = new Date() }) {
  try {
    const e = await conTabla(ejecutor);
    await e.execute('INSERT INTO rechazo (creado, formulario, codigo, status, campos) VALUES (?, ?, ?, ?, ?)', [
      ahora.toISOString(),
      String(formulario).slice(0, 40),
      String(codigo ?? 'desconocido').slice(0, 60),
      Number(status) || 0,
      camposDeLasIssues(issues),
    ]);
    await e.execute('DELETE FROM rechazo WHERE creado < ?', [new Date(ahora.getTime() - VIDA_RECHAZOS_DIAS * DIA_MS).toISOString()]);
  } catch (error) {
    console.error(`[rechazos] no se pudo anotar: ${error.message}`);
  }
}

/**
 * Lo que vio el formulario en los últimos `dias`: cuántos rechazos hubo por formulario + código, y
 * qué campos los provocaron. Ordenado por frecuencia.
 * @returns {Promise<{ dias: number, total: number, porCodigo: Array<{ formulario: string, codigo: string, status: number, n: number }>, porCampo: Array<{ formulario: string, campo: string, n: number }>, ultimo: string | null }>}
 */
export async function resumenDeRechazos(ejecutor, { dias = 7, ahora = new Date() } = {}) {
  const e = await conTabla(ejecutor);
  const desde = new Date(ahora.getTime() - dias * DIA_MS).toISOString();
  const { rows: porCodigo } = await e.execute(
    `SELECT formulario, codigo, MAX(status) AS status, COUNT(*) AS n FROM rechazo WHERE creado >= ?
     GROUP BY formulario, codigo ORDER BY n DESC, formulario, codigo`,
    [desde],
  );
  const { rows: filas } = await e.execute("SELECT formulario, campos, creado FROM rechazo WHERE creado >= ? AND campos != ''", [desde]);
  const cuenta = new Map();
  for (const fila of filas) {
    for (const campo of String(fila.campos).split(',')) {
      const clave = `${fila.formulario}\u0000${campo}`;
      cuenta.set(clave, (cuenta.get(clave) ?? 0) + 1);
    }
  }
  const porCampo = [...cuenta]
    .map(([clave, n]) => {
      const [formulario, campo] = clave.split('\u0000');
      return { formulario, campo, n };
    })
    .sort((a, b) => b.n - a.n || a.campo.localeCompare(b.campo));
  const { rows: ult } = await e.execute('SELECT MAX(creado) AS ultimo FROM rechazo WHERE creado >= ?', [desde]);
  return {
    dias,
    total: porCodigo.reduce((suma, fila) => suma + Number(fila.n), 0),
    porCodigo: porCodigo.map((fila) => ({ formulario: String(fila.formulario), codigo: String(fila.codigo), status: Number(fila.status), n: Number(fila.n) })),
    porCampo,
    ultimo: ult[0]?.ultimo ? String(ult[0].ultimo) : null,
  };
}
