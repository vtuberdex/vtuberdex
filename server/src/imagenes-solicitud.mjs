/**
 * IMÁGENES DE LAS SOLICITUDES: el avatar (personaje) y el logo que la gente sube desde los formularios
 * públicos de inscripción y modificación, en lugar de pegar un enlace.
 *
 * Es JS puro sobre un EJECUTOR (`{ execute, exec }`), igual que `solicitudes.mjs`: la misma tabla en el
 * mismo ejecutor que `solicitud` (Turso en producción, `data/solicitudes.db` en local).
 *
 * POR QUÉ NO SE ACEPTA «CUALQUIER ARCHIVO»
 * ----------------------------------------
 * Un formulario público que recibe archivos es una puerta a subir basura, así que el servidor es MUY
 * estricto y no confía en el navegador:
 *   · Solo se acepta WebP, y el navegador lo produce (decodifica la imagen original y la reexporta
 *     en un lienzo, así que lo que llega ya no es el archivo de la persona, sino una imagen NUEVA y sin
 *     metadatos). En producción no hay `sharp` para recomprimir, de modo que el servidor VERIFICA el
 *     contenedor en lugar de reconstruirlo.
 *   · La verificación recorre los trozos del contenedor RIFF: el tamaño declarado tiene que ser el
 *     real (nada pegado al final: un archivo políglota), solo se admiten los trozos de una imagen
 *     estática (`VP8 `, `VP8L`, `VP8X`, `ALPH`, `ICCP`) y se rechazan animaciones, EXIF y XMP (la
 *     ubicación de una foto es un dato personal).
 *   · Dimensiones exactas para el personaje (720x1008, el lienzo de la carta) y topadas para el logo.
 *   · Peso máximo 900 KB: nginx corta en 1 MB, y una imagen de ese lienzo no necesita más.
 *   · Una imagen por tipo y por correo VERIFICADO (subir otra reemplaza la anterior), tope de subidas por
 *     correo y por red y día, y TODO caduca si no se aprueba (ver `LIMITES`: 24 h sin enviar, 30 días en una
 *     solicitud pendiente, 7 días en una resuelta).
 *
 * Nada de lo subido es público: se sirve solo a quien lo subió (para su vista previa) y al mantenedor. Al
 * APROBAR la solicitud se copia al almacén de imágenes de la ficha; al rechazarla se borra.
 *
 * El correo no se guarda aquí en claro: solo una huella (sal + sha256), que basta para comprobar que la
 * imagen es de quien envía el formulario sin añadir otra copia del dato personal.
 */
import crypto from "node:crypto";

import { preparadorDeTablas } from "./db/tablas.mjs";
import { SolicitudError, hashearRed } from "./solicitudes.mjs";

const DDL = `
  CREATE TABLE IF NOT EXISTS imagen_solicitud (
    id           TEXT PRIMARY KEY,
    huella       TEXT NOT NULL,
    tipo         TEXT NOT NULL,
    formulario   TEXT NOT NULL,
    bytes        BLOB NOT NULL,
    ancho        INTEGER NOT NULL,
    alto         INTEGER NOT NULL,
    size         INTEGER NOT NULL,
    solicitud_id INTEGER,
    creado       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_imagen_solicitud_huella ON imagen_solicitud (huella, tipo);
  CREATE INDEX IF NOT EXISTS idx_imagen_solicitud_solicitud ON imagen_solicitud (solicitud_id);
  CREATE TABLE IF NOT EXISTS imagen_envio (
    clave  TEXT NOT NULL,
    creado INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_imagen_envio ON imagen_envio (clave, creado);
`;

const conTablas = preparadorDeTablas(DDL);

/** Tipos que el formulario sabe subir y el tipo de asset al que corresponde cada uno. */
export const TIPOS_IMAGEN = ["character", "logo"];
export const FORMULARIOS = ["inscripcion", "modificacion"];

export const LIMITES = Object.freeze({
  /** nginx corta en 1 MB (no hay `client_max_body_size`): por debajo, para que el error sea el nuestro. */
  maxBytes: 900 * 1024,
  /** El lienzo de la carta: la misma medida que normaliza el mantenedor (`components/image-manager.tsx`). */
  character: { ancho: 720, alto: 1008 },
  logo: { maxLado: 900, minLado: 64 },
  /** Subidas por correo verificado y por red en 24 h (reemplazar también cuenta). */
  porCorreoDia: 12,
  porRedDia: 30,
  /** Lo que no llegó a enviarse en un formulario. */
  vidaHuerfanaMs: 24 * 60 * 60 * 1000,
  /**
   * Nada se queda para siempre si no se aprueba:
   *   · sin enviar en un formulario: 24 h (`vidaHuerfanaMs`);
   *   · en una solicitud que SIGUE pendiente: 30 días (`vidaPendienteMs`), contados desde que se subió;
   *   · en una solicitud ya resuelta (rechazada, o aprobada pero sin poder aplicarse): 7 días
   *     (`vidaResueltaMs`). Lo normal es que se borren al resolver; esto es la red de seguridad.
   */
  vidaPendienteMs: 30 * 24 * 60 * 60 * 1000,
  vidaResueltaMs: 7 * 24 * 60 * 60 * 1000,
});

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esIdDeImagen = (valor) =>
  typeof valor === "string" && UUID.test(valor);

/** Huella del correo (nunca el correo): suficiente para saber de quién es una imagen. */
export function huellaDeCorreo(
  correo,
  sal = process.env.VTUBERDEX_LIKES_SAL ?? "vtuberdex",
) {
  return crypto
    .createHash("sha256")
    .update(`${sal}:imagen:${String(correo).trim().toLowerCase()}`)
    .digest("hex")
    .slice(0, 32);
}

/* -------------------------------------------------------------- validación WebP */

/** Trozos permitidos en una imagen estática. Todo lo demás (EXIF, XMP, ANIM, ANMF…) se rechaza. */
const TROZOS_PERMITIDOS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP"]);
const TROZOS_DE_IMAGEN = new Set(["VP8 ", "VP8L"]);

const rechazo = (codigo, detalle) => {
  throw new SolicitudError(400, codigo, detalle);
};

/**
 * Medidas del lienzo de un WebP. Con `VP8X` (extendido, el que lleva alfa en el modo con pérdida) son las
 * del propio trozo; si no, las del trozo de imagen.
 */
function medidasDe(buf, primero) {
  if (primero === "VP8X")
    return {
      ancho: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
      alto: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
    };
  if (primero === "VP8L") {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { ancho: (bits & 0x3fff) + 1, alto: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (primero === "VP8 ") {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return {
      ancho: buf.readUInt16LE(26) & 0x3fff,
      alto: buf.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

/**
 * Comprueba que `bytes` es un WebP ESTÁTICO bien formado y devuelve sus medidas. Lanza `SolicitudError`.
 * @param {Buffer} bytes
 */
export function validarWebp(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
  if (buf.length < 30)
    rechazo("imagen_invalida", "El archivo está vacío o no es una imagen.");
  if (buf.length > LIMITES.maxBytes)
    rechazo(
      "imagen_demasiado_grande",
      `La imagen pesa más de ${Math.round(LIMITES.maxBytes / 1024)} KB.`,
    );
  if (
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WEBP"
  )
    rechazo(
      "imagen_invalida",
      "Solo se aceptan imágenes WebP (el formulario las convierte solo).",
    );
  // El tamaño declarado debe ser el real: bytes de más al final son una carga escondida.
  if (buf.readUInt32LE(4) + 8 !== buf.length)
    rechazo("imagen_invalida", "El archivo está dañado o trae datos añadidos.");

  let desplazamiento = 12;
  let primero = null;
  let imagenes = 0;
  while (desplazamiento < buf.length) {
    if (desplazamiento + 8 > buf.length)
      rechazo("imagen_invalida", "El archivo está dañado.");
    const tipo = buf.toString("ascii", desplazamiento, desplazamiento + 4);
    const largo = buf.readUInt32LE(desplazamiento + 4);
    if (!TROZOS_PERMITIDOS.has(tipo))
      rechazo(
        "imagen_invalida",
        "La imagen trae metadatos o animación que no se aceptan.",
      );
    const siguiente = desplazamiento + 8 + largo + (largo % 2);
    if (siguiente > buf.length)
      rechazo("imagen_invalida", "El archivo está dañado.");
    if (primero === null) primero = tipo;
    if (TROZOS_DE_IMAGEN.has(tipo)) imagenes += 1;
    if (tipo === "VP8X") {
      // Bit 1 (0x02) = animación; 0x08 = EXIF; 0x04 = XMP.
      if (buf[20] & (0x02 | 0x08 | 0x04))
        rechazo(
          "imagen_invalida",
          "La imagen trae metadatos o animación que no se aceptan.",
        );
    }
    desplazamiento = siguiente;
  }
  if (imagenes !== 1)
    rechazo("imagen_invalida", "El archivo no contiene una sola imagen.");
  const medidas = medidasDe(buf, primero);
  if (!medidas || !(medidas.ancho > 0) || !(medidas.alto > 0))
    rechazo("imagen_invalida", "No se pudieron leer las medidas de la imagen.");
  return medidas;
}

/** Que las medidas sean las que pide el tipo. Lanza `SolicitudError`. */
export function validarMedidas(tipo, { ancho, alto }) {
  if (tipo === "character") {
    const { ancho: a, alto: h } = LIMITES.character;
    if (ancho !== a || alto !== h)
      rechazo(
        "imagen_medidas",
        `El personaje debe medir ${a}x${h}. El formulario la ajusta solo; vuelve a elegir el archivo.`,
      );
    return;
  }
  const { maxLado, minLado } = LIMITES.logo;
  if (Math.max(ancho, alto) > maxLado || Math.min(ancho, alto) < minLado)
    rechazo(
      "imagen_medidas",
      `El logo debe tener entre ${minLado} y ${maxLado} px por lado.`,
    );
}

/* -------------------------------------------------------------------- operaciones */

const aBuffer = (valor) =>
  Buffer.isBuffer(valor) ? valor : Buffer.from(valor ?? []);

/**
 * Cuenta una subida contra su clave y dice si ya no cabe. Las claves viejas se purgan aquí mismo
 * (sin un trabajo aparte).
 */
async function gastarCupo(e, clave, maximo, ahora) {
  const { rows } = await e.execute(
    "SELECT COUNT(*) AS n FROM imagen_envio WHERE clave = ? AND creado >= ?",
    [clave, ahora - UN_DIA_MS],
  );
  if (Number(rows[0]?.n ?? 0) >= maximo) return false;
  await e.execute("INSERT INTO imagen_envio (clave, creado) VALUES (?, ?)", [
    clave,
    ahora,
  ]);
  return true;
}

/**
 * Guarda una imagen subida por alguien con el correo VERIFICADO. Reemplaza la anterior (sin enviar) del
 * mismo tipo y correo. Devuelve `{ id, tipo, ancho, alto, size }`.
 *
 * @param {{ correo: string, tipo: string, formulario: string, bytes: Buffer, ip?: string, ahora?: Date }} datos
 */
export async function guardarImagen(
  ejecutor,
  { correo, tipo, formulario, bytes, ip, ahora = new Date() },
) {
  if (!TIPOS_IMAGEN.includes(tipo))
    throw new SolicitudError(400, "tipo_invalido", "tipo: character | logo");
  if (!FORMULARIOS.includes(formulario))
    throw new SolicitudError(400, "formulario_invalido", formulario);
  const buf = aBuffer(bytes);
  const medidas = validarWebp(buf);
  validarMedidas(tipo, medidas);

  const e = await conTablas(ejecutor);
  const t = ahora.getTime();
  const huella = huellaDeCorreo(correo);
  await purgarCaducadas(e, ahora);
  const topes = [
    [`c:${huella}`, LIMITES.porCorreoDia],
    [`r:${hashearRed(ip)}`, LIMITES.porRedDia],
  ];
  for (const [clave, maximo] of topes) {
    if (!(await gastarCupo(e, clave, maximo, t)))
      throw new SolicitudError(
        429,
        "demasiadas_imagenes",
        "Subiste muchas imágenes hoy. Inténtalo de nuevo mañana.",
      );
  }
  // Una por tipo y correo mientras no se envíe el formulario.
  await e.execute(
    "DELETE FROM imagen_solicitud WHERE huella = ? AND tipo = ? AND solicitud_id IS NULL",
    [huella, tipo],
  );
  const id = crypto.randomUUID();
  await e.execute(
    `INSERT INTO imagen_solicitud (id, huella, tipo, formulario, bytes, ancho, alto, size, solicitud_id, creado)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
    [
      id,
      huella,
      tipo,
      formulario,
      buf,
      medidas.ancho,
      medidas.alto,
      buf.length,
      ahora.toISOString(),
    ],
  );
  return {
    id,
    tipo,
    ancho: medidas.ancho,
    alto: medidas.alto,
    size: buf.length,
  };
}

/** La imagen con sus bytes, o `null`. */
export async function leerImagen(ejecutor, id) {
  if (!esIdDeImagen(id)) return null;
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    `SELECT id, huella, tipo, formulario, bytes, ancho, alto, size, solicitud_id
       FROM imagen_solicitud WHERE id = ?`,
    [id.toLowerCase()],
  );
  const f = rows[0];
  if (!f) return null;
  return {
    id: f.id,
    huella: f.huella,
    tipo: f.tipo,
    formulario: f.formulario,
    bytes: aBuffer(f.bytes),
    ancho: Number(f.ancho),
    alto: Number(f.alto),
    size: Number(f.size),
    solicitudId: f.solicitud_id == null ? null : Number(f.solicitud_id),
  };
}

/**
 * Comprueba que las imágenes que trae un formulario existen, son de ESTE correo, del tipo que tocan y
 * aún no están en otra solicitud. Si falta una obligatoria, lanza. Devuelve los ids a adjuntar.
 *
 * @param {{ correo: string, imageId?: string, logoId?: string, obligatorias: boolean }} datos
 */
export async function validarImagenesDeFormulario(
  ejecutor,
  { correo, imageId = "", logoId = "", obligatorias },
) {
  const e = await conTablas(ejecutor);
  const huella = huellaDeCorreo(correo);
  const ids = [];
  for (const [campo, tipo, id] of [
    ["imageId", "character", imageId],
    ["logoId", "logo", logoId],
  ]) {
    if (!id) {
      if (obligatorias)
        throw Object.assign(
          new SolicitudError(
            400,
            "payload_invalido",
            `falta subir la imagen (${campo})`,
          ),
          { issues: [{ path: campo, message: "falta subir la imagen" }] },
        );
      continue;
    }
    const { rows } = await e.execute(
      "SELECT huella, tipo, solicitud_id FROM imagen_solicitud WHERE id = ?",
      [String(id).toLowerCase()],
    );
    const f = rows[0];
    if (!f || f.huella !== huella || f.tipo !== tipo || f.solicitud_id != null)
      throw Object.assign(
        new SolicitudError(
          400,
          "payload_invalido",
          "La imagen ya no está disponible: vuelve a subirla.",
        ),
        { issues: [{ path: campo, message: "vuelve a subir la imagen" }] },
      );
    ids.push(String(id).toLowerCase());
  }
  return ids;
}

/** Ata las imágenes a la solicitud recién creada (ya no se reemplazan ni caducan). */
export async function adjuntarImagenes(ejecutor, solicitudId, ids) {
  if (!ids.length || !solicitudId) return;
  const e = await conTablas(ejecutor);
  for (const id of ids)
    await e.execute(
      "UPDATE imagen_solicitud SET solicitud_id = ? WHERE id = ? AND solicitud_id IS NULL",
      [Number(solicitudId), id],
    );
}

/** Las imágenes de una solicitud, SIN bytes (para listarlas). */
export async function imagenesDeSolicitud(ejecutor, solicitudId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    `SELECT id, tipo, ancho, alto, size FROM imagen_solicitud WHERE solicitud_id = ? ORDER BY tipo`,
    [Number(solicitudId)],
  );
  return rows.map((f) => ({
    id: f.id,
    tipo: f.tipo,
    ancho: Number(f.ancho),
    alto: Number(f.alto),
    size: Number(f.size),
  }));
}

/** Las imágenes de una solicitud CON bytes (para aplicarlas al aprobar). */
export async function imagenesParaAplicar(ejecutor, solicitudId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    "SELECT id FROM imagen_solicitud WHERE solicitud_id = ? ORDER BY tipo",
    [Number(solicitudId)],
  );
  const salida = [];
  for (const { id } of rows) {
    const img = await leerImagen(e, id);
    if (img) salida.push(img);
  }
  return salida;
}

/**
 * Copia las imágenes de una solicitud APROBADA al almacén de la ficha y borra las que se copiaron.
 *
 * `aplicar({ tipo, bytes, ancho, alto })` lo pone quien llama, porque el almacén cambia de un backend a
 * otro (Turso en producción, disco con `sharp` en el Express local). Si una falla NO se interrumpe
 * la aprobación: la imagen se conserva (caduca sola, `LIMITES.vidaResueltaMs`) y se devuelve en
 * `fallidas` para que el mantenedor la suba a mano desde «Imágenes».
 *
 * @returns {Promise<{ aplicadas: string[], fallidas: Array<{ tipo: string, error: string }> }>}
 */
export async function aplicarImagenesDeSolicitud(
  ejecutor,
  solicitudId,
  aplicar,
) {
  const e = await conTablas(ejecutor);
  const resultado = { aplicadas: [], fallidas: [] };
  for (const img of await imagenesParaAplicar(e, solicitudId)) {
    try {
      await aplicar({
        tipo: img.tipo,
        bytes: img.bytes,
        ancho: img.ancho,
        alto: img.alto,
      });
      await e.execute("DELETE FROM imagen_solicitud WHERE id = ?", [img.id]);
      resultado.aplicadas.push(img.tipo);
    } catch (error) {
      resultado.fallidas.push({
        tipo: img.tipo,
        error: error?.message ?? String(error),
      });
    }
  }
  return resultado;
}

/** Borra las imágenes de una solicitud (se rechazó, o ya se copiaron a la ficha). */
export async function borrarImagenesDeSolicitud(ejecutor, solicitudId) {
  const e = await conTablas(ejecutor);
  await e.execute("DELETE FROM imagen_solicitud WHERE solicitud_id = ?", [
    Number(solicitudId),
  ]);
}

/**
 * Borra lo caducado (ver `LIMITES`): lo que nunca se envió, lo que lleva demasiado tiempo en una solicitud
 * sin aprobar y lo que quedó de una ya resuelta. Los contadores de cupo de más de un día también.
 *
 * No hay un trabajo programado: se llama al subir una imagen y al listar la cola del mantenedor, que son
 * los momentos en que esto importa.
 */
export async function purgarCaducadas(ejecutor, ahora = new Date()) {
  const e = await conTablas(ejecutor);
  const antes = (ms) => new Date(ahora.getTime() - ms).toISOString();
  await e.execute(
    "DELETE FROM imagen_solicitud WHERE solicitud_id IS NULL AND creado < ?",
    [antes(LIMITES.vidaHuerfanaMs)],
  );
  await e.execute("DELETE FROM imagen_envio WHERE creado < ?", [
    ahora.getTime() - UN_DIA_MS,
  ]);
  // `solicitud` puede no existir todavía en un ejecutor que solo subió imágenes: no es un error.
  try {
    await e.execute(
      `DELETE FROM imagen_solicitud WHERE solicitud_id IN (
         SELECT id FROM solicitud WHERE estado != 'pendiente' AND resuelto < ?)`,
      [antes(LIMITES.vidaResueltaMs)],
    );
    // Huérfanas de una solicitud que ya no existe (una `sin_verificar` reemplazada o caducada).
    await e.execute(
      `DELETE FROM imagen_solicitud WHERE solicitud_id IS NOT NULL
         AND solicitud_id NOT IN (SELECT id FROM solicitud)`,
    );
    await e.execute(
      `DELETE FROM imagen_solicitud WHERE creado < ? AND solicitud_id IN (
         SELECT id FROM solicitud WHERE estado = 'pendiente')`,
      [antes(LIMITES.vidaPendienteMs)],
    );
  } catch {
    /* sin tabla `solicitud` aún */
  }
}
