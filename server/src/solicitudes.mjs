/**
 * SOLICITUDES: las inscripciones de fichas y las bajas que llegan desde el formulario PÚBLICO.
 *
 * Nada de lo que entra por aquí toca el catálogo. Cada envío queda en la tabla `solicitud` como
 * `pendiente` hasta que el mantenedor lo revisa; solo entonces una inscripción aprobada se
 * convierte en una ficha (siempre en BORRADOR, así que además hay que publicarla a mano).
 *
 * UNA SOLA DEFINICIÓN, DOS EJECUTORES
 * -----------------------------------
 * Este archivo es JS puro y no sabe dónde vive la tabla. Cada función recibe un EJECUTOR
 * (`{ execute(sql, args) -> { rows, rowsAffected }, exec(sql) }`, la forma del cliente de Turso).
 * Producción le pasa Turso (`lib/solicitudes.mjs`); el Express local y los tests, un SQLite
 * (`ejecutorSqlite`). El SQL es el mismo en los dos, igual que en `lib/likes.mjs`: lo que se
 * prueba en local es lo que corre en producción. El servidor no puede importar `@libsql/client`
 * (vive en el paquete raíz), por eso esta capa no lo toca.
 *
 * DATOS PERSONALES: DOS COLUMNAS, NO UNA
 * --------------------------------------
 * Los términos prometen que el correo y el nombre real son confidenciales y no se publican.
 * Esa promesa se cumple por estructura: lo que puede acabar en la ficha va en `datos` y lo
 * confidencial en `contacto`. `fichaDesdeInscripcion` solo lee `datos`, de modo que ni un
 * descuido del mantenedor puede copiar un correo a una carta pública. Al resolver una baja o
 * rechazar una inscripción, `contacto` se BORRA (queda `null`): no hay motivo para conservarlo.
 *
 * LA VERSIÓN DE LOS TÉRMINOS SE GUARDA CON CADA ENVÍO
 * ---------------------------------------------------
 * `terminos_version` y `terminos_aceptados_en` son la prueba de qué texto se aceptó y cuándo. Si
 * mañana cambian los términos, las solicitudes antiguas siguen diciendo cuáles aceptaron, y el
 * formulario de un navegador con la página vieja abierta se rechaza (`terminos_desactualizados`)
 * en vez de registrar una aceptación de un texto que ya no existe.
 */
import crypto from 'node:crypto';

import { z } from 'zod';

import { TERMINOS_VERSION } from './terminos-version.mjs';

export { TERMINOS_VERSION };

/** Tipos y estados de una solicitud. */
export const TIPOS = ['inscripcion', 'baja'];
export const ESTADOS = ['pendiente', 'aprobada', 'rechazada', 'procesada'];

/**
 * Envíos por red y por día. No es 1 porque las redes móviles y las casas comparten IP (NAT) y
 * bloquearía a gente legítima (ver el razonamiento en `lib/likes.mjs`); frena el abuso casual,
 * no a quien quiera inundar con muchas IP.
 */
export const MAX_POR_RED_Y_DIA = 5;

const DDL = `
  CREATE TABLE IF NOT EXISTS solicitud (
    id                     INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo                   TEXT NOT NULL,
    estado                 TEXT NOT NULL DEFAULT 'pendiente',
    datos                  TEXT NOT NULL,
    contacto               TEXT,
    red                    TEXT NOT NULL,
    terminos_version       TEXT NOT NULL,
    terminos_aceptados_en  TEXT NOT NULL,
    creado                 TEXT NOT NULL,
    resuelto               TEXT,
    resuelto_por           TEXT,
    nota                   TEXT,
    vtuber_slug            TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_solicitud_estado ON solicitud (estado, tipo, id);
  CREATE INDEX IF NOT EXISTS idx_solicitud_red ON solicitud (red, creado);
`;

export class SolicitudError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.name = 'SolicitudError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? code;
  }
}

/* ----------------------------------------------------------------- ejecutores */

/** Un ejecutor sobre un `DatabaseSync` de `node:sqlite`, con la misma forma que el cliente de Turso. */
export function ejecutorSqlite(db) {
  return {
    async execute(sql, args = []) {
      const sentencia = db.prepare(sql);
      if (/^\s*select/i.test(sql)) return { rows: sentencia.all(...args).map((fila) => ({ ...fila })), rowsAffected: 0 };
      const info = sentencia.run(...args);
      return { rows: [], rowsAffected: Number(info.changes), lastInsertRowid: info.lastInsertRowid };
    },
    async exec(sql) {
      db.exec(sql);
    },
  };
}

/** DDL memoizado como PROMESA por ejecutor; si falla se suelta para no dejar rotas las lecturas siguientes. */
const tablasListas = new WeakMap();
export async function conTablas(ejecutor) {
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

/* ----------------------------------------------------------------- validación */

const texto = (max) => z.string().trim().max(max);
const textoOpcional = (max) => texto(max).optional().default('');

const urlHttp = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((valor) => /^https?:\/\/\S+$/i.test(valor), 'debe ser una URL http(s)');

const correo = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .refine((valor) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(valor), 'correo no válido');

/**
 * El «he leído y acepto». `z.literal(true)` y no `z.boolean()`: un `false` o un campo ausente
 * deben fallar con un mensaje propio, no pasar. Se comprueba también en el servidor porque un
 * `required` de HTML no frena a quien llama a la API directamente.
 */
const aceptacion = {
  aceptaTerminos: z.literal(true, { error: 'debes aceptar los términos y condiciones' }),
  terminosVersion: z.string().trim().max(40),
  /** Trampa para bots: un campo oculto que una persona nunca rellena. */
  website: z.string().max(200).optional().default(''),
};

export const inscripcionSchema = z.object({
  /** Nombre con el que aparecerá la ficha. */
  name: texto(160).min(1, 'falta el nombre artístico'),
  /** CONFIDENCIAL: solo para que el mantenedor pueda contestar. */
  email: correo,
  /** CONFIDENCIAL y opcional. */
  realName: textoOpcional(160),
  country: texto(60).min(1, 'falta el país'),
  languages: z.array(texto(8).min(2)).min(1, 'indica al menos un idioma').max(6),
  phrase: textoOpcional(600),
  cardText: textoOpcional(4000),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color hexadecimal #rrggbb')
    .optional()
    .or(z.literal('')),
  /** Dónde está el arte del personaje: el mantenedor lo descarga y lo sube; el formulario no recibe archivos. */
  imageUrl: urlHttp.optional().or(z.literal('')),
  socials: z
    .array(z.object({ platform: texto(40).min(1), url: urlHttp }))
    .min(1, 'indica al menos una red o canal donde se te pueda ver')
    .max(10),
  ...aceptacion,
});

export const bajaSchema = z.object({
  /** Nombre o URL (`/v/<slug>`) de la ficha que se quiere dar de baja. */
  ficha: texto(300).min(1, 'indica qué ficha quieres dar de baja'),
  /** CONFIDENCIAL. */
  email: correo,
  /** Cómo demostrar que quien pide la baja es el titular: un canal propio donde dejar una marca. */
  prueba: texto(500).min(5, 'indica cómo podemos comprobar que eres el titular'),
  motivo: textoOpcional(2000),
  ...aceptacion,
});

/* ------------------------------------------------------------------ operaciones */

const aJson = (valor) => JSON.stringify(valor);
const deJson = (texto) => {
  try {
    return texto ? JSON.parse(texto) : null;
  } catch {
    return null;
  }
};

/** Hash con sal de la IP: lo único que se guarda de la red del que envía, nunca la IP. */
export function hashearRed(ip, sal = process.env.VTUBERDEX_LIKES_SAL ?? 'vtuberdex') {
  return crypto.createHash('sha256').update(`${sal}:${ip || 'desconocida'}`).digest('hex').slice(0, 32);
}

/**
 * Valida y guarda una solicitud nueva.
 * @param {object} entrada cuerpo ya parseado por el esquema de su tipo
 * @param {{ tipo: 'inscripcion'|'baja', ip?: string, ahora?: Date }} contexto
 */
export async function crearSolicitud(ejecutor, entrada, { tipo, ip, ahora = new Date() }) {
  if (!TIPOS.includes(tipo)) throw new SolicitudError(400, 'tipo_invalido', tipo);
  const esquema = tipo === 'inscripcion' ? inscripcionSchema : bajaSchema;
  const parsed = esquema.safeParse(entrada ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
    throw Object.assign(new SolicitudError(400, 'payload_invalido', issues[0]?.message ?? 'datos no válidos'), { issues });
  }
  const { aceptaTerminos: _acepta, terminosVersion, website, email, realName, ...datos } = parsed.data;
  // Un bot rellena el campo oculto. Se responde como si todo fuera bien (sin pista de qué lo delató)
  // pero no se guarda nada.
  if (website) return { id: null, descartada: true };
  if (terminosVersion !== TERMINOS_VERSION) {
    throw new SolicitudError(409, 'terminos_desactualizados', 'los términos cambiaron: recarga la página y vuelve a aceptarlos');
  }

  const e = await conTablas(ejecutor);
  const red = hashearRed(ip);
  const desde = new Date(ahora.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { rows } = await e.execute('SELECT COUNT(*) AS n FROM solicitud WHERE red = ? AND creado >= ?', [red, desde]);
  if (Number(rows[0]?.n ?? 0) >= MAX_POR_RED_Y_DIA) {
    throw new SolicitudError(429, 'demasiadas_solicitudes', 'se alcanzó el máximo de envíos de hoy desde esta red');
  }
  // Un mismo correo no puede tener dos solicitudes pendientes del mismo tipo: se reenvía la
  // misma inscripción por impaciencia y llenaría la cola del mantenedor de duplicados.
  const pendientes = await e.execute(
    "SELECT contacto FROM solicitud WHERE tipo = ? AND estado = 'pendiente' AND contacto IS NOT NULL",
    [tipo],
  );
  if (pendientes.rows.some((fila) => deJson(fila.contacto)?.email === email)) {
    throw new SolicitudError(409, 'solicitud_pendiente', 'ya hay una solicitud tuya en espera de revisión');
  }

  const contacto = { email, ...(realName ? { realName } : {}) };
  const fecha = ahora.toISOString();
  const insertada = await e.execute(
    `INSERT INTO solicitud (tipo, datos, contacto, red, terminos_version, terminos_aceptados_en, creado)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [tipo, aJson(datos), aJson(contacto), red, terminosVersion, fecha, fecha],
  );
  const { rows: ultimo } = await e.execute('SELECT MAX(id) AS id FROM solicitud WHERE red = ?', [red]);
  return { id: Number(insertada.lastInsertRowid ?? ultimo[0]?.id ?? 0) || null, descartada: false };
}

function mapear(fila) {
  return {
    id: Number(fila.id),
    tipo: fila.tipo,
    estado: fila.estado,
    datos: deJson(fila.datos) ?? {},
    contacto: deJson(fila.contacto),
    terminosVersion: fila.terminos_version,
    terminosAceptadosEn: fila.terminos_aceptados_en,
    creado: fila.creado,
    resuelto: fila.resuelto,
    resueltoPor: fila.resuelto_por,
    nota: fila.nota,
    vtuberSlug: fila.vtuber_slug,
  };
}

/** Listado para el mantenedor, de la más antigua a la más nueva (la cola se atiende en orden). */
export async function listarSolicitudes(ejecutor, { estado = 'pendiente', tipo = null } = {}) {
  const e = await conTablas(ejecutor);
  const condiciones = [];
  const args = [];
  if (estado && estado !== 'todas') {
    condiciones.push('estado = ?');
    args.push(estado);
  }
  if (tipo) {
    condiciones.push('tipo = ?');
    args.push(tipo);
  }
  const donde = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await e.execute(`SELECT * FROM solicitud ${donde} ORDER BY id ASC LIMIT 500`, args);
  const { rows: cuentas } = await e.execute("SELECT tipo, COUNT(*) AS n FROM solicitud WHERE estado = 'pendiente' GROUP BY tipo");
  const pendientes = { inscripcion: 0, baja: 0 };
  for (const c of cuentas) pendientes[c.tipo] = Number(c.n);
  return { items: rows.map(mapear), pendientes };
}

export async function leerSolicitud(ejecutor, id) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute('SELECT * FROM solicitud WHERE id = ?', [Number(id)]);
  return rows[0] ? mapear(rows[0]) : null;
}

/**
 * Cierra una solicitud PENDIENTE. El `WHERE estado = 'pendiente'` hace de cerrojo: dos
 * mantenedores que pulsen a la vez no la resuelven dos veces (el segundo ve 0 filas cambiadas).
 * El contacto confidencial se borra al cerrar, salvo en una inscripción aprobada, donde sigue
 * haciendo falta para avisar a la persona de que su ficha está lista.
 *
 * @param {any} ejecutor
 * @param {number|string} id
 * @param {{ estado: string, actor?: string, nota?: string, vtuberSlug?: string | null, ahora?: Date }} opciones
 */
export async function resolverSolicitud(ejecutor, id, { estado, actor, nota = '', vtuberSlug = null, ahora = new Date() }) {
  if (!['aprobada', 'rechazada', 'procesada'].includes(estado)) throw new SolicitudError(400, 'estado_invalido', estado);
  const e = await conTablas(ejecutor);
  const actual = await leerSolicitud(e, id);
  if (!actual) throw new SolicitudError(404, 'no_encontrado', `no existe la solicitud ${id}`);
  const permitido = actual.tipo === 'inscripcion' ? ['aprobada', 'rechazada'] : ['procesada', 'rechazada'];
  if (!permitido.includes(estado)) {
    throw new SolicitudError(400, 'estado_invalido', `una ${actual.tipo} no puede quedar «${estado}»`);
  }
  const conservaContacto = actual.tipo === 'inscripcion' && estado === 'aprobada';
  const cambio = await e.execute(
    `UPDATE solicitud
        SET estado = ?, resuelto = ?, resuelto_por = ?, nota = ?, vtuber_slug = ?,
            contacto = CASE WHEN ? = 1 THEN contacto ELSE NULL END
      WHERE id = ? AND estado = 'pendiente'`,
    [estado, ahora.toISOString(), actor ?? 'admin', String(nota).slice(0, 2000), vtuberSlug, conservaContacto ? 1 : 0, Number(id)],
  );
  if (cambio.rowsAffected === 0) throw new SolicitudError(409, 'ya_resuelta', 'esta solicitud ya fue resuelta');
  return leerSolicitud(e, id);
}

/**
 * Los datos de la ficha que nace de una inscripción aprobada. Solo lee `datos` (lo público):
 * el correo y el nombre real están en `contacto` y no pueden colarse. Siempre `draft`.
 */
export function fichaDesdeInscripcion(solicitud) {
  const d = solicitud.datos;
  const ficha = {
    name: d.name,
    status: 'draft',
    countries: d.country ? [d.country] : [],
    languages: d.languages ?? [],
    socials: (d.socials ?? []).map((s) => ({ platform: s.platform, url: s.url })),
  };
  if (d.phrase) ficha.phrase = d.phrase;
  if (d.cardText) ficha.cardText = d.cardText;
  if (d.themeColor) ficha.themeColor = d.themeColor;
  return ficha;
}
