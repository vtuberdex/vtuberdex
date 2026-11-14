// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Rutas del mantenedor de producción para la cola de solicitudes (inscripción, modificación, baja) y
 * los grados reclamados con misiones. Las enruta `route.js`; viven aparte porque juntas pasaban de las
 * mil líneas y mezclaban la cola de entrada con la edición del catálogo.
 */
import { NextResponse } from "next/server";

import { guardarAssetDelMantenedor } from "../../../../lib/ediciones.mjs";
import { aplicarYAnotar, dbConDiario } from "../../../../lib/diario.mjs";
import {
  formatIssues,
  vtuberCreateSchema,
  vtuberUpdateSchema,
} from "../../../../server/src/validation.mjs";
import {
  MisionError,
  listarReclamos,
  misionPorId,
  revocarReclamo,
} from "../../../../server/src/misiones.mjs";
import { resumenDeRechazos } from "../../../../server/src/rechazos.mjs";
import { ejecutorDeSolicitudes } from "../../../../lib/solicitudes.mjs";
import {
  SolicitudError,
  fichaDesdeInscripcion,
  leerSolicitud,
  listarSolicitudes,
  resolverSolicitud,
} from "../../../../server/src/solicitudes.mjs";
import {
  aplicarImagenesDeSolicitud,
  imagenesDeSolicitud,
  imagenesParaAplicar,
  purgarCaducadas,
} from "../../../../server/src/imagenes-solicitud.mjs";
import { prepararModificacion } from "../../../../server/src/modificacion.mjs";
import { vistaPrevia } from "../../../../server/src/solicitud-vista.mjs";
import { getVtuberBySlug } from "../../../../server/src/search.mjs";
import { MIME_WEBP, OP_EDITAR, responderError } from "./respuestas.js";

/**
 * `GET /api/admin/solicitudes?estado=&tipo=` — la cola de inscripciones y bajas que llegaron
 * por los formularios públicos. Trae el contacto confidencial: solo se sirve con sesión.
 */
export async function listarSolicitudesRuta(request) {
  const consulta = new URL(request.url).searchParams;
  const estado = consulta.get("estado") ?? "pendiente";
  const tipo = consulta.get("tipo");
  if (
    !["pendiente", "aprobada", "rechazada", "procesada", "todas"].includes(
      estado,
    ) ||
    (tipo && !["inscripcion", "baja", "modificacion"].includes(tipo))
  ) {
    return NextResponse.json({ error: "query_invalida" }, { status: 400 });
  }
  try {
    const ejecutor = await ejecutorDeSolicitudes();
    // Aprovecha la visita para limpiar las imágenes caducadas (no hay un trabajo programado).
    await purgarCaducadas(ejecutor).catch(() => {});
    return NextResponse.json(
      await listarSolicitudes(ejecutor, { estado, tipo }),
    );
  } catch (error) {
    console.error("[admin] no se pudo leer la cola de solicitudes", error);
    return NextResponse.json(
      { error: "solicitudes_no_disponibles", detail: error.message },
      { status: 503 },
    );
  }
}

/**
 * `GET /api/admin/solicitudes/rechazos?dias=7` — qué formulario rechazó qué y por qué campo en los últimos
 * días (sin correos ni contenido): para saber dónde se atasca la gente.
 */
export async function rechazosRuta(request) {
  const dias = Math.min(
    30,
    Math.max(1, Number(new URL(request.url).searchParams.get("dias")) || 7),
  );
  try {
    return NextResponse.json(
      await resumenDeRechazos(await ejecutorDeSolicitudes(), { dias }),
    );
  } catch (error) {
    console.error("[admin] no se pudo leer el resumen de rechazos", error);
    return NextResponse.json(
      { error: "solicitudes_no_disponibles", detail: error.message },
      { status: 503 },
    );
  }
}

/**
 * `GET /api/admin/misiones/reclamos` — los grados que la gente reclamó con misiones de Minecraft: quién, cuál, el grado
 * que tenía antes y el que lleva hoy (por si una donación lo subió después). Es lo que permite revisar abusos.
 */
export async function reclamosDeMisionesRuta() {
  try {
    const db = await dbConDiario();
    const filas = await listarReclamos(await ejecutorDeSolicitudes());
    const items = filas.map((f) => {
      const ficha = db
        .prepare("SELECT slug, name FROM vtuber WHERE id = ?")
        .get(f.vtuberId);
      let actual = null;
      try {
        actual =
          db
            .prepare("SELECT grade FROM premium WHERE vtuber_id = ?")
            .get(f.vtuberId)?.grade ?? null;
      } catch {
        /* una base anterior al premium no tiene la tabla */
      }
      return {
        ...f,
        mision: misionPorId(f.misionId)?.nombre ?? f.misionId,
        slug: ficha?.slug ?? null,
        name: ficha?.name ?? `#${f.vtuberId}`,
        gradoActual: actual,
      };
    });
    return NextResponse.json(
      { items },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error(
      "[admin] no se pudieron leer los reclamos de misiones",
      error,
    );
    return NextResponse.json(
      { error: "misiones_no_disponibles", detail: error.message },
      { status: 503 },
    );
  }
}

/**
 * `POST /api/admin/misiones/reclamos/:vtuberId/:mision/revocar` — quita un grado reclamado con misiones y devuelve la carta
 * al grado que tenía antes (o a carta normal). Si la carta ya no lleva ese grado (una donación la subió) NO se toca: solo
 * queda revocado el reclamo. La misión sigue reclamada, así que no se puede volver a reclamar.
 */
export async function revocarReclamoRuta(vtuberId, misionId, usuario) {
  const id = Number(vtuberId);
  if (!Number.isInteger(id) || !misionPorId(misionId)) {
    return NextResponse.json({ error: "query_invalida" }, { status: 400 });
  }
  try {
    const { grado, gradoPrevio } = await revocarReclamo(
      await ejecutorDeSolicitudes(),
      { vtuberId: id, misionId },
    );
    let actual = null;
    try {
      actual =
        (await dbConDiario())
          .prepare("SELECT grade FROM premium WHERE vtuber_id = ?")
          .get(id)?.grade ?? null;
    } catch {
      /* sin tabla premium */
    }
    const quitada = actual === grado;
    if (quitada) {
      await aplicarYAnotar(
        {
          tipo: OP_EDITAR,
          id,
          patch: {
            premium: gradoPrevio === null ? null : { grade: gradoPrevio },
          },
        },
        usuario,
      );
    }
    return NextResponse.json({
      ok: true,
      grado,
      gradoPrevio,
      cartaModificada: quitada,
    });
  } catch (error) {
    if (error instanceof MisionError) {
      return NextResponse.json(
        { error: error.code, detail: error.detail },
        { status: error.status },
      );
    }
    return responderError(error);
  }
}

/** Lo que el mantenedor puede escribir como dirección de una ficha: letras, números y guiones. */
const SLUG_DE_FICHA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `GET /api/admin/solicitudes/:id/vista-previa?ficha=<slug>` — qué pasaría al aprobar, SIN escribir nada: si se
 * puede, qué cambia (antes → después), a qué ficha afecta y, si la ficha no se encontró, candidatas para elegir.
 * `ficha` elige a mano la ficha de una modificación (la misma que luego se manda al aprobar).
 */
export async function vistaPreviaRuta(request, id) {
  const fichaSlug = new URL(request.url).searchParams.get("ficha");
  if (fichaSlug !== null && !SLUG_DE_FICHA.test(fichaSlug)) {
    return NextResponse.json({ error: "query_invalida" }, { status: 400 });
  }
  try {
    const solicitud = await leerSolicitud(await ejecutorDeSolicitudes(), id);
    if (!solicitud) {
      return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
    }
    return NextResponse.json(
      vistaPrevia(await dbConDiario(), solicitud, { fichaSlug }),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return responderError(error);
  }
}

/**
 * `GET /api/admin/solicitudes/:id/imagenes` — qué imágenes subió la persona con el formulario (sin bytes).
 * `GET /api/admin/solicitudes/:id/imagen/:tipo` — los bytes de una, para verla antes de aprobar.
 * Solo el mantenedor: no son públicas.
 */
export async function imagenesDeSolicitudRuta(id) {
  try {
    return NextResponse.json({
      imagenes: await imagenesDeSolicitud(await ejecutorDeSolicitudes(), id),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "solicitudes_no_disponibles", detail: error.message },
      { status: 503 },
    );
  }
}

export async function imagenDeSolicitudRuta(id, tipo) {
  try {
    const imagen = (
      await imagenesParaAplicar(await ejecutorDeSolicitudes(), id)
    ).find((i) => i.tipo === tipo);
    if (!imagen) {
      return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
    }
    return new NextResponse(imagen.bytes, {
      headers: {
        "content-type": MIME_WEBP,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "solicitudes_no_disponibles", detail: error.message },
      { status: 503 },
    );
  }
}

/** Estado en que queda la solicitud según la acción del mantenedor. */
const ESTADO_DE_ACCION = {
  aprobar: "aprobada",
  procesar: "procesada",
  rechazar: "rechazada",
};

/** Respuesta 400 con los fallos de validación de un esquema de zod. */
function payloadInvalido(error) {
  return NextResponse.json(
    { error: "payload_invalido", issues: formatIssues(error) },
    { status: 400 },
  );
}

/**
 * La ficha que el mantenedor ELIGIÓ a mano para una modificación (cuando lo escrito en el formulario
 * no se resolvía solo). `{ ficha: null }` si no eligió ninguna; `{ respuesta }` si la elegida no existe.
 */
function fichaElegida(db, fichaSlug) {
  if (typeof fichaSlug !== "string" || !fichaSlug) {
    return { ficha: null };
  }
  const ficha = SLUG_DE_FICHA.test(fichaSlug)
    ? getVtuberBySlug(db, fichaSlug, { includeHidden: true })
    : null;
  if (ficha) {
    return { ficha };
  }
  return {
    respuesta: NextResponse.json(
      { error: "ficha_no_encontrada", detail: "la ficha elegida no existe" },
      { status: 404 },
    ),
  };
}

/**
 * Aprueba una modificación: aplica el parche a la ficha EXISTENTE (`vtuber.editar` del diario).
 * Devuelve `{ vtuberSlug }` o `{ respuesta }` si algo impide aprobar.
 */
async function aprobarModificacion(solicitud, fichaSlug, usuario) {
  // Avatar y logo (enlaces) los sube el mantenedor aparte. La ficha se lee del diario ya
  // reproducido, no de la base empaquetada.
  const db = await dbConDiario();
  const { ficha: elegida, respuesta } = fichaElegida(db, fichaSlug);
  if (respuesta) {
    return { respuesta };
  }
  const {
    id: fichaId,
    slug,
    patch,
  } = prepararModificacion(db, solicitud, { ficha: elegida });
  const datos = vtuberUpdateSchema.safeParse(patch);
  if (!datos.success) {
    return { respuesta: payloadInvalido(datos.error) };
  }
  if (!Object.keys(datos.data).length) {
    return { vtuberSlug: slug };
  }
  const { resultado } = await aplicarYAnotar(
    { tipo: OP_EDITAR, id: fichaId, patch: datos.data },
    usuario.username,
  );
  return { vtuberSlug: resultado.slug };
}

/** Aprueba una inscripción: crea la ficha en BORRADOR (`vtuber.crear`). `{ vtuberSlug }` o `{ respuesta }`. */
async function aprobarInscripcion(solicitud, usuario) {
  if (solicitud.tipo !== "inscripcion") {
    return {
      respuesta: NextResponse.json(
        {
          error: "estado_invalido",
          detail: "solo se aprueban inscripciones y modificaciones",
        },
        { status: 400 },
      ),
    };
  }
  const datos = vtuberCreateSchema.safeParse(fichaDesdeInscripcion(solicitud));
  if (!datos.success) {
    return { respuesta: payloadInvalido(datos.error) };
  }
  const { resultado } = await aplicarYAnotar(
    { tipo: "vtuber.crear", datos: datos.data },
    usuario.username,
  );
  return { vtuberSlug: resultado.slug };
}

/**
 * Aprobada: las imágenes subidas pasan a ser las de la ficha (fila de Turso con origen `mantenedor`, como
 * las que sube el mantenedor a mano). Si alguna falla la aprobación sigue en pie y se informa cuál.
 */
function aplicarImagenesAprobadas(ejecutor, id, vtuberSlug) {
  return aplicarImagenesDeSolicitud(
    ejecutor,
    id,
    async ({ tipo, bytes, ancho, alto }) => {
      const guardada = await guardarAssetDelMantenedor(
        vtuberSlug,
        tipo,
        bytes,
        MIME_WEBP,
        { width: ancho, height: alto },
      );
      if (!guardada) {
        throw new Error("el almacén de imágenes no está disponible");
      }
    },
  );
}

/** Aplica la acción a una solicitud pendiente y responde con la solicitud resuelta. */
async function resolverPendiente(
  ejecutor,
  solicitud,
  { id, accion, nota, fichaSlug },
  usuario,
) {
  let vtuberSlug = null;
  if (accion === "aprobar") {
    const aprobada =
      solicitud.tipo === "modificacion"
        ? await aprobarModificacion(solicitud, fichaSlug, usuario)
        : await aprobarInscripcion(solicitud, usuario);
    if (aprobada.respuesta) {
      return aprobada.respuesta;
    }
    vtuberSlug = aprobada.vtuberSlug;
  }
  const estado = ESTADO_DE_ACCION[accion];
  const resuelta = await resolverSolicitud(ejecutor, id, {
    estado,
    actor: usuario.username,
    nota,
    vtuberSlug,
  });
  let imagenes = { aplicadas: [], fallidas: [] };
  if (estado === "aprobada" && vtuberSlug) {
    imagenes = await aplicarImagenesAprobadas(ejecutor, id, vtuberSlug);
  }
  return NextResponse.json({ solicitud: resuelta, imagenes });
}

/**
 * `POST /api/admin/solicitudes/:id/resolver` con `{ accion, nota?, fichaSlug? }` (`fichaSlug`: la ficha elegida a mano en una modificación).
 *
 *   · `aprobar`  (inscripción): crea la ficha en BORRADOR por el mismo camino que «Nueva carta»
 *     (`vtuber.crear` del diario) y cierra la solicitud. Si la ficha no se puede crear (URL
 *     repetida, país desconocido…) la solicitud sigue pendiente y el error llega tal cual.
 *   · `aprobar`  (modificación): aplica los cambios a la ficha existente (`vtuber.editar`); el avatar y
 *     el logo, que llegan como enlace, los sube el mantenedor por el gestor de imágenes.
 *   · `rechazar` (todas) y `procesar` (baja): cierran la solicitud. La baja NO borra nada: qué
 *     se hace con la ficha lo decide el mantenedor aparte, según la cláusula de salida.
 */
export async function resolverSolicitudRuta(request, id, usuario) {
  const cuerpo = await request.json().catch(() => null);
  const accion = cuerpo?.accion;
  if (!Object.keys(ESTADO_DE_ACCION).includes(accion)) {
    return NextResponse.json(
      {
        error: "payload_invalido",
        detail: "accion: aprobar | rechazar | procesar",
      },
      { status: 400 },
    );
  }
  const nota = typeof cuerpo?.nota === "string" ? cuerpo.nota : "";
  try {
    const ejecutor = await ejecutorDeSolicitudes();
    const solicitud = await leerSolicitud(ejecutor, id);
    if (!solicitud) {
      return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
    }
    if (solicitud.estado !== "pendiente") {
      return NextResponse.json(
        { error: "ya_resuelta", detail: "esta solicitud ya fue resuelta" },
        { status: 409 },
      );
    }
    return await resolverPendiente(
      ejecutor,
      solicitud,
      { id, accion, nota, fichaSlug: cuerpo?.fichaSlug },
      usuario,
    );
  } catch (error) {
    if (error instanceof SolicitudError) {
      return NextResponse.json(
        { error: error.code, detail: error.detail },
        { status: error.status },
      );
    }
    return responderError(error);
  }
}
