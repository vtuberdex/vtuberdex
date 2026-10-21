/**
 * Minecraft: el pegamento HTTP entre el plugin del servidor de juego y las reglas de `server/src/minecraft.mjs`.
 *
 * DOS TIPOS DE LLAMADA
 * --------------------
 * · Servidor a servidor (`/api/minecraft/vincular|jugador|xp`): las hace SOLO el plugin, con la cabecera
 *   `X-Minecraft-Token` = `VTUBERDEX_MINECRAFT_TOKEN`. Sin token configurado o con otro, 404 como si la ruta no
 *   existiera (mismo patrón que `/api/stats/resumen`): no hay «modo abierto» por olvido.
 * · Desde «Mi ficha» (`/api/mi-ficha/minecraft`): la titular pide el código o desvincula, con su enlace mágico.
 *
 * LA XP DEL JUEGO NUNCA TUMBA UNA FICHA: `xpJuegoDe` devuelve 0 si el almacén falla, igual que los likes.
 */
import { RANGOS } from "../server/src/rangos.mjs";
import crypto from "node:crypto";

import {
  XP_ENTREGA_MAX_DIA,
  XP_JUEGO_MAX_DIA,
  XP_POR_LIKE,
  BASE_NIVEL,
  PASO_NIVEL,
  PUNTOS_POR_NIVEL,
  PUNTOS_STATS_POR_NIVEL,
  RANGO_MAXIMO,
} from "../server/src/experiencia.mjs";
import { ESTADOS } from "../server/src/habilidades.mjs";
import {
  MOTIVOS_XP,
  MinecraftError,
  XP_POR_LOTE_MAX,
  crearCodigoDeVinculo,
  desvincular,
  envioDeCodigoPermitido,
  requiereSesion,
  sesionVigente,
  uuidValido,
  sumarXp,
  vincular,
  vinculoDeFicha,
  vinculoDeJugador,
  xpDeHoy,
  xpDeJuego,
  xpDeJuegoVarias,
} from "../server/src/minecraft.mjs";
import {
  PuntosError,
  STATS_AUTOMATICOS,
  STATS_MEJORABLES,
  estadoDePuntos,
  estadoDeStats,
  subirStat,
} from "../server/src/mi-ficha.mjs";
import { correoDeMinecraft, enviarCorreo } from "./correo.mjs";
import { dbConDiario } from "./diario.mjs";
import { conExperiencia, contarLikes, diaDeChile } from "./likes.mjs";
import { hashearRed } from "../server/src/solicitudes.mjs";
import { ejecutorDeSolicitudes } from "./solicitudes.mjs";

const CABECERAS = { "cache-control": "no-store" };
const responder = (cuerpo, status = 200) =>
  Response.json(cuerpo, { status, headers: CABECERAS });
const NO_ENCONTRADO = () => responder({ error: "no_encontrado" }, 404);

/** ¿La petición viene del plugin? Comparación en tiempo constante; sin token configurado (≥16), nunca. */
export function tokenDeMinecraftValido(request, env = process.env) {
  const esperado = env.VTUBERDEX_MINECRAFT_TOKEN;
  const recibido = request.headers.get("x-minecraft-token");
  if (!esperado || esperado.length < 16 || typeof recibido !== "string")
    return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** XP de juego de una ficha; 0 si el almacén falla (es un añadido: no puede tumbar la ficha). */
export async function xpJuegoDe(vtuberId, ejecutor) {
  try {
    return await xpDeJuego(
      ejecutor ?? (await ejecutorDeSolicitudes()),
      vtuberId,
    );
  } catch (error) {
    console.error(
      `[minecraft] la ficha ${vtuberId} sale sin XP de juego: ${error.message}`,
    );
    return 0;
  }
}

/** XP de juego de varias fichas (`Map`); vacío si el almacén falla. */
export async function xpJuegoDeVarias(ids, ejecutor) {
  try {
    return await xpDeJuegoVarias(
      ejecutor ?? (await ejecutorDeSolicitudes()),
      ids,
    );
  } catch (error) {
    console.error(
      `[minecraft] el listado sale sin XP de juego: ${error.message}`,
    );
    return new Map();
  }
}

/**
 * La red del JUGADOR (no la del servidor de Minecraft, que llama desde 127.0.0.1): el plugin la manda en
 * `X-Jugador-Red`. Sale de aquí ya convertida en hash con sal; la IP no se guarda ni se pasa a las reglas.
 */
function redDelJugador(request) {
  const ip = request.headers.get("x-jugador-red");
  return typeof ip === "string" && ip.length > 0 && ip.length <= 64
    ? hashearRed(ip.trim())
    : null;
}

const deError = (error, contexto) => {
  if (error instanceof MinecraftError)
    return responder({ error: error.code, detail: error.detail }, error.status);
  console.error(`[minecraft] ${contexto}: ${error.message}`);
  return responder(
    {
      error: "no_disponible",
      detail: "No disponible. Inténtalo de nuevo en unos minutos.",
    },
    503,
  );
};

/* ------------------------------------------------------------------ reglas */

/**
 * `GET /api/minecraft/reglas` (público): lo que el plugin necesita para no copiar reglas. La curva, los topes de
 * XP, qué stats suben y el catálogo de estados (nombre, color, polaridad) salen de los MISMOS módulos que usa la
 * web: si cambian, el plugin los recibe en su siguiente recarga.
 */
export function reglas() {
  return {
    experiencia: {
      xpPorLike: XP_POR_LIKE,
      baseNivel: BASE_NIVEL,
      pasoNivel: PASO_NIVEL,
      puntosPorNivel: PUNTOS_POR_NIVEL,
      puntosStatsPorNivel: PUNTOS_STATS_POR_NIVEL,
      rangoMaximo: RANGO_MAXIMO,
    },
    rangos: RANGOS,
    xpJuego: {
      maxDia: XP_JUEGO_MAX_DIA,
      maxDiaEntrega: XP_ENTREGA_MAX_DIA,
      maxLote: XP_POR_LOTE_MAX,
      motivos: MOTIVOS_XP,
    },
    stats: { mejorables: STATS_MEJORABLES, automaticos: STATS_AUTOMATICOS },
    estados: ESTADOS.map((e) => ({
      nombre: e.nombre,
      color: e.color,
      polaridad: e.polaridad,
      faccion: e.faccion ?? null,
    })),
  };
}

/* ------------------------------------------------------- servidor a servidor */

/** `POST /api/minecraft/vincular` `{ codigo, uuid, jugador }` → `{ slug, name }` de la ficha vinculada. */
export async function vincularDesdeElJuego(
  request,
  { ejecutor, db, env } = {},
) {
  if (!tokenDeMinecraftValido(request, env)) return NO_ENCONTRADO();
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const { vtuberId } = await vincular(e, {
      codigo: cuerpo?.codigo,
      uuid: cuerpo?.uuid,
      jugador: cuerpo?.jugador,
      red: redDelJugador(request),
    });
    const ficha = fichaPorId(db ?? (await dbConDiario()), vtuberId);
    return responder({ ok: true, ...ficha });
  } catch (error) {
    return deError(error, "vincular");
  }
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ESPERAS = {
  espera: "Espera un minuto antes de pedir otro código a ese correo.",
  tope_correo: "Ese correo ya recibió varios códigos hoy. Prueba mañana.",
  tope_cuenta: "Pediste demasiados códigos hoy. Prueba mañana.",
  tope_red:
    "Se pidieron demasiados códigos desde tu conexión hoy. Prueba mañana.",
};

/**
 * `POST /api/minecraft/email` `{ uuid, jugador, email }`: el jugador escribió `/vtd email <correo>` en el juego. Si ese
 * correo tiene fichas, le llega un código por ficha, atado a ESA cuenta de Minecraft. Responde lo mismo tenga o no
 * fichas (no se puede preguntar desde el juego «¿este correo está inscrito?»); solo el tope de envíos se dice, y se
 * aplica igual a cualquier correo.
 * @param {Request} request
 * @param {{ ejecutor?: any, db?: any, env?: Record<string, string | undefined>, esperar?: boolean }} [opciones]
 */
export async function pedirCodigoPorCorreo(
  request,
  { ejecutor, db, env = process.env, esperar = false } = {},
) {
  if (!tokenDeMinecraftValido(request, env)) return NO_ENCONTRADO();
  const cuerpo = await request.json().catch(() => null);
  const email =
    typeof cuerpo?.email === "string" ? cuerpo.email.trim().toLowerCase() : "";
  if (!uuidValido(cuerpo?.uuid))
    return responder(
      { error: "uuid_invalido", detail: "UUID de Minecraft no válido." },
      400,
    );
  if (email.length > 200 || !CORREO.test(email))
    return responder(
      {
        error: "payload_invalido",
        detail: "Escribe un correo válido: /vtd email tu@correo.com",
      },
      400,
    );
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const permiso = await envioDeCodigoPermitido(e, {
      email,
      uuid: cuerpo.uuid,
      red: redDelJugador(request),
    });
    if (!permiso.ok)
      return responder(
        { error: permiso.motivo, detail: ESPERAS[permiso.motivo] },
        429,
      );
    const trabajo = (async () => {
      const { fichasDelCorreo } = await import("./mi-ficha.mjs");
      const fichas = await fichasDelCorreo(
        e,
        db ?? (await dbConDiario()),
        email,
      );
      if (!fichas.length) return;
      const codigos = [];
      for (const ficha of fichas)
        codigos.push({
          nombre: ficha.name,
          codigo: (
            await crearCodigoDeVinculo(e, {
              vtuberId: ficha.id,
              uuid: cuerpo.uuid,
            })
          ).codigo,
        });
      const { asunto, texto, html } = correoDeMinecraft(
        {
          codigos,
          jugador: typeof cuerpo.jugador === "string" ? cuerpo.jugador : "",
        },
        env,
      );
      await enviarCorreo({ para: email, asunto, texto, html }, env);
    })().catch((error) =>
      console.error(
        `[minecraft] no se pudo mandar el código: ${error.message}`,
      ),
    );
    if (esperar) await trabajo;
    return responder({ ok: true });
  } catch (error) {
    return deError(error, "email");
  }
}

/**
 * `GET /api/minecraft/jugador/:uuid` (con `X-Jugador-Red`) → `{ vinculado, slug?, name? }`. Una cuenta sin verificar
 * vinculada pero sin sesión para esa red responde `vinculado: false, necesitaSesion: true` y SIN la ficha: quien se puso
 * su nombre no debe saber de quién es.
 */
export async function jugador(request, uuid, { ejecutor, db, env } = {}) {
  if (!tokenDeMinecraftValido(request, env)) return NO_ENCONTRADO();
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const vinculo = await vinculoDeJugador(e, uuid);
    if (!vinculo) return responder({ vinculado: false });
    const red = redDelJugador(request);
    if (
      requiereSesion(uuid) &&
      !(red && (await sesionVigente(e, { uuid, red })))
    )
      return responder({ vinculado: false, necesitaSesion: true });
    const base = db ?? (await dbConDiario());
    const ficha = fichaPorId(base, vinculo.vtuberId);
    return responder({
      vinculado: true,
      desde: vinculo.desde,
      ...ficha,
      progreso: await progresoDe(e, base, vinculo.vtuberId, ficha.slug),
    });
  } catch (error) {
    return deError(error, "jugador");
  }
}

/** `DELETE /api/minecraft/jugador/:uuid`: el jugador se desvincula desde el juego. */
export async function desvincularDesdeElJuego(
  request,
  uuid,
  { ejecutor, env } = {},
) {
  if (!tokenDeMinecraftValido(request, env)) return NO_ENCONTRADO();
  try {
    return responder({
      ok: await desvincular(ejecutor ?? (await ejecutorDeSolicitudes()), {
        uuid,
      }),
    });
  } catch (error) {
    return deError(error, "desvincular");
  }
}

/**
 * `POST /api/minecraft/xp` `{ uuid, idLote, detalle: { mob: 12, … } }`. Responde lo sumado, lo de hoy y el nivel
 * resultante. Si el lote hizo subir de nivel a la ficha, su titular recibe el mismo aviso que con un like.
 */
export async function recibirXp(request, { ejecutor, db, env, avisar } = {}) {
  if (!tokenDeMinecraftValido(request, env)) return NO_ENCONTRADO();
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    // Defensa en el servidor, aunque el plugin solo manda XP de quien entró con sesión: sin sesión vigente no suma.
    if (
      uuidValido(cuerpo?.uuid) &&
      !(await sesionVigente(e, { uuid: cuerpo.uuid }))
    ) {
      return responder(
        {
          error: "sin_vinculo",
          detail: "Esta cuenta no tiene una sesión vigente.",
        },
        404,
      );
    }
    const resultado = await sumarXp(e, {
      uuid: cuerpo?.uuid,
      idLote: cuerpo?.idLote,
      detalle: cuerpo?.detalle,
      dia: diaDeChile(),
    });
    const base = db ?? (await dbConDiario());
    const fila = base
      .prepare("SELECT slug FROM vtuber WHERE id = ?")
      .get(resultado.vtuberId);
    if (resultado.sumado > 0 && !resultado.duplicado && fila) {
      // Import perezoso: `lib/mi-ficha.mjs` arrastra el correo, que esta ruta solo necesita al subir de nivel.
      const aviso =
        avisar ?? (await import("./mi-ficha.mjs")).avisarSubidaDeNivel;
      const { getVtuberBySlug } = await import("../server/src/search.mjs");
      const card = getVtuberBySlug(base, fila.slug, { includeHidden: true });
      if (card)
        void Promise.all([contarLikes(card.id), xpDeJuego(e, card.id)]).then(
          ([likes, xp]) => aviso({ card, likes, xpJuego: xp }),
        );
    }
    return responder({
      ok: true,
      sumado: resultado.sumado,
      duplicado: resultado.duplicado,
      hoy: resultado.hoy,
      topeDia: resultado.topeDia,
      entregaHoy: resultado.entregaHoy,
      topeEntrega: resultado.topeEntrega,
      slug: fila?.slug ?? null,
    });
  } catch (error) {
    return deError(error, "xp");
  }
}

/** Más de esto de una vez no tiene sentido: un nivel da `PUNTOS_STATS_POR_NIVEL` y el plugin pide de a 1, 5 o 10. */
const PUNTOS_POR_LLAMADA_MAX = 50;

/**
 * `POST /api/minecraft/puntos` `{ uuid, stat, cantidad? }` (solo con `X-Minecraft-Token`): gasta puntos de stats de la
 * ficha vinculada al jugador (la ventana `/vtd stats` del juego). Mismas reglas que «Mi ficha» (`subirStat`: un punto por
 * sentencia condicional, sin pasar de lo ganado ni del tope); `cantidad` (1 por defecto) solo repite ese gasto. Si se
 * acaban los puntos a mitad, responde lo aplicado hasta ahí; solo falla si no se pudo gastar NINGUNO.
 * Responde `{ ok, aplicados, puntosStats }` con los puntos que quedan.
 */
export async function repartirDesdeElJuego(
  request,
  { ejecutor, db, env } = {},
) {
  if (!tokenDeMinecraftValido(request, env)) return NO_ENCONTRADO();
  const cuerpo = await request.json().catch(() => null);
  const cantidad = cuerpo?.cantidad === undefined ? 1 : cuerpo.cantidad;
  if (
    !uuidValido(cuerpo?.uuid) ||
    typeof cuerpo?.stat !== "string" ||
    !Number.isInteger(cantidad) ||
    cantidad < 1 ||
    cantidad > PUNTOS_POR_LLAMADA_MAX
  ) {
    return responder(
      { error: "payload_invalido", detail: "Datos no válidos." },
      400,
    );
  }
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    // Igual que la XP: sin sesión vigente (cuenta sin verificar) no se toca la ficha.
    if (!(await sesionVigente(e, { uuid: cuerpo.uuid })))
      return responder(
        {
          error: "sin_vinculo",
          detail: "Esta cuenta no tiene una sesión vigente.",
        },
        404,
      );
    const vinculo = await vinculoDeJugador(e, cuerpo.uuid);
    if (!vinculo)
      return responder(
        {
          error: "sin_vinculo",
          detail: "Esta cuenta no está vinculada a una ficha.",
        },
        404,
      );
    const base = db ?? (await dbConDiario());
    const { slug } = fichaPorId(base, vinculo.vtuberId);
    const { getVtuberBySlug } = await import("../server/src/search.mjs");
    const { equilibrarStats } = await import("../server/src/equilibrio.mjs");
    const completa = slug
      ? getVtuberBySlug(base, slug, { includeHidden: true })
      : null;
    if (!completa)
      return responder(
        { error: "no_encontrado", detail: "La ficha no está disponible." },
        404,
      );
    const [likes, xp] = await Promise.all([
      contarLikes(vinculo.vtuberId),
      xpDeJuego(e, vinculo.vtuberId),
    ]);
    const entrada = {
      vtuberId: vinculo.vtuberId,
      stats: equilibrarStats(completa.stats),
      nivelesGanados: conExperiencia(completa, likes, xp).levelsGained,
      slug: cuerpo.stat,
    };
    let aplicados = 0;
    let estado = null;
    for (let i = 0; i < cantidad; i++) {
      try {
        estado = await subirStat(e, entrada);
        aplicados++;
      } catch (error) {
        if (aplicados > 0 && error instanceof PuntosError) break; // se acabaron o llegó al tope: vale lo aplicado
        throw error;
      }
    }
    return responder({ ok: true, aplicados, puntosStats: estado.disponibles });
  } catch (error) {
    if (error instanceof PuntosError)
      return responder(
        { error: error.code, detail: error.detail },
        error.status,
      );
    return deError(error, "puntos");
  }
}

/**
 * Lo que el panel del juego muestra y la ficha pública no trae: la XP de juego de HOY con su tope y los puntos que la
 * titular tiene por repartir en «Mi ficha». Mismas reglas que la web (`estadoDePuntos`/`estadoDeStats`). Es un añadido:
 * si falla, el jugador entra igual y el panel lo omite.
 */
async function progresoDe(e, base, vtuberId, slug) {
  try {
    const { getVtuberBySlug } = await import("../server/src/search.mjs");
    const { equilibrarStats } = await import("../server/src/equilibrio.mjs");
    const completa = slug
      ? getVtuberBySlug(base, slug, { includeHidden: true })
      : null;
    if (!completa) return null;
    const [likes, xp, hoy] = await Promise.all([
      contarLikes(vtuberId),
      xpDeJuego(e, vtuberId),
      xpDeHoy(e, vtuberId, diaDeChile()),
    ]);
    const card = conExperiencia(completa, likes, xp);
    const [habilidades, stats] = await Promise.all([
      estadoDePuntos(e, {
        vtuberId,
        skills: completa.skills,
        nivelesGanados: card.levelsGained,
      }),
      estadoDeStats(e, {
        vtuberId,
        stats: equilibrarStats(completa.stats),
        nivelesGanados: card.levelsGained,
      }),
    ]);
    return {
      likes,
      xpJuego: xp,
      xpHoy: hoy.hoy,
      topeDia: hoy.topeDia,
      puntosHabilidad: habilidades.disponibles,
      puntosStats: stats.disponibles,
    };
  } catch (error) {
    console.error(
      `[minecraft] progreso de la ficha ${vtuberId}: ${error.message}`,
    );
    return null;
  }
}

function fichaPorId(db, vtuberId) {
  const fila = db
    .prepare("SELECT slug, name FROM vtuber WHERE id = ?")
    .get(vtuberId);
  return fila
    ? { slug: String(fila.slug), name: String(fila.name) }
    : { slug: null, name: null };
}

/* --------------------------------------------------------------- «Mi ficha» */

/** Lo que «Mi ficha» muestra del vínculo: el nombre de jugador y desde cuándo (el UUID no hace falta verlo). */
export async function estadoMinecraft(ejecutor, vtuberId) {
  const v = await vinculoDeFicha(ejecutor, vtuberId);
  return {
    vinculado: Boolean(v),
    jugador: v?.jugador ?? null,
    desde: v?.desde ?? null,
    xpJuego: await xpDeJuego(ejecutor, vtuberId),
  };
}

/** Código nuevo o desvincular, sobre una ficha que ya se comprobó que es de quien llama. */
export async function accionMinecraft(ejecutor, vtuberId, accion) {
  if (accion === "codigo")
    return { codigo: await crearCodigoDeVinculo(ejecutor, { vtuberId }) };
  if (accion === "desvincular") {
    await desvincular(ejecutor, { vtuberId });
    return {};
  }
  throw new MinecraftError(400, "payload_invalido", "Acción no válida.");
}
