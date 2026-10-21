/**
 * MINECRAFT: vincular una cuenta del juego a una ficha y sumar a esa ficha la XP que se gana jugando.
 *
 * QUIÉN PUEDE SUMAR XP A UNA FICHA
 * --------------------------------
 * Solo su titular. «Mi ficha» (enlace mágico al correo de la inscripción) genera un CÓDIGO corto
 * (`crearCodigoDeVinculo`, 10 min, un uso, solo se guarda el sha256) y la persona lo escribe en el juego
 * (`/vtd vincular <código>`). El plugin lo canjea con su token de servidor (`vincular`), que ata el UUID
 * de Minecraft a la ficha. Cualquier otro jugador puede ELEGIR una ficha para jugar con sus stats, pero
 * eso vive en el plugin y no toca este archivo: sin vínculo no hay XP.
 *
 * DOS CAMINOS AL MISMO CÓDIGO
 * --------------------------
 * · Desde «Mi ficha» (la titular ya entró con su enlace mágico).
 * · Desde el JUEGO: `/vtd email <correo>` hace que la web mande al correo un código por cada ficha de ese correo
 *   (`envioDeCodigoPermitido` pone el tope). Ese código va ATADO al UUID que lo pidió: solo esa cuenta puede
 *   canjearlo. Por eso el código se ESCRIBE en el juego y no se canjea con un clic en el correo: si alguien pide un
 *   código con el correo de otra persona, el código le llega a ella, no a quien lo pidió, y un clic en el correo
 *   vincularía la cuenta del intruso a la ficha de la víctima.
 *
 * CUENTAS SIN VERIFICAR (servidor en modo offline): EL VÍNCULO NECESITA SESIÓN
 * --------------------------------------------------------------------------
 * El servidor admite Java no premium (`online-mode=false`): ahí el UUID se calcula del NOMBRE (UUID versión 3), así que
 * cualquiera que escriba «madKoding» tendría el mismo UUID que la dueña. Para esas cuentas (`requiereSesion`) el vínculo
 * guardado NO basta: además hace falta una SESIÓN vigente para la red desde la que entra (`sesion_minecraft`), que nace al
 * canjear un código del correo y dura `SESION_DIAS`. Volver desde la misma red dentro del plazo entra directo; otra red o
 * plazo vencido pide `/vtd email` + `/vtd codigo` otra vez, y la red nueva REEMPLAZA a la anterior (una sola por cuenta): el correo es la identidad, no el nombre. Bedrock (Floodgate,
 * cuenta Xbox verificada) y las cuentas premium verificadas (UUID versión 4) no lo necesitan. De la red solo llega un HASH
 * (`hashearRed` en `lib/`): este archivo nunca ve una IP.
 *
 * Un código corto se puede adivinar más que un token de 32 bytes, por eso: 8 caracteres de un alfabeto de
 * 30 (≈ 6,6·10¹¹), vida de 10 min, un uso y solo lo canjea el servidor de Minecraft (no hay ruta pública
 * que lo acepte). Pedir uno nuevo invalida el anterior de esa ficha.
 *
 * LA XP ES UN LIBRO DE LOTES, NO UN CONTADOR
 * ------------------------------------------
 * El plugin junta lo ganado unos segundos y lo manda en LOTES con un `idLote` propio (UUID). La clave
 * primaria es ese id, así que un reintento tras un corte de red no suma dos veces (`ON CONFLICT DO
 * NOTHING`). La ficha suma `SUM(cantidad)` (`xpDeJuego`) y `experienciaConLikes` la añade a la barra:
 * nada que pueda desincronizarse del libro.
 *
 * TOPE DIARIO EN UNA SOLA SENTENCIA
 * ---------------------------------
 * `XP_JUEGO_MAX_DIA` por ficha y día. El INSERT lee lo sumado hoy y recorta el lote a lo que cabe en la
 * MISMA sentencia: dos lotes simultáneos no pueden pasarse del tope (misma idea que `subirHabilidad`).
 * Las ENTREGAS (motivo `entrega`) tienen su tope aparte (`XP_ENTREGA_MAX_DIA`): un lote es de entrega o no lo es
 * (nunca mezcla), y cada tope suma solo los lotes de su clase.
 * El «día» lo decide quien llama (Chile, `diaDeChile` en `lib/likes.mjs`): este archivo es JS puro.
 *
 * JS puro sobre un EJECUTOR `{ execute, exec }` (Turso/`file:` en producción, SQLite en los tests).
 */
import crypto from "node:crypto";

import {
  DIRECTO_TRAMO_MIN,
  XP_DIRECTO_MAX_DIA,
  XP_DIRECTO_POR_TRAMO,
  XP_ENTREGA_MAX_DIA,
  XP_JUEGO_MAX_DIA,
} from "./experiencia.mjs";
import { preparadorDeTablas } from "./db/tablas.mjs";

/** Vida del código de vínculo. */
export const CODIGO_TTL_MS = 10 * 60 * 1000;
/** XP máxima de un lote. El plugin manda cada ~30 s: más que esto en un lote es un plugin roto o trucado. */
export const XP_POR_LOTE_MAX = 100;
/** De dónde sale la XP: lista cerrada (se guarda el desglose para poder ajustar después lo que vale cada cosa). */
export const MOTIVOS_XP = Object.freeze([
  "mob",
  "jefe",
  "logro",
  "tiempo",
  "evento",
  "entrega",
]);
/** La XP de entregas viaja en lotes propios: tiene su tope diario y mezclarla haría ambiguo a cuál cuenta. */
export const MOTIVO_ENTREGA = "entrega";
/** Sin 0/O, 1/I/L ni U: se dicta y se escribe a mano en el chat del juego. */
const ALFABETO = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LARGO_CODIGO = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// Nombre de Java (3-16, letras, números y _) o de Bedrock vía Floodgate: el mismo con un «.» delante (los espacios del
// gamertag Floodgate los cambia por _). Solo se guarda para mostrarlo en «Mi ficha»; si no cuadra, el vínculo vale igual.
const JUGADOR = /^\.?[A-Za-z0-9_]{1,16}$/;

const DDL = `
  CREATE TABLE IF NOT EXISTS vinculo_minecraft (
    uuid       TEXT PRIMARY KEY,
    vtuber_id  INTEGER NOT NULL UNIQUE,
    jugador    TEXT,
    creado     TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS codigo_minecraft (
    hash       TEXT PRIMARY KEY,
    vtuber_id  INTEGER NOT NULL,
    expira     INTEGER NOT NULL,
    usado      INTEGER NOT NULL DEFAULT 0,
    uuid       TEXT
  );
  CREATE TABLE IF NOT EXISTS envio_minecraft (
    clave      TEXT NOT NULL,
    creado     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_envio_minecraft ON envio_minecraft (clave, creado);
  CREATE INDEX IF NOT EXISTS idx_codigo_minecraft_vtuber ON codigo_minecraft (vtuber_id);
  CREATE TABLE IF NOT EXISTS xp_juego (
    id_lote    TEXT PRIMARY KEY,
    vtuber_id  INTEGER NOT NULL,
    uuid       TEXT NOT NULL,
    cantidad   INTEGER NOT NULL,
    detalle    TEXT NOT NULL,
    dia        TEXT NOT NULL,
    creado     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_xp_juego_dia ON xp_juego (vtuber_id, dia);
  CREATE TABLE IF NOT EXISTS xp_directo (
    id_tramo   TEXT PRIMARY KEY,
    vtuber_id  INTEGER NOT NULL,
    plataforma TEXT NOT NULL,
    cantidad   INTEGER NOT NULL,
    dia        TEXT NOT NULL,
    creado     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_xp_directo_dia ON xp_directo (vtuber_id, dia);
  CREATE TABLE IF NOT EXISTS xp_mision (
    id_mision  TEXT PRIMARY KEY,
    vtuber_id  INTEGER NOT NULL,
    cantidad   INTEGER NOT NULL,
    dia        TEXT NOT NULL,
    creado     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_xp_mision_ficha ON xp_mision (vtuber_id);
  CREATE TABLE IF NOT EXISTS sesion_minecraft (
    uuid       TEXT NOT NULL,
    red        TEXT NOT NULL,
    expira     INTEGER NOT NULL,
    PRIMARY KEY (uuid, red)
  );
`;

export class MinecraftError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.name = "MinecraftError";
    this.status = status;
    this.code = code;
    this.detail = detail ?? code;
  }
}

const conTablas = preparadorDeTablas(DDL);
/** Las tablas de XP las comparten las misiones (`misiones.mjs`): crean aquí `xp_mision` antes de escribir. */
export const prepararTablasMinecraft = conTablas;

const hash = (codigo) =>
  crypto.createHash("sha256").update(codigo).digest("hex");
/** Lo que escribe la persona: sin espacios ni guiones y en mayúsculas («abcd-2345» vale). */
export const normalizarCodigo = (texto) =>
  String(texto ?? "")
    .replace(/[\s-]/g, "")
    .toUpperCase();
export const uuidValido = (valor) =>
  typeof valor === "string" && UUID.test(valor.toLowerCase());

/** Días que vale una sesión de una cuenta sin verificar en la misma red. */
export const SESION_DIAS = 7;
const SESION_MS = SESION_DIAS * 24 * 60 * 60 * 1000;

/**
 * ¿Esta cuenta necesita sesión? Solo las de UUID versión 3 (el que da el modo offline a partir del nombre). Floodgate
 * (`00000000-0000-0000-0009-…`, versión 0) y las premium (versión 4) traen la identidad verificada.
 */
export const requiereSesion = (uuid) =>
  uuidValido(uuid) && uuid.toLowerCase()[14] === "3";
const redValida = (red) =>
  typeof red === "string" && /^[0-9a-f]{16,64}$/.test(red);

/**
 * UNA red por cuenta: abrir la sesión en una red nueva cierra las demás de esa cuenta. Una ficha tiene una cuenta y una
 * cuenta una sesión, así que la ficha solo se puede usar desde UNA conexión (la última que confirmó el correo); la otra
 * mitad de la regla, que no haya dos conexiones a la vez, la aplica el plugin al entrar.
 */
async function abrirSesion(e, { uuid, red, ahora }) {
  await e.execute(
    "DELETE FROM sesion_minecraft WHERE expira <= ? OR (uuid = ? AND red <> ?)",
    [ahora, uuid.toLowerCase(), red],
  );
  await e.execute(
    "INSERT INTO sesion_minecraft (uuid, red, expira) VALUES (?, ?, ?) ON CONFLICT (uuid, red) DO UPDATE SET expira = excluded.expira",
    [uuid.toLowerCase(), red, ahora + SESION_MS],
  );
}

/** ¿Tiene sesión vigente? Con `red`, para esa red; sin ella, desde cualquiera (la XP solo pide que haya una). */
export async function sesionVigente(
  ejecutor,
  { uuid, red = null, ahora = Date.now() },
) {
  if (!requiereSesion(uuid)) return true;
  const e = await conTablas(ejecutor);
  const { rows } = red
    ? await e.execute(
        "SELECT 1 FROM sesion_minecraft WHERE uuid = ? AND red = ? AND expira > ?",
        [uuid.toLowerCase(), red, ahora],
      )
    : await e.execute(
        "SELECT 1 FROM sesion_minecraft WHERE uuid = ? AND expira > ?",
        [uuid.toLowerCase(), ahora],
      );
  return rows.length > 0;
}

/* --------------------------------------------------------------------- vínculo */

/**
 * Un código nuevo para vincular la ficha. Invalida los anteriores sin usar de esa ficha. Con `uuid` (pedido desde el
 * juego) solo esa cuenta de Minecraft puede canjearlo.
 */
export async function crearCodigoDeVinculo(
  ejecutor,
  { vtuberId, uuid = null, ahora = Date.now() },
) {
  const e = await conTablas(ejecutor);
  // Rechazo sin sesgo de módulo: 256 no es múltiplo de 30.
  const limite = 256 - (256 % ALFABETO.length);
  let codigo = "";
  while (codigo.length < LARGO_CODIGO) {
    for (const byte of crypto.randomBytes(16)) {
      if (byte < limite && codigo.length < LARGO_CODIGO)
        codigo += ALFABETO[byte % ALFABETO.length];
    }
  }
  await e.execute(
    "DELETE FROM codigo_minecraft WHERE vtuber_id = ? OR expira <= ?",
    [Number(vtuberId), ahora],
  );
  await e.execute(
    "INSERT INTO codigo_minecraft (hash, vtuber_id, expira, uuid) VALUES (?, ?, ?, ?)",
    [
      hash(codigo),
      Number(vtuberId),
      ahora + CODIGO_TTL_MS,
      typeof uuid === "string" && uuidValido(uuid) ? uuid.toLowerCase() : null,
    ],
  );
  return { codigo, expira: new Date(ahora + CODIGO_TTL_MS).toISOString() };
}

/**
 * Canjea un código y ata el UUID de Minecraft a su ficha. Una ficha tiene UNA cuenta y una cuenta UNA ficha:
 * vincular de nuevo reemplaza a la anterior (por los dos lados).
 */
export async function vincular(
  ejecutor,
  { codigo, uuid, jugador = null, red = null, ahora = Date.now() },
) {
  if (!uuidValido(uuid))
    throw new MinecraftError(
      400,
      "uuid_invalido",
      "UUID de Minecraft no válido.",
    );
  const limpio = normalizarCodigo(codigo);
  if (limpio.length !== LARGO_CODIGO)
    throw new MinecraftError(
      400,
      "codigo_invalido",
      "El código tiene 8 caracteres.",
    );
  // Sin red no se le podría abrir la sesión: quedaría vinculada pero sin poder jugar. Mejor decirlo antes de gastar el código.
  if (requiereSesion(uuid) && !redValida(red))
    throw new MinecraftError(
      400,
      "falta_red",
      "No se pudo identificar tu conexión. Vuelve a entrar.",
    );
  const e = await conTablas(ejecutor);
  const h = hash(limpio);
  const { rows } = await e.execute(
    "SELECT vtuber_id, uuid FROM codigo_minecraft WHERE hash = ? AND usado = 0 AND expira > ?",
    [h, ahora],
  );
  // Un código pedido desde el juego por OTRA cuenta responde igual que uno inexistente: no se confirma que existe.
  if (
    rows.length &&
    rows[0].uuid &&
    String(rows[0].uuid) !== uuid.toLowerCase()
  )
    rows.length = 0;
  if (!rows.length)
    throw new MinecraftError(
      410,
      "codigo_caducado",
      "Ese código no existe, ya se usó o caducó. Pide otro en «Mi ficha».",
    );
  // El cerrojo es el UPDATE: dos canjes a la vez, uno ve 0 filas.
  const gastado = await e.execute(
    "UPDATE codigo_minecraft SET usado = 1 WHERE hash = ? AND usado = 0 AND expira > ?",
    [h, ahora],
  );
  if (gastado.rowsAffected === 0)
    throw new MinecraftError(410, "codigo_caducado", "Ese código ya se usó.");
  const vtuberId = Number(rows[0].vtuber_id);
  const id = uuid.toLowerCase();
  await e.execute(
    "DELETE FROM vinculo_minecraft WHERE uuid = ? OR vtuber_id = ?",
    [id, vtuberId],
  );
  await e.execute(
    "INSERT INTO vinculo_minecraft (uuid, vtuber_id, jugador, creado) VALUES (?, ?, ?, ?)",
    [
      id,
      vtuberId,
      typeof jugador === "string" && JUGADOR.test(jugador) ? jugador : null,
      new Date(ahora).toISOString(),
    ],
  );
  if (requiereSesion(id)) await abrirSesion(e, { uuid: id, red, ahora });
  return { vtuberId };
}

/** La ficha vinculada a un UUID, o `null`. */
export async function vinculoDeJugador(ejecutor, uuid) {
  if (!uuidValido(uuid)) return null;
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    "SELECT vtuber_id, jugador, creado FROM vinculo_minecraft WHERE uuid = ?",
    [uuid.toLowerCase()],
  );
  return rows.length
    ? {
        vtuberId: Number(rows[0].vtuber_id),
        jugador: rows[0].jugador ?? null,
        desde: String(rows[0].creado),
      }
    : null;
}

/** La cuenta vinculada a una ficha, o `null` («Mi ficha» la muestra). */
export async function vinculoDeFicha(ejecutor, vtuberId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    "SELECT uuid, jugador, creado FROM vinculo_minecraft WHERE vtuber_id = ?",
    [Number(vtuberId)],
  );
  return rows.length
    ? {
        uuid: String(rows[0].uuid),
        jugador: rows[0].jugador ?? null,
        desde: String(rows[0].creado),
      }
    : null;
}

/**
 * Suelta el vínculo de una ficha (desde «Mi ficha») o de un jugador (desde el juego), y sus sesiones. La XP ya ganada
 * se queda.
 */
export async function desvincular(ejecutor, { vtuberId = null, uuid = null }) {
  const e = await conTablas(ejecutor);
  let cuenta =
    typeof uuid === "string" && uuidValido(uuid) ? uuid.toLowerCase() : null;
  if (vtuberId !== null) {
    const { rows } = await e.execute(
      "SELECT uuid FROM vinculo_minecraft WHERE vtuber_id = ?",
      [Number(vtuberId)],
    );
    cuenta = rows.length ? String(rows[0].uuid) : null;
  }
  if (!cuenta) return false;
  await e.execute("DELETE FROM sesion_minecraft WHERE uuid = ?", [cuenta]);
  return (
    (await e.execute("DELETE FROM vinculo_minecraft WHERE uuid = ?", [cuenta]))
      .rowsAffected > 0
  );
}

/**
 * Topes de `/vtd email`: por correo (un buzón ajeno no se inunda), por cuenta (no se prueba correo tras correo) y por RED:
 * sin cuentas de pago, cambiar de nombre es gratis y el tope por cuenta se esquiva; la red no. Es generoso (una casa o un
 * cibercafé comparten red) pero corta a quien prueba cientos de nombres.
 */
export const ENVIOS = Object.freeze({
  esperaMs: 60 * 1000,
  porCorreoDia: 5,
  porCuentaDia: 10,
  porRedDia: 20,
});
const UN_DIA_MS = 24 * 60 * 60 * 1000;

/**
 * ¿Se puede mandar otro correo con códigos? Cuenta y APUNTA en la misma llamada, pase lo que pase después (tenga o no
 * fichas ese correo): así el tope no delata si un correo está inscrito. Del correo solo se guarda un hash.
 * @returns {Promise<{ ok: true } | { ok: false, motivo: 'espera' | 'tope_correo' | 'tope_cuenta' | 'tope_red' }>}
 */
export async function envioDeCodigoPermitido(
  ejecutor,
  { email, uuid, red = null, ahora = Date.now() },
) {
  const e = await conTablas(ejecutor);
  const correo = `correo:${hash(String(email).trim().toLowerCase())}`;
  const cuenta = `cuenta:${String(uuid).toLowerCase()}`;
  const deRed = redValida(red) ? `red:${red}` : null;
  await e.execute("DELETE FROM envio_minecraft WHERE creado <= ?", [
    ahora - UN_DIA_MS,
  ]);
  const contar = async (clave, desde) =>
    Number(
      (
        await e.execute(
          "SELECT COUNT(*) AS n FROM envio_minecraft WHERE clave = ? AND creado > ?",
          [clave, desde],
        )
      ).rows[0]?.n ?? 0,
    );
  if ((await contar(correo, ahora - ENVIOS.esperaMs)) > 0)
    return { ok: false, motivo: "espera" };
  if ((await contar(correo, ahora - UN_DIA_MS)) >= ENVIOS.porCorreoDia)
    return { ok: false, motivo: "tope_correo" };
  if ((await contar(cuenta, ahora - UN_DIA_MS)) >= ENVIOS.porCuentaDia)
    return { ok: false, motivo: "tope_cuenta" };
  if (deRed && (await contar(deRed, ahora - UN_DIA_MS)) >= ENVIOS.porRedDia)
    return { ok: false, motivo: "tope_red" };
  await e.execute(
    "INSERT INTO envio_minecraft (clave, creado) VALUES (?, ?), (?, ?)",
    [correo, ahora, cuenta, ahora],
  );
  if (deRed)
    await e.execute(
      "INSERT INTO envio_minecraft (clave, creado) VALUES (?, ?)",
      [deRed, ahora],
    );
  return { ok: true };
}

/* ------------------------------------------------------------------------- XP */

/** `{ mob: 12, tiempo: 5 }` validado: solo motivos conocidos, enteros positivos. Lanza si no cuadra. */
function desgloseValido(detalle) {
  if (!detalle || typeof detalle !== "object" || Array.isArray(detalle))
    throw new MinecraftError(
      400,
      "payload_invalido",
      "Falta el desglose de la XP.",
    );
  const limpio = {};
  let total = 0;
  for (const [motivo, valor] of Object.entries(detalle)) {
    if (!MOTIVOS_XP.includes(motivo))
      throw new MinecraftError(
        400,
        "motivo_invalido",
        `Motivo de XP desconocido: ${motivo}.`,
      );
    if (!Number.isInteger(valor) || valor < 0)
      throw new MinecraftError(
        400,
        "payload_invalido",
        "La XP es un entero positivo.",
      );
    if (valor > 0) limpio[motivo] = valor;
    total += valor;
  }
  if (total < 1)
    throw new MinecraftError(400, "payload_invalido", "El lote no trae XP.");
  if (MOTIVO_ENTREGA in limpio && Object.keys(limpio).length > 1)
    throw new MinecraftError(
      400,
      "entrega_aparte",
      "La XP de entrega va en un lote propio, sin mezclar motivos.",
    );
  if (total > XP_POR_LOTE_MAX)
    throw new MinecraftError(
      400,
      "lote_excesivo",
      `Un lote suma como mucho ${XP_POR_LOTE_MAX} XP.`,
    );
  return { limpio, total, entrega: MOTIVO_ENTREGA in limpio };
}

/**
 * Suma un lote de XP a la ficha vinculada al UUID. Idempotente por `idLote` y con el tope del día aplicado en
 * la misma sentencia. Devuelve lo que de verdad se sumó (puede ser menos que lo pedido, o 0 si ya se topó).
 * @param {{ uuid: string, idLote: string, detalle: Record<string, number>, dia: string, ahora?: number }} entrada
 */
export async function sumarXp(
  ejecutor,
  { uuid, idLote, detalle, dia, ahora = Date.now() },
) {
  if (!uuidValido(idLote))
    throw new MinecraftError(
      400,
      "payload_invalido",
      "El lote necesita un id (UUID).",
    );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia)))
    throw new Error(`día inválido: ${dia}`);
  const { limpio, total, entrega } = desgloseValido(detalle);
  const tope = entrega ? XP_ENTREGA_MAX_DIA : XP_JUEGO_MAX_DIA;
  const e = await conTablas(ejecutor);
  const vinculo = await vinculoDeJugador(e, uuid);
  if (!vinculo)
    throw new MinecraftError(
      404,
      "sin_vinculo",
      "Esta cuenta no está vinculada a ninguna ficha.",
    );
  const id = idLote.toLowerCase();
  const previo = await e.execute(
    "SELECT cantidad FROM xp_juego WHERE id_lote = ?",
    [id],
  );
  if (previo.rows.length)
    return {
      vtuberId: vinculo.vtuberId,
      sumado: Number(previo.rows[0].cantidad),
      duplicado: true,
      ...(await deHoy(e, vinculo.vtuberId, dia)),
    };
  // «Es de entrega» se lee del desglose guardado: un lote de entrega solo trae ese motivo (ver desgloseValido).
  await e.execute(
    `INSERT INTO xp_juego (id_lote, vtuber_id, uuid, cantidad, detalle, dia, creado)
     SELECT ?, ?, ?, MIN(?, ? - hoy), ?, ?, ?
       FROM (SELECT COALESCE(SUM(cantidad), 0) AS hoy FROM xp_juego
              WHERE vtuber_id = ? AND dia = ? AND (json_extract(detalle, '$.entrega') IS NOT NULL) = ?)
      WHERE hoy < ?
     ON CONFLICT (id_lote) DO NOTHING`,
    [
      id,
      vinculo.vtuberId,
      uuid.toLowerCase(),
      total,
      tope,
      JSON.stringify(limpio),
      dia,
      new Date(ahora).toISOString(),
      vinculo.vtuberId,
      dia,
      entrega ? 1 : 0,
      tope,
    ],
  );
  const escrito = await e.execute(
    "SELECT cantidad FROM xp_juego WHERE id_lote = ?",
    [id],
  );
  return {
    vtuberId: vinculo.vtuberId,
    sumado: Number(escrito.rows[0]?.cantidad ?? 0),
    duplicado: false,
    ...(await deHoy(e, vinculo.vtuberId, dia)),
  };
}

/**
 * Lo de hoy, separado por clase de tope: `hoy`/`topeDia` es la XP de juego de siempre (el panel del plugin muestra
 * «hoy 120/300») y `entregaHoy`/`topeEntrega` la de entregas. Así llegar al tope de uno no apaga el aviso del otro.
 */
async function deHoy(e, vtuberId, dia) {
  const { rows } = await e.execute(
    `SELECT COALESCE(SUM(CASE WHEN json_extract(detalle, '$.entrega') IS NULL THEN cantidad ELSE 0 END), 0) AS n,
            COALESCE(SUM(CASE WHEN json_extract(detalle, '$.entrega') IS NULL THEN 0 ELSE cantidad END), 0) AS entrega
       FROM xp_juego WHERE vtuber_id = ? AND dia = ?`,
    [vtuberId, dia],
  );
  return {
    hoy: Number(rows[0]?.n ?? 0),
    topeDia: XP_JUEGO_MAX_DIA,
    entregaHoy: Number(rows[0]?.entrega ?? 0),
    topeEntrega: XP_ENTREGA_MAX_DIA,
  };
}

/** XP de juego que la ficha lleva HOY y el tope del día (el panel del juego muestra «hoy 120/300»). */
export async function xpDeHoy(ejecutor, vtuberId, dia) {
  return deHoy(await conTablas(ejecutor), Number(vtuberId), dia);
}

/** XP de juego de varias fichas en UNA consulta: `Map(id → xp)`. */
export async function xpDeJuegoVarias(ejecutor, ids) {
  const lista = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!lista.length) return new Map();
  const e = await conTablas(ejecutor);
  const marcas = lista.map(() => "?").join(",");
  const { rows } = await e.execute(
    `SELECT id, SUM(n) AS n FROM (
       SELECT vtuber_id AS id, cantidad AS n FROM xp_juego WHERE vtuber_id IN (${marcas})
       UNION ALL
       SELECT vtuber_id AS id, cantidad AS n FROM xp_directo WHERE vtuber_id IN (${marcas})
       UNION ALL
       SELECT vtuber_id AS id, cantidad AS n FROM xp_mision WHERE vtuber_id IN (${marcas})
     ) GROUP BY id`,
    [...lista, ...lista, ...lista],
  );
  return new Map(rows.map((r) => [Number(r.id), Number(r.n)]));
}

/** Toda la XP de juego de una ficha (lo que `experienciaConLikes` recibe como `xpJuego`). */
export async function xpDeJuego(ejecutor, vtuberId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute(
    `SELECT (SELECT COALESCE(SUM(cantidad), 0) FROM xp_juego WHERE vtuber_id = ?)
          + (SELECT COALESCE(SUM(cantidad), 0) FROM xp_directo WHERE vtuber_id = ?)
          + (SELECT COALESCE(SUM(cantidad), 0) FROM xp_mision WHERE vtuber_id = ?) AS n`,
    [Number(vtuberId), Number(vtuberId), Number(vtuberId)],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Premia con XP a una ficha que está EN DIRECTO. Idempotente por tramo: el id es `ficha:tramo` (el tramo es el
 * `DIRECTO_TRAMO_MIN` en que cae `ahora`), así que mirar la misma transmisión cada minuto suma UNA vez por tramo, y dos
 * procesos a la vez tampoco duplican (la clave primaria lo rechaza). El tope del día se aplica en la MISMA sentencia,
 * como en `sumarXp`. `dia` lo decide quien llama (Chile). Devuelve lo que de verdad se sumó (0 si el tramo ya estaba
 * pagado o el día ya llegó al tope). La XP entra a la barra por `xpDeJuego`, igual que la del juego.
 * @param {{ vtuberId: number, plataforma: string, dia: string, ahora?: number }} entrada
 */
export async function premiarDirecto(
  ejecutor,
  { vtuberId, plataforma, dia, ahora = Date.now() },
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia)))
    throw new Error(`día inválido: ${dia}`);
  const id = Number(vtuberId);
  if (!Number.isInteger(id)) throw new Error(`ficha inválida: ${vtuberId}`);
  const tramo = Math.floor(ahora / (DIRECTO_TRAMO_MIN * 60_000));
  const clave = `directo:${id}:${tramo}`;
  const e = await conTablas(ejecutor);
  const r = await e.execute(
    `INSERT INTO xp_directo (id_tramo, vtuber_id, plataforma, cantidad, dia, creado)
     SELECT ?, ?, ?, MIN(?, ? - hoy), ?, ?
       FROM (SELECT COALESCE(SUM(cantidad), 0) AS hoy FROM xp_directo WHERE vtuber_id = ? AND dia = ?)
      WHERE hoy < ?
     ON CONFLICT (id_tramo) DO NOTHING`,
    [
      clave,
      id,
      String(plataforma).slice(0, 20),
      XP_DIRECTO_POR_TRAMO,
      XP_DIRECTO_MAX_DIA,
      dia,
      new Date(ahora).toISOString(),
      id,
      dia,
      XP_DIRECTO_MAX_DIA,
    ],
  );
  if (!Number(r.rowsAffected ?? 0)) return 0;
  const escrito = await e.execute(
    "SELECT cantidad FROM xp_directo WHERE id_tramo = ?",
    [clave],
  );
  return Number(escrito.rows[0]?.cantidad ?? 0);
}
