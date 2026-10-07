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
 * Los términos prometen que el correo es confidencial y no se publican.
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
import { consumirToken, correoDelToken } from './verificacion.mjs';

export { TERMINOS_VERSION };

/** Tipos y estados de una solicitud. */
export const TIPOS = ['inscripcion', 'baja', 'modificacion'];
/**
 * `sin_verificar`: entró por el formulario pero su correo aún no confirmó el token. El mantenedor NO la
 * ve (su cola lista `pendiente`): así una solicitud con el correo de otra persona, o inventado, no
 * llega nunca a su bandeja. Pasa a `pendiente` cuando se usa el enlace que se mandó a ese correo.
 */
export const ESTADOS = ['sin_verificar', 'pendiente', 'aprobada', 'rechazada', 'procesada'];

/** Cuánto vive una solicitud sin confirmar antes de borrarla (el token caduca a las 24 h). */
const VIDA_SIN_VERIFICAR_MS = 3 * 24 * 60 * 60 * 1000;

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
  CREATE TABLE IF NOT EXISTS ficha_correo (
    vtuber_id   INTEGER PRIMARY KEY,
    email       TEXT NOT NULL,
    actualizado TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS graduado (
    vtuber_id INTEGER PRIMARY KEY,
    desde     TEXT NOT NULL
  );
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

/**
 * Los textos cortos de la ficha que pide el formulario: `[clave, máximo, cómo se nombra en el mensaje]`.
 * La inscripción los exige todos; la modificación los acepta en blanco (en blanco = no cambia).
 */
export const PERFIL_CAMPOS = [
  ['height', 40, 'la estatura'],
  ['birthday', 80, 'el cumpleaños'],
  ['favoriteFood', 120, 'la comida favorita'],
  ['dislikedFood', 120, 'la comida que te desagrada'],
  ['favoriteGame', 120, 'el videojuego favorito'],
  ['favoriteSeries', 120, 'la serie favorita'],
  ['favoriteMusic', 120, 'la música favorita'],
  ['favoriteAnime', 120, 'el anime favorito'],
  ['favoriteAnimal', 120, 'el animal favorito'],
  ['favoriteColor', 80, 'el color favorito'],
  ['modeler', 80, 'quién hizo el modelo'],
  ['hashtag', 120, 'el hashtag de arte'],
];
const perfilObligatorio = Object.fromEntries(PERFIL_CAMPOS.map(([clave, max, que]) => [clave, texto(max).min(1, `falta ${que}`)]));
const perfilOpcional = Object.fromEntries(PERFIL_CAMPOS.map(([clave, max]) => [clave, textoOpcional(max)]));

/** Campos de la inscripción que no tienen columna en la ficha: van como filas de `profile` (etiqueta → clave). */
const PERFIL_ETIQUETAS = [
  ['Comida favorita', 'favoriteFood'],
  ['Comida que desagrada', 'dislikedFood'],
  ['Videojuego favorito', 'favoriteGame'],
  ['Serie favorita', 'favoriteSeries'],
  ['Música favorita', 'favoriteMusic'],
  ['Anime favorito', 'favoriteAnime'],
  ['Animal favorito', 'favoriteAnimal'],
  ['Signo', 'zodiac'],
];

export const inscripcionSchema = z.object({
  /** Nombre con el que aparecerá la ficha. */
  name: texto(160).min(1, 'falta el nombre artístico'),
  /** CONFIDENCIAL: solo para que el mantenedor pueda contestar. */
  email: correo,
  /** Opcional: se pide en la 2.ª página del formulario. */
  country: textoOpcional(60),
  languages: z.array(texto(8).min(2)).min(1, 'indica al menos un idioma').max(6),
  phrase: textoOpcional(600),
  /** Lore: la historia que va en la carta. Obligatorio (2.ª página). */
  cardText: texto(4000).min(1, 'falta el lore'),
  ...perfilObligatorio,
  zodiac: textoOpcional(40),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color hexadecimal #rrggbb')
    .optional()
    .or(z.literal('')),
  /** Dónde está el avatar (arte del personaje) y el logo: el mantenedor los descarga y los sube; el formulario no recibe archivos. */
  imageUrl: urlHttp,
  logoUrl: urlHttp,
  socials: z
    .array(z.object({ platform: texto(40).min(1), url: urlHttp }))
    .min(1, 'indica al menos una red o canal donde se te pueda ver')
    .max(10),
  ...aceptacion,
});

export const bajaSchema = z.object({
  /**
   * Opcional: la ficha sale del correo (la de la inscripción aprobada con esa dirección). Solo hace falta
   * para quien NO se inscribió con este correo (las fichas del scrape original no tienen uno guardado) o
   * para elegir una cuando el mismo correo tiene varias.
   */
  ficha: textoOpcional(300),
  /** CONFIDENCIAL. La titularidad la prueba el token que llega a este correo. */
  email: correo,
  motivo: textoOpcional(2000),
  ...aceptacion,
});

/** Lo que una modificación puede cambiar: si todo viene en blanco no hay nada que revisar. */
const CAMPOS_MODIFICABLES = ['phrase', 'cardText', 'themeColor', 'country', 'zodiac', 'imageUrl', 'logoUrl', ...PERFIL_CAMPOS.map(([clave]) => clave)];

/**
 * Pedir cambios en una ficha YA registrada. Se identifica con la ficha y el correo (que se confirma
 * con un enlace de un solo uso: no se pide otra prueba de titularidad) y todo lo demás es opcional: solo se tocan los campos que vengan con
 * valor. El nombre no se puede cambiar por aquí (mueve la URL y tiene sus propias reglas).
 */
export const modificacionSchema = z
  .object({
    /** Nombre o URL (`/v/<slug>`) de la ficha que se quiere modificar. */
    ficha: texto(300).min(1, 'indica qué ficha quieres modificar'),
    /** CONFIDENCIAL. */
    email: correo,
    phrase: textoOpcional(600),
    cardText: textoOpcional(4000),
    themeColor: z
      .string()
      .trim()
      .regex(/^#[0-9a-fA-F]{6}$/, 'color hexadecimal #rrggbb')
      .optional()
      .or(z.literal('')),
    country: textoOpcional(60),
    zodiac: textoOpcional(40),
    ...perfilOpcional,
    languages: z.array(texto(8).min(2)).max(6).optional().default([]),
    imageUrl: urlHttp.optional().or(z.literal('')),
    logoUrl: urlHttp.optional().or(z.literal('')),
    /** Se SUMAN o actualizan por plataforma; no reemplazan las que ya tiene la ficha. */
    socials: z.array(z.object({ platform: texto(40).min(1), url: urlHttp })).max(10).optional().default([]),
    /** Para el mantenedor: qué cambió y por qué. */
    nota: textoOpcional(2000),
    ...aceptacion,
  })
  .refine((d) => CAMPOS_MODIFICABLES.some((clave) => d[clave]) || d.languages.length > 0 || d.socials.length > 0, {
    message: 'indica al menos un cambio',
    path: ['(cambios)'],
  });

const ESQUEMAS = { inscripcion: inscripcionSchema, baja: bajaSchema, modificacion: modificacionSchema };

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
export async function crearSolicitud(ejecutor, entrada, { tipo, ip, ahora = new Date(), permiso = null, propositoPermiso = 'permiso' }) {
  if (!TIPOS.includes(tipo)) throw new SolicitudError(400, 'tipo_invalido', tipo);
  const esquema = ESQUEMAS[tipo];
  // Con `permiso` el correo YA está verificado (lo canjeó por un código): sale del permiso, no de lo que
  // diga el cuerpo, y la solicitud nace `pendiente` sin segundo correo. Se mira sin gastarlo: un error de
  // validación de abajo no debe quemar el permiso, que cuesta rellenar un formulario largo.
  let correoVerificado = null;
  if (permiso !== null) {
    correoVerificado = await correoDelToken(ejecutor, permiso, propositoPermiso, ahora.getTime());
    if (!correoVerificado) {
      throw new SolicitudError(410, 'permiso_invalido', 'La verificación de tu correo caducó o ya se usó. Vuelve al paso 1 y pide un código nuevo.');
    }
  }
  const parsed = esquema.safeParse(correoVerificado ? { ...(entrada ?? {}), email: correoVerificado.email } : (entrada ?? {}));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message }));
    throw Object.assign(new SolicitudError(400, 'payload_invalido', issues[0]?.message ?? 'datos no válidos'), { issues });
  }
  const { aceptaTerminos: _acepta, terminosVersion, website, email, ...datos } = parsed.data;
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

  const contacto = { email };
  const fecha = ahora.toISOString();
  if (correoVerificado) {
    // Se gasta AHORA, con todo lo demás ya validado, y de forma atómica: dos envíos a la vez con el mismo
    // permiso no crean dos solicitudes (el segundo ve 0 filas cambiadas).
    if (!(await consumirToken(e, permiso, propositoPermiso, ahora.getTime()))) {
      throw new SolicitudError(410, 'permiso_invalido', 'La verificación de tu correo caducó o ya se usó. Vuelve al paso 1 y pide un código nuevo.');
    }
    const directa = await e.execute(
      `INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado)
       VALUES (?, 'pendiente', ?, ?, ?, ?, ?, ?)`,
      [tipo, aJson(datos), aJson(contacto), red, terminosVersion, fecha, fecha],
    );
    const { rows: ultima } = await e.execute('SELECT MAX(id) AS id FROM solicitud WHERE red = ?', [red]);
    return { id: Number(directa.lastInsertRowid ?? ultima[0]?.id ?? 0) || null, descartada: false, email, tipo, verificada: true };
  }
  // Una solicitud sin confirmar del mismo correo y tipo se REEMPLAZA (la persona volvió a enviar porque
  // el correo no le llegó): no se acumulan. Y las que nadie confirmó en días se borran aquí mismo, sin
  // un trabajo aparte.
  const sinConfirmar = await e.execute(
    "SELECT id, contacto, creado FROM solicitud WHERE tipo = ? AND estado = 'sin_verificar'",
    [tipo],
  );
  const caducadas = new Date(ahora.getTime() - VIDA_SIN_VERIFICAR_MS).toISOString();
  for (const fila of sinConfirmar.rows) {
    if (deJson(fila.contacto)?.email === email || String(fila.creado) < caducadas) {
      await e.execute("DELETE FROM solicitud WHERE id = ? AND estado = 'sin_verificar'", [Number(fila.id)]);
    }
  }
  const insertada = await e.execute(
    `INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado)
     VALUES (?, 'sin_verificar', ?, ?, ?, ?, ?, ?)`,
    [tipo, aJson(datos), aJson(contacto), red, terminosVersion, fecha, fecha],
  );
  const { rows: ultimo } = await e.execute('SELECT MAX(id) AS id FROM solicitud WHERE red = ?', [red]);
  return { id: Number(insertada.lastInsertRowid ?? ultimo[0]?.id ?? 0) || null, descartada: false, email, tipo };
}

/**
 * Confirma el correo de una solicitud: de `sin_verificar` a `pendiente`. El `WHERE` hace de cerrojo
 * (un doble clic no la confirma dos veces). Devuelve la solicitud, o `null` si ya no existe o ya no
 * estaba sin verificar (p. ej. se reemplazó por un reenvío).
 */
export async function confirmarSolicitud(ejecutor, id) {
  const e = await conTablas(ejecutor);
  const cambio = await e.execute("UPDATE solicitud SET estado = 'pendiente' WHERE id = ? AND estado = 'sin_verificar'", [Number(id)]);
  return cambio.rowsAffected === 0 ? null : leerSolicitud(e, id);
}

/** Descarta una solicitud sin confirmar (por ejemplo, si el correo no se pudo enviar). */
export async function descartarSinVerificar(ejecutor, id) {
  const e = await conTablas(ejecutor);
  await e.execute("DELETE FROM solicitud WHERE id = ? AND estado = 'sin_verificar'", [Number(id)]);
}

/**
 * Las fichas que este correo inscribió: las inscripciones APROBADAS cuyo contacto guarda ese correo.
 * El slug pudo cambiar desde entonces: `resolverFicha` recibe el slug guardado y devuelve la ficha
 * vigente (alias incluidos). Las fichas del scrape original no tienen correo guardado: nunca aparecen.
 * A propósito NO incluye los correos fijados a mano por el mantenedor (`ficha_correo`): la baja automática
 * y el borrador solo se fían de quien inscribió la ficha, no de un dato que escribió otra persona.
 *
 * @param {(slug: string) => ({ id: number, slug: string, name: string } | null)} resolverFicha
 * @param {((id: number) => ({ id: number, slug: string, name: string } | null)) | null} [resolverPorId]
 *   si se pasa, suma las fichas cuyo correo fijó el mantenedor (`inscripcion: null`); solo «Mi ficha» lo pide
 * @returns {Promise<Array<{ inscripcion: number | null, ficha: { id: number, slug: string, name: string } }>>}
 *   una entrada por ficha (si el mismo correo la inscribió dos veces, la primera inscripción)
 */
export async function fichasDelTitular(ejecutor, { email, resolverFicha, resolverPorId = null }) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    "SELECT id, contacto, vtuber_slug FROM solicitud WHERE tipo = 'inscripcion' AND estado = 'aprobada' AND vtuber_slug IS NOT NULL ORDER BY id",
  );
  const vistas = new Set();
  const salida = [];
  for (const fila of rows) {
    if (String(deJson(fila.contacto)?.email ?? '').toLowerCase() !== String(email).toLowerCase()) continue;
    const ficha = resolverFicha(fila.vtuber_slug);
    if (!ficha || vistas.has(ficha.id)) continue;
    vistas.add(ficha.id);
    salida.push({ inscripcion: Number(fila.id), ficha });
  }
  if (resolverPorId) {
    // «Mi ficha»: quien tiene su correo fijado por el mantenedor (las fichas del scrape) también es titular.
    // Baja y borrador NO lo piden: no se fían de un dato que escribió otra persona.
    const { rows: manuales } = await e.execute('SELECT vtuber_id FROM ficha_correo WHERE lower(email) = ?', [String(email).toLowerCase()]);
    for (const m of manuales) {
      const id = Number(m.vtuber_id);
      if (vistas.has(id)) continue;
      const ficha = resolverPorId(id);
      if (!ficha) continue;
      vistas.add(id);
      salida.push({ inscripcion: null, ficha });
    }
  }
  return salida;
}

/**
 * El correo con que se inscribió una ficha (la inversa de `fichasDelTitular`), o `null`: las fichas del
 * scrape original no tienen correo guardado. Compara por id de ficha vigente, porque el slug pudo cambiar.
 */
export async function correoDeLaFicha(ejecutor, { fichaId, resolverFicha }) {
  const e = await conTablas(ejecutor);
  // Lo que el mantenedor fijó a mano manda sobre el de la inscripción (es la corrección).
  const manual = await e.execute('SELECT email FROM ficha_correo WHERE vtuber_id = ?', [Number(fichaId)]);
  if (manual.rows[0]?.email) return String(manual.rows[0].email);
  const { rows } = await e.execute(
    "SELECT contacto, vtuber_slug FROM solicitud WHERE tipo = 'inscripcion' AND estado = 'aprobada' AND vtuber_slug IS NOT NULL ORDER BY id",
  );
  for (const fila of rows) {
    const email = deJson(fila.contacto)?.email;
    if (!email) continue;
    if (resolverFicha(fila.vtuber_slug)?.id === fichaId) return String(email);
  }
  return null;
}

/**
 * Los correos de TODAS las fichas que tienen uno, en una sola pasada (el listado del mantenedor no puede
 * preguntar ficha por ficha): inscripciones aprobadas y, encima, lo fijado a mano.
 *
 * @returns {Promise<Map<number, string>>} id de ficha vigente → correo
 */
export async function correosDeFichas(ejecutor, { resolverFicha }) {
  const e = await conTablas(ejecutor);
  const mapa = new Map();
  const { rows } = await e.execute(
    "SELECT contacto, vtuber_slug FROM solicitud WHERE tipo = 'inscripcion' AND estado = 'aprobada' AND vtuber_slug IS NOT NULL ORDER BY id DESC",
  );
  for (const fila of rows) {
    const email = deJson(fila.contacto)?.email;
    const id = email ? resolverFicha(fila.vtuber_slug)?.id : null;
    if (id != null) mapa.set(id, String(email));
  }
  const { rows: manuales } = await e.execute('SELECT vtuber_id, email FROM ficha_correo');
  for (const fila of manuales) mapa.set(Number(fila.vtuber_id), String(fila.email));
  return mapa;
}

/**
 * ¿Este correo está asociado a alguna ficha? Sí si inscribió una (inscripción aprobada) o si el mantenedor
 * se lo fijó a mano. Lo exigen los formularios de modificación y de baja: sin una ficha detrás no hay nada
 * que modificar ni dar de baja, y la persona debe hablar con un administrador.
 */
export async function correoTieneFicha(ejecutor, email) {
  const e = await conTablas(ejecutor);
  const limpio = String(email ?? '').trim().toLowerCase();
  if (!limpio) return false;
  const manual = await e.execute('SELECT 1 AS ok FROM ficha_correo WHERE email = ? LIMIT 1', [limpio]);
  if (manual.rows.length) return true;
  const inscrita = await e.execute(
    "SELECT 1 AS ok FROM solicitud WHERE tipo = 'inscripcion' AND estado = 'aprobada' AND json_extract(contacto, '$.email') = ? LIMIT 1",
    [limpio],
  );
  return inscrita.rows.length > 0;
}

/**
 * Las fichas de personas GRADUADAS (dejaron de hacer streams): solo una marca, no toca el grado. Vive junto
 * a `ficha_correo` (mismo almacén, mismo respaldo) porque la base del catálogo es de solo lectura en producción.
 * @returns {Promise<Set<number>>} ids de ficha
 */
export async function idsGraduados(ejecutor) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute('SELECT vtuber_id FROM graduado');
  return new Set(rows.map((f) => Number(f.vtuber_id)));
}

/** Marca (`true`) o desmarca (`false`) una ficha como graduada. Idempotente. */
export async function fijarGraduado(ejecutor, fichaId, graduado = true, ahora = new Date()) {
  const e = await conTablas(ejecutor);
  if (!graduado) {
    await e.execute('DELETE FROM graduado WHERE vtuber_id = ?', [Number(fichaId)]);
    return false;
  }
  await e.execute('INSERT OR IGNORE INTO graduado (vtuber_id, desde) VALUES (?, ?)', [Number(fichaId), ahora.toISOString().slice(0, 10)]);
  return true;
}

/** Valida y normaliza un correo (minúsculas); lanza `SolicitudError` 400 si no lo es. */
export function normalizarCorreo(valor) {
  const parsed = correo.safeParse(valor);
  if (!parsed.success) throw new SolicitudError(400, 'correo_invalido', 'El correo no es válido.');
  return parsed.data;
}

/**
 * Fija (o con `null`/'' quita) el correo de una ficha. Vive aquí y no en la ficha ni en el diario:
 * es un dato confidencial que no debe viajar por la API pública ni por la base empaquetada.
 */
export async function fijarCorreoDeFicha(ejecutor, fichaId, email, ahora = new Date()) {
  const e = await conTablas(ejecutor);
  const limpio = String(email ?? '').trim();
  if (!limpio) {
    await e.execute('DELETE FROM ficha_correo WHERE vtuber_id = ?', [Number(fichaId)]);
    return null;
  }
  const valido = normalizarCorreo(limpio);
  await e.execute(
    `INSERT INTO ficha_correo (vtuber_id, email, actualizado) VALUES (?, ?, ?)
     ON CONFLICT(vtuber_id) DO UPDATE SET email = excluded.email, actualizado = excluded.actualizado`,
    [Number(fichaId), valido, ahora.toISOString()],
  );
  return valido;
}

/** Borra el contacto confidencial de una solicitud ya cerrada (la inscripción de quien se dio de baja). */
export async function borrarContacto(ejecutor, id) {
  const e = await conTablas(ejecutor);
  await e.execute('UPDATE solicitud SET contacto = NULL WHERE id = ?', [Number(id)]);
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
  const pendientes = { inscripcion: 0, baja: 0, modificacion: 0 };
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
  const permitido = actual.tipo === 'baja' ? ['procesada', 'rechazada'] : ['aprobada', 'rechazada'];
  if (!permitido.includes(estado)) {
    throw new SolicitudError(400, 'estado_invalido', `una ${actual.tipo} no puede quedar «${estado}»`);
  }
  const conservaContacto = actual.tipo !== 'baja' && estado === 'aprobada';
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
 * el correo está en `contacto` y no pueden colarse. Siempre `draft`.
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
  const { columnas, modeler, perfil } = camposDeFicha(d);
  Object.assign(ficha, columnas);
  if (modeler) ficha.artists = [modeler];
  if (perfil.length) ficha.profile = perfil;
  return ficha;
}

/**
 * Lo que los datos de un formulario aportan a la ficha, igual para la inscripción y la modificación:
 * las columnas propias, el modelador (va a `artists`) y las filas de `profile`. Solo lo que trae valor.
 */
export function camposDeFicha(d) {
  const columnas = {};
  for (const clave of ['phrase', 'cardText', 'themeColor', 'height', 'birthday', 'hashtag', 'favoriteColor']) {
    if (d[clave]) columnas[clave] = d[clave];
  }
  const perfil = PERFIL_ETIQUETAS.filter(([, clave]) => d[clave]).map(([label, clave]) => ({ label, value: d[clave] }));
  return { columnas, modeler: d.modeler || '', perfil };
}
