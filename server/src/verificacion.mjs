/**
 * TOKENS DE UN SOLO USO enviados por correo: verificar una solicitud y entrar al mantenedor.
 *
 * Es JS puro sobre un EJECUTOR (`{ execute, exec }`, la forma del cliente de Turso), igual que
 * `solicitudes.mjs`: la misma definición corre en producción (Turso/`file:`) y en los tests (SQLite).
 *
 * QUÉ SE GUARDA Y QUÉ NO
 * ----------------------
 * Solo el HASH (sha256) del token. El token en claro existe un instante en memoria y en el correo:
 * si alguien lee la base (un respaldo, una copia de `/tmp`), no puede usar los enlaces pendientes.
 * 32 bytes aleatorios bastan: no hace falta un hash lento porque no es una contraseña elegida por
 * una persona y no se puede adivinar.
 *
 * UN TOKEN, UN USO
 * ----------------
 * `consumirToken` es un único `UPDATE ... WHERE usado = 0 AND expira > ahora`: dos clics a la vez
 * (o un escáner de correo y la persona) no lo gastan dos veces, el segundo ve 0 filas cambiadas.
 * Por eso la confirmación exige un botón (un POST) y no se consume al abrir el enlace: muchos
 * clientes y antivirus abren los enlaces de los correos para inspeccionarlos.
 *
 * LÍMITE POR CORREO
 * -----------------
 * Como el formulario envía correo a la dirección que escribe cualquiera, sin un tope serviría para
 * inundar el buzón de un tercero. `envioPermitido` cuenta los tokens ya emitidos a ese correo
 * (el tope por red de las solicitudes no basta: el atacante cambia de red, la víctima no).
 */
import crypto from 'node:crypto';

/**
 * `solicitud`: confirma una inscripción/baja ya enviada. `admin`: acceso al mantenedor. `modificacion`:
 * el CÓDIGO que se manda ANTES de rellenar el formulario de cambios (demuestra que el correo es de quien lo
 * escribe). `permiso`: lo que ese código se canjea (no viaja por correo, se devuelve en la respuesta) y
 * autoriza UN envío del formulario de cambios con ese correo. `inscripcion`: el código del formulario de
 * inscripción. `sesion`: lo que ese código se canjea; a diferencia del `permiso` NO se gasta al guardar el
 * borrador (se puede usar muchas veces mientras se rellena) y solo se gasta al enviar la inscripción.
 */
export const PROPOSITOS = ['solicitud', 'admin', 'modificacion', 'permiso', 'inscripcion', 'sesion', 'ficha'];
// `ficha`: el enlace mágico de «Mi ficha» (subir los puntos de habilidad). A diferencia del resto NO se gasta:
// se MIRA (`correoDelToken`) cada vez que se usa la página y simplemente caduca.

/** Vida del token: 24 h para confirmar una solicitud, 15 min para un enlace de acceso. */
export const TTL_MS = {
  solicitud: 24 * 60 * 60 * 1000,
  admin: 15 * 60 * 1000,
  modificacion: 60 * 60 * 1000,
  // Tiempo para rellenar el formulario de cambios, que es largo: no se pierde el trabajo por un descuido.
  permiso: 2 * 60 * 60 * 1000,
  inscripcion: 60 * 60 * 1000,
  // Rellenar la inscripción lleva rato y se puede dejar a medias: la sesión dura el día, y el BORRADOR más.
  sesion: 24 * 60 * 60 * 1000,
  // Los puntos se reparten con calma y en varias visitas: una semana, sin gastarse. Pedir otro enlace es gratis.
  ficha: 7 * 24 * 60 * 60 * 1000,
};

/** Entre dos correos al mismo destinatario, y cuántos como máximo por día. */
export const ESPERA_ENTRE_ENVIOS_MS = 60 * 1000;
export const MAX_ENVIOS_POR_CORREO_Y_DIA = 4;

const DDL = `
  CREATE TABLE IF NOT EXISTS token_correo (
    hash          TEXT PRIMARY KEY,
    proposito     TEXT NOT NULL,
    email         TEXT NOT NULL,
    solicitud_id  INTEGER,
    creado        INTEGER NOT NULL,
    expira        INTEGER NOT NULL,
    usado         INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_token_correo_email ON token_correo (email, proposito, creado);
`;

const tablasListas = new WeakMap();
async function conTablas(ejecutor) {
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

const hashDe = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

/** ¿Se le puede enviar otro correo a esta dirección ahora? Devuelve `{ ok }` o `{ ok:false, motivo }`. */
export async function envioPermitido(
  ejecutor,
  { email, proposito, ahora = Date.now(), maximo = MAX_ENVIOS_POR_CORREO_Y_DIA, espera = ESPERA_ENTRE_ENVIOS_MS },
) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    'SELECT creado FROM token_correo WHERE email = ? AND proposito = ? AND creado >= ? ORDER BY creado DESC',
    [email, proposito, ahora - 24 * 60 * 60 * 1000],
  );
  if (rows.length >= maximo) return { ok: false, motivo: 'tope_diario' };
  if (rows[0] && ahora - Number(rows[0].creado) < espera) return { ok: false, motivo: 'demasiado_pronto' };
  return { ok: true };
}

/**
 * Emite un token nuevo y devuelve el valor EN CLARO (para el enlace del correo).
 * @param {any} ejecutor
 * @param {{ proposito: string, email: string, solicitudId?: number | null, ahora?: number }} datos
 */
export async function crearToken(ejecutor, { proposito, email, solicitudId = null, ahora = Date.now() }) {
  if (!PROPOSITOS.includes(proposito)) throw new Error(`propósito de token desconocido: ${proposito}`);
  const e = await conTablas(ejecutor);
  const token = crypto.randomBytes(32).toString('base64url');
  await e.execute(
    'INSERT INTO token_correo (hash, proposito, email, solicitud_id, creado, expira) VALUES (?, ?, ?, ?, ?, ?)',
    [hashDe(token), proposito, email, solicitudId, ahora, ahora + TTL_MS[proposito]],
  );
  return token;
}

/**
 * Mira de quién es un token vigente SIN gastarlo. Sirve para validar un formulario con el correo ya
 * verificado y gastar el token solo cuando todo lo demás pasó (un error de validación no lo quema).
 * Devuelve `{ email }` o `null`.
 */
export async function correoDelToken(ejecutor, token, proposito, ahora = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    'SELECT email FROM token_correo WHERE hash = ? AND proposito = ? AND usado = 0 AND expira > ?',
    [hashDe(token), proposito, ahora],
  );
  return rows[0] ? { email: rows[0].email } : null;
}

/**
 * Gasta el token si existe, es del propósito pedido, no caducó y no se usó. Devuelve
 * `{ email, solicitudId }` o `null`. Un token que no sirve no dice POR QUÉ no sirve.
 */
export async function consumirToken(ejecutor, token, proposito, ahora = Date.now()) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const e = await conTablas(ejecutor);
  const hash = hashDe(token);
  const cambio = await e.execute(
    'UPDATE token_correo SET usado = 1 WHERE hash = ? AND proposito = ? AND usado = 0 AND expira > ?',
    [hash, proposito, ahora],
  );
  if (cambio.rowsAffected === 0) return null;
  const { rows } = await e.execute('SELECT email, solicitud_id FROM token_correo WHERE hash = ?', [hash]);
  return rows[0] ? { email: rows[0].email, solicitudId: rows[0].solicitud_id == null ? null : Number(rows[0].solicitud_id) } : null;
}

/** Borra los tokens de una solicitud (al reemplazarla o descartarla) y los caducados hace más de 2 días. */
export async function limpiarTokens(ejecutor, { solicitudId = null, ahora = Date.now() } = {}) {
  const e = await conTablas(ejecutor);
  if (solicitudId != null) await e.execute('DELETE FROM token_correo WHERE solicitud_id = ?', [solicitudId]);
  await e.execute('DELETE FROM token_correo WHERE expira < ? AND proposito = ?', [ahora - 2 * 24 * 60 * 60 * 1000, 'solicitud']);
  await e.execute('DELETE FROM token_correo WHERE expira < ? AND proposito = ?', [ahora - 2 * 24 * 60 * 60 * 1000, 'admin']);
}
