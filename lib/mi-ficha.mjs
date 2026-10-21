/**
 * «Mi ficha»: el pegamento HTTP del reparto de puntos de habilidad y del aviso de subida de nivel.
 * Las reglas viven en `server/src/mi-ficha.mjs` y `server/src/experiencia.mjs`; aquí solo se decide
 * quién es la persona, qué ficha mira y cuándo se manda el correo.
 *
 * LA LLAVE ES EL CORREO, NO UNA CONTRASEÑA
 * ----------------------------------------
 * El enlace mágico lleva un token (propósito `ficha`, 7 días, NO se gasta) atado al correo con que se
 * inscribió la ficha. Con él se listan las fichas de ese correo (`fichasDelTitular`) y solo sobre ellas
 * se puede repartir. El token viaja en el fragmento de la URL (no llega a nginx ni a los logs) y en el
 * cuerpo de un POST. Las fichas del scrape original no tienen correo guardado: no tienen «Mi ficha»
 * (el mantenedor puede editarlas igual).
 *
 * EL AVISO NO RETRASA EL LIKE: sale en segundo plano y nunca rompe la respuesta; si el correo falla se
 * suelta el aviso para que el siguiente like lo reintente (`soltarAvisoDeNivel`).
 */
import {
  PuntosError,
  estadoDePuntos,
  estadoDeStats,
  reclamarAvisoDeNivel,
  reiniciarRangos,
  reiniciarStats,
  subirStat,
  soltarAvisoDeNivel,
  subirHabilidad,
} from "../server/src/mi-ficha.mjs";
import {
  correoDeLaFicha,
  fichasDelTitular,
} from "../server/src/solicitudes.mjs";
import { limitePorRed } from "./limite-red.mjs";
import { equilibrarStats } from "../server/src/equilibrio.mjs";
import { getVtuberBySlug } from "../server/src/search.mjs";
import { correoDeMiFicha, enviarCorreo } from "./correo.mjs";
import { aplicarYAnotar, dbConDiario } from "./diario.mjs";
import {
  conExperiencia,
  contarLikes,
  diaDeChile,
  experienciaDe,
  ipDelCliente,
  origenPermitido,
} from "./likes.mjs";
import { accionMinecraft, estadoMinecraft, xpJuegoDe } from "./minecraft.mjs";
import { ejecutorDeSolicitudes } from "./solicitudes.mjs";
import { MinecraftError } from "../server/src/minecraft.mjs";
import {
  MisionError,
  misionesDeFicha,
  reclamarGrado,
  soltarReclamo,
} from "../server/src/misiones.mjs";
import {
  correoDelToken,
  crearToken,
  envioPermitido,
} from "../server/src/verificacion.mjs";

/** @typedef {{ ejecutor?: any, db?: any, esperar?: boolean, env?: Record<string, string | undefined> }} Opciones */

const CABECERAS = { "cache-control": "no-store" };
const responder = (cuerpo, status = 200) =>
  Response.json(cuerpo, { status, headers: CABECERAS });
const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Una ficha dada de baja (grado 1) no tiene página ni puntos: es secreta. */
const activa = (ficha) => ficha && ficha.premium?.grade !== "1";

/** Por id: lo que `ficha_correo` guarda. El id no cambia aunque la ficha cambie de slug. */
const resolverPorId = (db) => (id) => {
  const fila = db.prepare("SELECT slug FROM vtuber WHERE id = ?").get(id);
  return fila ? resolver(db)(fila.slug) : null;
};

const resolver = (db) => (slug) => {
  const ficha = getVtuberBySlug(db, slug, { includeHidden: true });
  // «Mi ficha» reparte puntos sobre los stats que ve el público: los equilibrados, no los crudos.
  return activa(ficha)
    ? { ...ficha, stats: equilibrarStats(ficha.stats) }
    : null;
};

/** Las fichas activas de un correo (inscripción aprobada o correo fijado por el mantenedor). Lo usa también Minecraft. */
export async function fichasDelCorreo(ejecutor, db, email) {
  return (
    await fichasDelTitular(ejecutor, {
      email,
      resolverFicha: resolver(db),
      resolverPorId: resolverPorId(db),
    })
  ).map((f) => f.ficha);
}

/** Ficha con experiencia calculada con sus likes y lo jugado en Minecraft. */
async function conNivel(ficha, ejecutor) {
  const [likes, xpJuego] = await Promise.all([
    contarLikes(ficha.id),
    xpJuegoDe(ficha.id, ejecutor),
  ]);
  return conExperiencia(ficha, likes, xpJuego);
}

/* ------------------------------------------------------------- aviso de nivel */

/**
 * Llamar tras un like registrado. Si la ficha acaba de subir de nivel y se conoce su correo, le manda el
 * enlace mágico con los puntos que tiene para repartir. Seguro de llamar siempre: nunca lanza.
 * @param {{ card: object, likes: number, xpJuego?: number, env?: object, ejecutor?: any, db?: any }} datos
 *   `card` es la ficha ANTES de aplicar likes (con su nivel base); `likes` el total ya con el nuevo. `xpJuego`
 *   es la XP de Minecraft: si no viene se lee (un like también puede rematar un nivel que el juego dejó a medias).
 */
export async function avisarSubidaDeNivel({
  card,
  likes,
  xpJuego,
  env = process.env,
  ejecutor,
  db,
}) {
  let reclamado = null;
  const e = ejecutor ?? (await ejecutorDeSolicitudes().catch(() => null));
  if (!e) return false;
  try {
    const juego = xpJuego ?? (await xpJuegoDe(card.id, e));
    const exp = experienciaDe(card, likes, juego);
    if (exp.nivelesGanados < 1) return false;
    if (
      !(await reclamarAvisoDeNivel(e, {
        vtuberId: card.id,
        nivel: exp.level,
        nivelBase: exp.level - exp.nivelesGanados,
      }))
    )
      return false;
    reclamado = exp.level;
    const base = db ?? (await dbConDiario());
    const completa = getVtuberBySlug(base, card.slug, { includeHidden: true });
    if (!activa(completa)) return false;
    const email = await correoDeLaFicha(e, {
      fichaId: card.id,
      resolverFicha: resolver(base),
    });
    if (!email) return false; // ficha del scrape: nadie a quien avisar (el nivel queda anotado igual)
    const puntos = (
      await estadoDePuntos(e, {
        vtuberId: card.id,
        skills: completa.skills,
        nivelesGanados: exp.nivelesGanados,
      })
    ).disponibles;
    const permiso = await envioPermitido(e, {
      email,
      proposito: "ficha",
      maximo: 8,
      espera: 0,
    });
    if (!permiso.ok) return false;
    const token = await crearToken(e, { proposito: "ficha", email });
    const { asunto, texto, html } = correoDeMiFicha(
      { token, nombre: card.name, nivel: exp.level, puntos, motivo: "nivel" },
      env,
    );
    await enviarCorreo({ para: email, asunto, texto, html }, env);
    return true;
  } catch (error) {
    console.error(
      `[mi-ficha] no se pudo avisar del nivel de ${card?.slug}: ${error.message}`,
    );
    if (reclamado !== null)
      await soltarAvisoDeNivel(e, {
        vtuberId: card.id,
        nivel: reclamado,
      }).catch(() => {});
    return false;
  }
}

/* --------------------------------------------------------------- pedir enlace */

const porRed = (globalThis.__vtuberdexMiFichaRed ??= new Map());
const redAgotada = limitePorRed(porRed);

/** Solo para los tests. */
export function __reiniciarLimiteMiFicha() {
  porRed.clear();
}

/**
 * `POST /api/mi-ficha/enlace` `{ email }`: manda el enlace mágico a ese correo SI tiene fichas. Responde
 * siempre lo mismo para cualquier correo bien formado: no se puede preguntar «¿esta persona está inscrita?».
 */
export async function pedirEnlaceDeMiFicha(
  request,
  {
    ejecutor,
    db,
    esperar = false,
    env = process.env,
  } = /** @type {Opciones} */ ({}),
) {
  if (!origenPermitido(request.headers))
    return responder({ error: "origen_no_permitido" }, 403);
  const cuerpo = await request.json().catch(() => null);
  const email =
    typeof cuerpo?.email === "string" ? cuerpo.email.trim().toLowerCase() : "";
  if (email.length > 200 || !CORREO.test(email))
    return responder(
      { error: "payload_invalido", detail: "Escribe un correo válido." },
      400,
    );
  if (redAgotada(ipDelCliente(request.headers))) {
    return responder(
      {
        error: "demasiados_intentos",
        detail: "Demasiados intentos desde esta red. Espera unos minutos.",
      },
      429,
    );
  }
  const trabajo = (async () => {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const base = db ?? (await dbConDiario());
    const fichas = await fichasDelTitular(e, {
      email,
      resolverFicha: resolver(base),
      resolverPorId: resolverPorId(base),
    });
    if (!fichas.length) return;
    const permiso = await envioPermitido(e, { email, proposito: "ficha" });
    if (!permiso.ok) return;
    const token = await crearToken(e, { proposito: "ficha", email });
    const { asunto, texto, html } = correoDeMiFicha(
      {
        token,
        nombre: fichas.length === 1 ? fichas[0].ficha.name : "",
        motivo: "enlace",
      },
      env,
    );
    await enviarCorreo({ para: email, asunto, texto, html }, env);
  })().catch((error) =>
    console.error(`[mi-ficha] no se pudo enviar el enlace: ${error.message}`),
  );
  if (esperar) await trabajo;
  return responder({ ok: true });
}

/* --------------------------------------------------------------------- estado */

/** Todo lo que la pantalla necesita de una ficha: nivel, barra, total y reparto de puntos. */
async function vistaDeFicha(e, ficha) {
  const card = await conNivel(ficha, e);
  const puntos = await estadoDePuntos(e, {
    vtuberId: ficha.id,
    skills: ficha.skills,
    nivelesGanados: card.levelsGained,
  });
  return {
    slug: ficha.slug,
    name: ficha.name,
    level: card.level,
    levelsGained: card.levelsGained,
    likes: card.likes,
    experience: card.experience,
    puntos,
    // Bolsa APARTE de la de habilidades: 10 puntos por nivel para HP, MP, ataques y defensas, y el bono
    // automático de velocidad, evasión, precisión, crítico y suerte.
    statsPuntos: await estadoDeStats(e, {
      vtuberId: ficha.id,
      stats: ficha.stats,
      nivelesGanados: card.levelsGained,
    }),
    // La cuenta de Minecraft vinculada (si hay) y la XP que ya trajo del juego.
    minecraft: await estadoMinecraft(e, ficha.id),
    // Misiones de Minecraft (XP y grado). Un adorno: si su almacén falla, la pantalla sigue sin esa sección.
    misiones: await misionesDeFicha(e, {
      vtuberId: ficha.id,
      dia: diaDeChile(),
      gradoActual: ficha.premium?.grade ?? null,
    }).catch((error) => {
      console.error(`[mi-ficha] misiones no disponibles: ${error.message}`);
      return null;
    }),
  };
}

/** Resuelve token → correo → fichas. `null` si el enlace no sirve. */
async function sesionDeMiFicha(e, db, token) {
  const dueno = await correoDelToken(
    e,
    typeof token === "string" ? token : "",
    "ficha",
  );
  if (!dueno) return null;
  const fichas = (
    await fichasDelTitular(e, {
      email: dueno.email,
      resolverFicha: resolver(db),
      resolverPorId: resolverPorId(db),
    })
  ).map((f) => f.ficha);
  return { email: dueno.email, fichas };
}

const ENLACE_INVALIDO = {
  error: "enlace_invalido",
  detail:
    "Este enlace caducó o no es válido. Pide uno nuevo con tu correo y te lo mandamos al momento.",
};

/**
 * Lo común a las rutas con el enlace del correo: origen, cuerpo, ejecutor y sesión (410 si el enlace no
 * vale). `atender` recibe `{ e, cuerpo, sesion }`; un error de `ErrorConocido` responde su status y
 * cualquier otro, un 503 con `detalle503` (anotado como `[mi-ficha] <etiqueta>`).
 */
async function conSesion(
  request,
  { ejecutor, db },
  { etiqueta, detalle503, ErrorConocido },
  atender,
) {
  if (!origenPermitido(request.headers))
    return responder({ error: "origen_no_permitido" }, 403);
  const cuerpo = await request.json().catch(() => null);
  try {
    const e = ejecutor ?? (await ejecutorDeSolicitudes());
    const base = db ?? (await dbConDiario());
    const sesion = await sesionDeMiFicha(e, base, cuerpo?.token);
    if (!sesion) return responder(ENLACE_INVALIDO, 410);
    return await atender({ e, cuerpo, sesion });
  } catch (error) {
    if (ErrorConocido && error instanceof ErrorConocido)
      return responder(
        { error: error.code, detail: error.detail },
        error.status,
      );
    console.error(`[mi-ficha] ${etiqueta}: ${error.message}`);
    return responder({ error: "no_disponible", detail: detalle503 }, 503);
  }
}

const NO_ES_TUYA = {
  error: "no_encontrado",
  detail: "Esa ficha no es tuya o ya no existe.",
};

/**
 * `POST /api/mi-ficha` `{ token, slug? }`: el estado de la ficha elegida (la primera si no se elige) y las
 * demás fichas de ese correo.
 */
export function estadoDeMiFicha(
  request,
  opciones = /** @type {Opciones} */ ({}),
) {
  const errores = {
    etiqueta: "estado",
    detalle503:
      "No se pudo cargar tu ficha. Inténtalo de nuevo en unos minutos.",
  };
  return conSesion(
    request,
    opciones,
    errores,
    async ({ e, cuerpo, sesion }) => {
      if (!sesion.fichas.length)
        return responder(
          {
            error: "sin_fichas",
            detail: "No encontramos fichas con este correo.",
          },
          404,
        );
      const elegida =
        sesion.fichas.find((f) => f.slug === cuerpo?.slug) ?? sesion.fichas[0];
      return responder({
        ok: true,
        fichas: sesion.fichas.map((f) => ({ slug: f.slug, name: f.name })),
        ficha: await vistaDeFicha(e, elegida),
      });
    },
  );
}

/**
 * `POST /api/mi-ficha/puntos` `{ token, slug, accion: 'subir' | 'reiniciar' | 'subir-stat' | 'reiniciar-stats', clave? }`: gasta
 * un punto en una habilidad (o en un stat, con `clave` = su slug) o devuelve los repartidos de esa bolsa. Responde con el estado nuevo de la ficha.
 */
export function repartirPuntos(
  request,
  opciones = /** @type {Opciones} */ ({}),
) {
  const errores = {
    etiqueta: "puntos",
    detalle503: "No se pudo guardar. Inténtalo de nuevo en unos minutos.",
    ErrorConocido: PuntosError,
  };
  return conSesion(
    request,
    opciones,
    errores,
    async ({ e, cuerpo, sesion }) => {
      const ficha = sesion.fichas.find((f) => f.slug === cuerpo?.slug);
      if (!ficha) return responder(NO_ES_TUYA, 404);
      const card = await conNivel(ficha, e);
      const entrada = {
        vtuberId: ficha.id,
        skills: ficha.skills,
        nivelesGanados: card.levelsGained,
      };
      const entradaStats = {
        vtuberId: ficha.id,
        stats: ficha.stats,
        nivelesGanados: card.levelsGained,
      };
      if (cuerpo?.accion === "reiniciar-stats")
        await reiniciarStats(e, entradaStats);
      else if (
        cuerpo?.accion === "subir-stat" &&
        typeof cuerpo.clave === "string"
      )
        await subirStat(e, { ...entradaStats, slug: cuerpo.clave });
      else if (cuerpo?.accion === "reiniciar")
        await reiniciarRangos(e, entrada);
      else if (cuerpo?.accion === "subir" && typeof cuerpo.clave === "string")
        await subirHabilidad(e, { ...entrada, clave: cuerpo.clave });
      else
        return responder(
          { error: "payload_invalido", detail: "Acción no válida." },
          400,
        );
      return responder({ ok: true, ficha: await vistaDeFicha(e, ficha) });
    },
  );
}

/**
 * `POST /api/mi-ficha/minecraft` `{ token, slug, accion: 'codigo' | 'desvincular' }`: pide un código para vincular la
 * cuenta de Minecraft (se escribe en el juego con `/vtd vincular <código>`) o suelta el vínculo. Solo sobre una ficha
 * del correo del enlace. Responde con el estado nuevo de la ficha y, si se pidió, el código (que no se vuelve a mostrar).
 */
export function minecraftDeMiFicha(
  request,
  opciones = /** @type {Opciones} */ ({}),
) {
  const errores = {
    etiqueta: "minecraft",
    detalle503: "No se pudo completar. Inténtalo de nuevo en unos minutos.",
    ErrorConocido: MinecraftError,
  };
  return conSesion(
    request,
    opciones,
    errores,
    async ({ e, cuerpo, sesion }) => {
      const ficha = sesion.fichas.find((f) => f.slug === cuerpo?.slug);
      if (!ficha) return responder(NO_ES_TUYA, 404);
      const extra = await accionMinecraft(e, ficha.id, cuerpo?.accion);
      return responder({
        ok: true,
        ...extra,
        ficha: await vistaDeFicha(e, ficha),
      });
    },
  );
}

/**
 * `POST /api/mi-ficha/misiones` `{ token, slug, accion: 'reclamar-grado', mision }`: reclama el grado de una misión de grado
 * ya completada. Es OPCIONAL a propósito: completar la misión da el derecho, la persona decide si convertirlo en la placa
 * de su carta. El grado se aplica por el diario de siempre (actor `mision`); si eso falla, el reclamo se suelta y se puede
 * reintentar. Reclamar nunca baja un grado ni toca una carta deteriorada (`elegibilidadDeGrado`).
 */
export function misionesDeMiFicha(
  request,
  opciones = /** @type {Opciones} */ ({}),
) {
  const errores = {
    etiqueta: "misiones",
    detalle503: "No se pudo reclamar. Inténtalo de nuevo en unos minutos.",
    ErrorConocido: MisionError,
  };
  return conSesion(
    request,
    opciones,
    errores,
    async ({ e, cuerpo, sesion }) => {
      const ficha = sesion.fichas.find((f) => f.slug === cuerpo?.slug);
      if (!ficha) return responder(NO_ES_TUYA, 404);
      if (cuerpo?.accion !== "reclamar-grado" || typeof cuerpo.mision !== "string")
        return responder({ error: "payload_invalido", detail: "Acción no válida." }, 400);
      const { grado, mision } = await reclamarGrado(e, {
        vtuberId: ficha.id,
        misionId: cuerpo.mision,
        gradoActual: ficha.premium?.grade ?? null,
      });
      try {
        await aplicarYAnotar(
          { tipo: "vtuber.editar", id: ficha.id, patch: { premium: { grade: grado } } },
          "mision",
        );
      } catch (error) {
        await soltarReclamo(e, { vtuberId: ficha.id, misionId: mision });
        throw error;
      }
      const fresca = resolver(opciones.db ?? (await dbConDiario()))(ficha.slug) ?? ficha;
      return responder({ ok: true, grado, ficha: await vistaDeFicha(e, fresca) });
    },
  );
}
