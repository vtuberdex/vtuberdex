// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Rutas del mantenedor.
 *
 * DOS MODOS, según quién pueda escribir de verdad:
 *
 *   · **LOCAL** (`VTUBERDEX_ADMIN_URL`): se reenvía al servidor Express, que es el
 *     único que escribe sobre el SQLite de `data/` —subida de imágenes con `sharp`,
 *     cuerpo de 12 MB, auditoría—. Es como se ha trabajado siempre y no cambia.
 *   · **PRODUCCIÓN (Vercel)** (`VTUBERDEX_DB_URL`): el sistema de archivos es
 *     inmutable y la base viaja empaquetada, así que aquí NO se puede escribir en
 *     SQLite. Las ediciones y las imágenes van a Turso (`lib/ediciones.mjs`), y el
 *     catálogo se sigue leyendo del bundle. No es una degradación: es el único modo que
 *     puede funcionar sin sistema de archivos.
 *
 * POR QUÉ ESTE ARCHIVO CAMBIÓ
 * ---------------------------
 * Antes devolvía **404** en producción, porque el mantenedor "no existía" allí. Eso
 * dejaba el sitio publicado sin forma de corregir una ficha ni de cambiar una imagen.
 * Ahora responde de verdad cuando hay Turso configurado, y sigue devolviendo 404 cuando
 * no lo hay (ni proxy local ni Turso) — el mismo 404 explícito comprobado por
 * `npm run verify`, que sigue siendo el comportamiento correcto al no haber ningún
 * backend de escritura.
 *
 * El modo NO se elige por `NODE_ENV` sino por lo que esté configurado: así el mismo
 * build puede correr en local (proxy al Express) y en Vercel (Turso) sin ramas ocultas.
 */
import { NextResponse } from "next/server";

import {
  aplicarImagenesDelMantenedor,
  aplicarReemplazosALista,
  borrarAssetDelMantenedor,
  guardarAssetDelMantenedor,
  leerAssetDelMantenedor,
  renombrarAssetsDelMantenedor,
  reemplazosDelMantenedor,
  tursoConfigurado,
} from "../../../../lib/ediciones.mjs";
import { aplicarYAnotar, dbConDiario } from "../../../../lib/diario.mjs";
import {
  KINDS_GESTIONABLES,
  EXTENSION_DE_CARPETA,
} from "../../../../lib/carpetas.mjs";
import {
  cerrarSesion,
  credencialesConfiguradas,
  diagnosticarCredenciales,
  emitirSesion,
  formatoDeHash,
  leerSesion,
  tokenDeCabecera,
  usuarioEsperado,
} from "../../../../lib/admin-auth.mjs";
import {
  entrarConEnlace,
  pedirEnlaceDeAcceso,
} from "../../../../lib/admin-enlace.mjs";
import { ipDelCliente, origenPermitido } from "../../../../lib/likes.mjs";
import {
  adminListQuerySchema,
  bulkStatusSchema,
  formatIssues,
  fichaCorreoSchema,
  vtuberCreateSchema,
  vtuberUpdateSchema,
} from "../../../../server/src/validation.mjs";
import { ultimoDex } from "../../../../server/src/mutations.mjs";
import { ejecutorDeSolicitudes } from "../../../../lib/solicitudes.mjs";
import { correoDeBienvenida, enviarCorreo } from "../../../../lib/correo.mjs";
import {
  SolicitudError,
  correosDeFichas,
  fijarCorreoDeFicha,
} from "../../../../server/src/solicitudes.mjs";
import { listarConCorreo } from "../../../../server/src/correo-fichas.mjs";
import { estadisticasDelMantenedor } from "../../../../server/src/estadisticas-admin.mjs";
import { getVtuberBySlug } from "../../../../server/src/search.mjs";
import { readWebpSize } from "../../../../server/src/seed.mjs";

import { MIME_WEBP, OP_EDITAR, responderError } from "./respuestas.js";
import {
  imagenDeSolicitudRuta,
  imagenesDeSolicitudRuta,
  listarSolicitudesRuta,
  rechazosRuta,
  reclamosDeMisionesRuta,
  resolverSolicitudRuta,
  revocarReclamoRuta,
  vistaPreviaRuta,
} from "./solicitudes-rutas.js";
import {
  crearFaccionRuta,
  editarFaccionRuta,
  eliminarFaccionRuta,
  listaDeFacciones,
  subirEmblema,
} from "./facciones-rutas.js";

export const dynamic = "force-dynamic";

/** Servidor de escritura para desarrollo; en producción no existe. */
const ADMIN_UPSTREAM = process.env.VTUBERDEX_ADMIN_URL ?? null;

const noDisponible = (detail) =>
  NextResponse.json({ error: "no_encontrado", detail }, { status: 404 });

const noAutenticado = () =>
  NextResponse.json({ error: "no_autenticado" }, { status: 401 });

/**
 * Exige sesión válida y devuelve el usuario, o una respuesta 401.
 *
 * Todas las rutas de ESCRITURA pasan por aquí. Sin esta comprobación el mantenedor de
 * producción estaba abierto: cualquiera con la URL podía editar fichas y subir imágenes.
 * Se devuelve `[usuario, null]` si va bien y `[null, respuesta]` si no, para que el llamante
 * pueda hacer `if (respuesta) return respuesta;`.
 */
async function exigirSesion(request) {
  const token = tokenDeCabecera(request);
  const user = await leerSesion(token);
  if (!user) {
    return [null, noAutenticado()];
  }
  return [user, null];
}

/**
 * El detalle de una ficha tal como lo ve el mantenedor, listo para devolverlo.
 *
 * POR QUÉ DEVOLVER EL DETALLE Y NO `{ok:true}`
 * -------------------------------------------
 * El cliente hace `setSelected(respuesta)` con el resultado de cada escritura y vuelve a
 * dibujar la página desde ese objeto (`components/admin-page.tsx`). Devolver un acuse no da
 * error, pero deja la ficha con campos en `undefined`: el formulario aparecía vacío tras guardar
 * y el gestor de imágenes pintaba "sin imagen" con la imagen ya guardada. El Express devuelve el
 * detalle desde siempre, así que este es el contrato al que hay que igualarse.
 *
 * `db` es la base CON el diario aplicado (`dbConDiario`), así que ya trae las ediciones, y
 * `includeHidden: true` porque el mantenedor trabaja con borradores y fichas ocultas. Lo único
 * que se superpone es lo que vive fuera de SQLite: los bytes de las imágenes en Turso.
 */
async function detalleConReemplazos(db, slug) {
  const detalle = getVtuberBySlug(db, slug, { includeHidden: true });
  if (!detalle) {
    return null;
  }
  return aplicarImagenesDelMantenedor(
    detalle,
    await reemplazosDelMantenedor(detalle.slug),
  );
}

/** Ficha por id sobre la base materializada, o `null`. */
function fichaPorId(db, id) {
  return (
    db.prepare("SELECT id, slug FROM vtuber WHERE id = ?").get(Number(id)) ??
    null
  );
}

/** Reenvía al Express local (comportamiento de siempre, sin cambios). */
async function reenviar(request, context, method) {
  const { path } = await context.params;
  const suffix = Array.isArray(path) ? path.join("/") : (path ?? "");
  const url = `${ADMIN_UPSTREAM.replace(/\/$/, "")}/api/admin/${suffix}${new URL(request.url).search}`;
  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        // Los headers se COPIAN uno a uno: reemplazarlos por un objeto nuevo
        // borraría el `content-type` y el servidor respondería "payload inválido".
        ...Object.fromEntries(request.headers),
        host: new URL(ADMIN_UPSTREAM).host,
      },
      body: method === "GET" ? undefined : await request.arrayBuffer(),
    });
  } catch (error) {
    // El mantenedor está configurado pero no responde (ECONNREFUSED: se levantó
    // solo Next, o el contenedor del admin se cayó). Sin este `catch`, el
    // `fetch` lanzaba y la ruta devolvía **500** en vez del 404 documentado.
    return noDisponible(
      `el mantenedor no responde en ${ADMIN_UPSTREAM}: ${error.message}`,
    );
  }
  return new NextResponse(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

/**
 * `POST /api/admin/login` — entra al mantenedor en producción.
 *
 * La UI del mantenedor EXIGE esto antes de cualquier otra llamada (pide `/api/admin/login`
 * y guarda el token en `localStorage`). Sin esta ruta la página cargaba y se quedaba muerta:
 * medido en producción, `/admin` respondía 200 y no hacía ni una llamada a la API.
 */
async function login(request) {
  if (!credencialesConfiguradas()) {
    return NextResponse.json(
      {
        error: "sin_credenciales",
        detail:
          "falta VTUBERDEX_ADMIN_PASSWORD_HASH: genera el hash con `node scripts/admin-hash.mjs`",
      },
      { status: 500 },
    );
  }
  const body = await request.json().catch(() => null);
  const { ok, usuarioOk, claveOk } = diagnosticarCredenciales(
    body?.username,
    body?.password,
  );
  if (!ok) {
    /**
     * 401 CON DIAGNÓSTICO, no un 401 mudo.
     *
     * Antes esta respuesta era siempre `{error:'credenciales_invalidas'}`, así que tres causas
     * totalmente distintas quedaban indistinguibles desde fuera: (a) el usuario no es el
     * esperado, (b) la contraseña no es la del hash guardado y (c) el hash guardado se pegó
     * mal. Medido en producción: la (a) —el campo de usuario— se veía EXACTAMENTE igual que
     * las otras dos, y no había forma de averiguar cuál era sin volver a tocar la variable a
     * ciegas. La contraseña nunca viaja en la respuesta; el usuario esperado sí puede, porque
     * no es el secreto (vive en `admin-hash.mjs`, aquí y en la documentación).
     *
     * `formatoDeHash` devuelve solo la ESTRUCTURA del valor (segmentos, hexadecimal, tamaño),
     * nunca su contenido ni sus longitudes exactas, así que se puede adjuntar a la respuesta
     * de una ruta sin sesión sin filtrar nada de la credencial.
     */
    const hash = !credencialesConfiguradas()
      ? { valido: false, problemas: ["falta VTUBERDEX_ADMIN_PASSWORD_HASH"] }
      : formatoDeHash();
    return NextResponse.json(
      {
        error: "credenciales_invalidas",
        usuarioOk,
        claveOk,
        usuarioEsperado: usuarioEsperado(),
        hash,
      },
      { status: 401 },
    );
  }
  const user = { id: 0, username: usuarioEsperado(), role: "admin" };
  const token = await emitirSesion(user);
  if (!token) {
    return noDisponible("no se pudo emitir la sesión (¿Turso configurado?)");
  }
  return NextResponse.json({
    token,
    user: { username: user.username, role: user.role },
  });
}

/**
 * `POST /api/admin/enlace` (pide el enlace por correo) y `POST /api/admin/enlace/entrar` (lo gasta).
 *
 * Son sin sesión por definición: son las que la crean. Pedir el enlace responde siempre lo mismo
 * para cualquier correo bien formado (ver `lib/admin-enlace.mjs`).
 */
async function enlaceDeAcceso(request, accion) {
  const cabeceras = { "cache-control": "no-store" };
  if (!origenPermitido(request.headers)) {
    return NextResponse.json(
      { error: "origen_no_permitido" },
      { status: 403, headers: cabeceras },
    );
  }
  const cuerpo = await request.json().catch(() => null);
  try {
    const token = typeof cuerpo?.token === "string" ? cuerpo.token : "";
    const { status, cuerpo: respuesta } =
      accion === "entrar"
        ? await entrarConEnlace(token)
        : await pedirEnlaceDeAcceso({
            email: cuerpo?.email,
            ip: ipDelCliente(request.headers),
          });
    return NextResponse.json(respuesta, { status, headers: cabeceras });
  } catch (error) {
    console.error(`[admin] enlace de acceso: ${error.message}`);
    return NextResponse.json(
      {
        error: "no_disponible",
        detail: "No se pudo procesar. Inténtalo de nuevo.",
      },
      { status: 503, headers: cabeceras },
    );
  }
}

/**
 * `GET /api/admin/session` — valida el token que la UI guardó en `localStorage`.
 *
 * Con login configurado, un token inválido es un 401 y la UI borra el token y pide entrar de
 * nuevo. Sin login configurado se responde el modo SIN autenticar, para que la página pueda
 * decir qué falta en vez de mostrar un formulario que nunca va a funcionar por más que se
 * escriba la contraseña correcta.
 */
async function sesionTurso(request) {
  if (!credencialesConfiguradas()) {
    return NextResponse.json({
      mode: "turso",
      login: false,
      note: "falta VTUBERDEX_ADMIN_PASSWORD_HASH: define la contraseña con `node scripts/admin-hash.mjs`",
    });
  }
  const user = await leerSesion(tokenDeCabecera(request));
  if (!user) {
    return noAutenticado();
  }
  return NextResponse.json({
    mode: "turso",
    login: true,
    user: { username: user.username, role: user.role },
  });
}

/**
 * `POST /api/admin/logout` — cierra la sesión de verdad (la fila se borra de Turso).
 *
 * Importa que borre de la base y no solo del navegador: si el token siguiera vivo, valdría
 * para cualquiera que lo hubiera copiado durante sus 8 horas de vida.
 */
async function logout(request) {
  await cerrarSesion(tokenDeCabecera(request));
  return NextResponse.json({ ok: true });
}

/**
 * `GET /api/admin/stats` — los datos del panel (totales, estados, calidad, países, facciones,
 * grados, correos y solicitudes pendientes).
 *
 * Se calcula con `estadisticasDelMantenedor` (la MISMA función que el Express) sobre la base con
 * el diario aplicado, para que los totales no contradigan la lista que el mantenedor
 * muestra al lado: si alguien despublica una ficha, `notPublished` tiene que subir.
 *
 * `audit` no se calcula: el registro de auditoría vive en `audit_log`, que en la base
 * desplegada va VACÍO a propósito (lleva el hash de la contraseña y se sanea con VACUUM). Se
 * devuelve una lista vacía en vez de un 404 para que la pestaña de auditoría de la UI
 * muestre "sin registros" y no un error.
 */
async function estadisticas() {
  const db = await dbConDiario();
  let ejecutor = null;
  try {
    ejecutor = await ejecutorDeSolicitudes();
  } catch (error) {
    console.error(
      "[admin] sin cola de solicitudes: las estadísticas salen sin correos ni pendientes",
      error,
    );
  }
  return NextResponse.json(await estadisticasDelMantenedor(db, ejecutor), {
    headers: { "cache-control": "no-store" },
  });
}

/**
 * (`GET /api/admin/vtubers` se retiró.)
 *
 * Existía para que el mantenedor listara las fichas con sus marcas de edición, pero la UI
 * usa `api.list()` —el endpoint PÚBLICO—, ya que solo necesita id, nombre y estado. Con
 * login de por medio, además, esto obligaba a autenticar una ruta que nadie llamaba. Se
 * quitó con su único consumidor (`leerAssetsRemotos` en `lib/ediciones.mjs`).
 */

/**
 * `PATCH /api/admin/vtubers/:id` — edita una ficha: se anota en el diario de Turso.
 *
 * Se valida con `vtuberUpdateSchema`, el MISMO esquema que usa el Express, y se aplica con las
 * MISMAS funciones (`server/src/mutations.mjs`): si la validación o las reglas fueran otras, una
 * edición aceptada en local podría ser rechazada en producción y el mantenedor tendría dos
 * comportamientos. Las reglas (número libre, URL única, máximo dos facciones…) las hace cumplir
 * `aplicarYAnotar` ANTES de escribir nada.
 */
async function editarVtuber(request, id, usuario) {
  const body = await request.json().catch(() => null);
  const parsed = vtuberUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload_invalido", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "sin_cambios" }, { status: 400 });
  }
  try {
    const db = await dbConDiario();
    const actual = fichaPorId(db, id);
    if (!actual) {
      return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
    }
    const { db: dbNueva, resultado } = await aplicarYAnotar(
      { tipo: OP_EDITAR, id: actual.id, patch: parsed.data },
      usuario.username,
    );
    // Los reemplazos de imagen del mantenedor se guardan por slug: al cambiar la URL se mudan
    // con la ficha, o la imagen subida dejaría de verse.
    if (resultado.slug !== actual.slug) {
      await renombrarAssetsDelMantenedor(actual.slug, resultado.slug);
    }
    return NextResponse.json(
      await detalleConReemplazos(dbNueva, resultado.slug),
    );
  } catch (error) {
    return responderError(error);
  }
}

/** `POST /api/admin/vtubers` — crea una carta nueva (nace en borrador, al final de la dex). */
async function crearVtuber(request, usuario) {
  const body = await request.json().catch(() => null);
  const parsed = vtuberCreateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload_invalido", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  try {
    const { db, resultado } = await aplicarYAnotar(
      { tipo: "vtuber.crear", datos: parsed.data },
      usuario.username,
    );
    return NextResponse.json(await detalleConReemplazos(db, resultado.slug), {
      status: 201,
    });
  } catch (error) {
    return responderError(error);
  }
}

/** `GET /api/admin/vtubers` — listado del mantenedor: incluye borradores y ocultos. */
async function listarVtubers(request) {
  const parsed = adminListQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "query_invalida", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  const { q, status, premium, correo, page, perPage } = parsed.data;
  const db = await dbConDiario();
  let ejecutor = null;
  try {
    ejecutor = await ejecutorDeSolicitudes();
  } catch (error) {
    console.error(
      "[admin] sin cola de solicitudes: el listado sale sin datos de correo",
      error,
    );
  }
  if (correo && !ejecutor) {
    return NextResponse.json(
      { error: "solicitudes_no_disponibles" },
      { status: 503 },
    );
  }
  const resultado = await listarConCorreo(db, ejecutor, {
    q,
    correo,
    page,
    perPage,
    includeHidden: true,
    status: status === "all" ? null : status,
    premium: premium ? "todas" : false,
    sort: "dex",
  });
  return NextResponse.json({
    ...resultado,
    items: await aplicarReemplazosALista(resultado.items),
  });
}

/** `GET /api/admin/vtubers/:id` — detalle sin filtrar por estado: es lo que abre el editor. */
async function detalleVtuber(id) {
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  const detalle = actual ? await detalleConReemplazos(db, actual.slug) : null;
  if (!detalle) {
    return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  }
  // El correo va SOLO en el detalle del mantenedor; sin cola no tumba la ficha.
  let email = null;
  try {
    const correos = await correosDeFichas(await ejecutorDeSolicitudes(), {
      resolverFicha: (slug) =>
        getVtuberBySlug(db, slug, { includeHidden: true }),
    });
    email = correos.get(actual.id) ?? null;
  } catch (error) {
    console.error("[admin] no se pudo leer el correo de la ficha", error);
  }
  return NextResponse.json({ ...detalle, email });
}

/** `PUT /api/admin/vtubers/:id/correo` — fija o quita el correo de una ficha (vive en la cola, no en el diario). */
async function fijarCorreo(request, id) {
  const parsed = fichaCorreoSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload_invalido", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  if (!actual) {
    return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  }
  try {
    const ejecutor = await ejecutorDeSolicitudes();
    const resolverFicha = (slug) =>
      getVtuberBySlug(db, slug, { includeHidden: true });
    const anterior =
      (await correosDeFichas(ejecutor, { resolverFicha })).get(actual.id) ??
      null;
    const email = await fijarCorreoDeFicha(
      ejecutor,
      actual.id,
      parsed.data.email,
    );
    // Bienvenida solo si el correo es NUEVO para la ficha (guardar el mismo otra vez no reenvía). Si el
    // envío falla el correo ya quedó guardado: se avisa en la respuesta en vez de deshacer el cambio.
    let bienvenida = "no";
    if (email && email !== anterior) {
      try {
        const ficha = resolverFicha(actual.slug);
        const { asunto, texto, html } = correoDeBienvenida({
          nombre: ficha?.name,
          slug: actual.slug,
        });
        await enviarCorreo({ para: email, asunto, texto, html });
        bienvenida = "enviada";
      } catch (error) {
        console.error(
          `[admin] no se pudo enviar la bienvenida a la ficha ${actual.slug}: ${error.message}`,
        );
        bienvenida = "fallo";
      }
    }
    return NextResponse.json({ email, bienvenida });
  } catch (error) {
    if (error instanceof SolicitudError) {
      return NextResponse.json(
        { error: error.code, detail: error.detail },
        { status: error.status },
      );
    }
    console.error("[admin] no se pudo guardar el correo", error);
    return NextResponse.json(
      { error: "solicitudes_no_disponibles", detail: error.message },
      { status: 503 },
    );
  }
}

/** `GET /api/admin/dex/next` — el siguiente número libre al final de la dex. */
async function siguienteDex() {
  const db = await dbConDiario();
  return NextResponse.json({ next: ultimoDex(db) + 1 });
}

/**
 * `POST /api/admin/vtubers/:id/image/:kind` — guarda los bytes de una imagen en Turso.
 *
 * El tipo se valida **por contenido**, no por extensión ni `Content-Type`: es la misma
 * regla que el Express aplica con `sharp`, y por la misma razón (una extensión .webp no
 * garantiza que lo sea). Aquí se comprueba la FIRMA del contenedor WebP, que es lo que
 * hace falta para no guardar basura en la base; no se recomprime porque `sharp` es un
 * binario nativo que no queremos arrastrar a la función.
 */
async function subirImagen(request, id, kind) {
  /**
   * Los tipos se validan contra la MISMA lista que usa el cliente (`lib/carpetas.mjs`): si
   * divergieran, el mantenedor ofrecería un tipo que el servidor rechaza (o al revés) y el
   * usuario vería un 400 sin haber hecho nada raro.
   */
  if (!KINDS_GESTIONABLES.includes(kind)) {
    return NextResponse.json(
      {
        error: "kind_invalido",
        detail: `use: ${KINDS_GESTIONABLES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  if (!actual) {
    return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  }

  const bytes = Buffer.from(await request.arrayBuffer());
  // Firma de WebP: "RIFF" + 4 bytes de tamaño + "WEBP". Es el contenedor que usan las
  // carpetas publicadas, así que no hace falta aceptar nada más.
  const esWebp =
    bytes.length > 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP";
  if (!esWebp) {
    return NextResponse.json(
      { error: "formato_invalido", detail: "se esperaba WebP (RIFF/WEBP)" },
      { status: 400 },
    );
  }

  /**
   * Se guarda con origen `mantenedor`: fila PROPIA, distinta de la imagen publicada del
   * catálogo. Antes esto escribía sobre la misma fila `(slug, kind)` que el publicador,
   * así que subir una imagen DESTRUÍA la única copia del original y ya no había forma de
   * volver a ella. Ver `lib/ediciones.mjs`.
   *
   * Las dimensiones se leen de la CABECERA del WebP (`readWebpSize`, ya existente en
   * `server/src/seed.mjs`, JS puro). Aquí no se puede usar `sharp` —binario nativo que no viaja
   * a la función— y sin dimensiones el gestor las lee como `null` y pinta "sin imagen" sobre
   * una imagen que sí está guardada: el síntoma que confundía al mantenedor.
   */
  const medidas = readWebpSize(bytes);
  await guardarAssetDelMantenedor(
    actual.slug,
    kind,
    bytes,
    MIME_WEBP,
    medidas,
  );

  /**
   * Se devuelve el MISMO contrato que el Express: `{ok, kind, asset, vtuber}`.
   *
   * El cliente (`lib/api.ts`) desestructura `result.asset` —para el aviso "reemplazado por un
   * WebP de WxH"— y `result.vtuber`, que pasa a ser la ficha seleccionada. Devolver solo
   * `{ok, slug, kind, size}` dejaba `result.vtuber` en `undefined` y el `setSelected(undefined)`
   * siguiente rompía el renderizado: la página se quedaba en blanco justo al subir la imagen.
   *
   * Las dimensiones salen de la fila que se acaba de escribir, no de decodificar los bytes:
   * esta función no lleva `sharp` (es un binario nativo que no viaja a la función) y el
   * cliente ya normaliza el encuadre antes de mandar el archivo.
   */
  const fila = await leerAssetDelMantenedor(actual.slug, kind);
  const ext = EXTENSION_DE_CARPETA[kind] ?? "webp";
  const asset = {
    path: `images/${kind}/${actual.slug}.${ext}`,
    width: fila?.width ?? null,
    height: fila?.height ?? null,
    bytes: bytes.length,
    format: "webp",
    hasAlpha: false,
    alphaLost: false,
  };
  const vtuber = await detalleConReemplazos(db, actual.slug);
  return NextResponse.json({ ok: true, kind, asset, vtuber });
}

/** `DELETE /api/admin/vtubers/:id/image/:kind` — vuelve a la imagen del catálogo. */
async function borrarImagen(id, kind) {
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  if (!actual) {
    return NextResponse.json({ error: "no_encontrado" }, { status: 404 });
  }
  if (!KINDS_GESTIONABLES.includes(kind)) {
    return NextResponse.json(
      {
        error: "kind_invalido",
        detail: `use: ${KINDS_GESTIONABLES.join(", ")}`,
      },
      { status: 400 },
    );
  }
  // Solo se borra el reemplazo del mantenedor; el asset del catálogo no se toca nunca.
  const habia = await borrarAssetDelMantenedor(actual.slug, kind);
  /**
   * El detalle actualizado, igual que en la subida: el cliente hace `setSelected(result.vtuber)`.
   * Tras borrar, el tipo vuelve a mostrar la imagen del catálogo —o "sin imagen" si el tipo no
   * existía—, y eso solo se ve si la respuesta trae el detalle ya recalculado.
   */
  const vtuber = await detalleConReemplazos(db, actual.slug);
  return NextResponse.json({
    ok: true,
    slug: actual.slug,
    kind,
    restaurado: habia ? "catalogo" : "no_habia_reemplazo",
    vtuber,
  });
}

/**
 * `POST /api/admin/vtubers/bulk-status` — cambia el estado de varias fichas.
 *
 * Es UNA operación del diario (no N): se aplica en una transacción y se anota con una sola
 * escritura a Turso.
 */
async function estadoMasivo(request, usuario) {
  const parsed = bulkStatusSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "payload_invalido", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  try {
    const { ids, status } = parsed.data;
    const { resultado } = await aplicarYAnotar(
      { tipo: "vtuber.estado", ids, status },
      usuario.username,
    );
    return NextResponse.json({ updated: resultado.ids.length, status });
  } catch (error) {
    return responderError(error);
  }
}


/** Respuesta común cuando no hay ningún backend de escritura. */
function sinBackend() {
  return noDisponible(
    "el mantenedor solo existe en local: hace falta VTUBERDEX_DB_URL (la base del mantenedor)",
  );
}

/**
 * ¿`partes` sigue el `patron`? Cada elemento es un literal exacto o `"*"` (segmento no vacío).
 * Con `exacto` (por defecto) el largo también tiene que coincidir; sin él, sobran segmentos al final.
 */
function coincide(partes, patron, { exacto = true } = {}) {
  const largoOk = exacto
    ? partes.length === patron.length
    : partes.length >= patron.length;
  return (
    largoOk &&
    patron.every((segmento, i) =>
      segmento === "*" ? Boolean(partes[i]) : partes[i] === segmento,
    )
  );
}

/** Segmentos de la ruta pedida (`[...path]`), siempre como lista. */
async function partesDe(context) {
  const { path } = await context.params;
  return Array.isArray(path) ? path : [path];
}

const noSoportada = (partes) =>
  noDisponible(
    `ruta del mantenedor no soportada en producción: ${partes.join("/")}`,
  );

/**
 * Rutas GET de sufijo FIJO (con sesión). Un `Map` y no un objeto literal: un sufijo como
 * `constructor` no puede caer en el prototipo.
 */
const GET_FIJAS = new Map([
  ["stats", () => estadisticas()],
  // `audit` va vacío a propósito: el registro vive en `audit_log`, que la base que se
  // despliega sanea (contiene el hash de la contraseña). Se devuelve `{items: []}` para que
  // la UI muestre "sin registros" en vez de un error que parecería una avería.
  ["audit", () => NextResponse.json({ items: [] })],
  ["vtubers", (request) => listarVtubers(request)],
  ["dex/next", () => siguienteDex()],
  ["factions", () => listaDeFacciones()],
  ["solicitudes", (request) => listarSolicitudesRuta(request)],
  ["solicitudes/rechazos", (request) => rechazosRuta(request)],
  ["misiones/reclamos", () => reclamosDeMisionesRuta()],
]);

/** Rutas GET con parámetros, después de las fijas. */
function getConParametros(request, partes) {
  if (coincide(partes, ["vtubers", "*"])) {
    return detalleVtuber(partes[1]);
  }
  if (coincide(partes, ["solicitudes", "*", "vista-previa"])) {
    return vistaPreviaRuta(request, partes[1]);
  }
  if (coincide(partes, ["solicitudes", "*", "imagenes"])) {
    return imagenesDeSolicitudRuta(partes[1]);
  }
  if (coincide(partes, ["solicitudes", "*", "imagen", "*"])) {
    return imagenDeSolicitudRuta(partes[1], partes[3]);
  }
  return noSoportada(partes);
}

export async function GET(request, context) {
  if (ADMIN_UPSTREAM) {
    return reenviar(request, context, "GET");
  }
  if (!tursoConfigurado()) {
    return sinBackend();
  }
  const partes = await partesDe(context);
  const sufijo = partes.join("/");
  if (sufijo === "session") {
    return sesionTurso(request);
  }
  const [, negado] = await exigirSesion(request);
  if (negado) {
    return negado;
  }
  const fija = GET_FIJAS.get(sufijo);
  if (fija) {
    return fija(request);
  }
  return getConParametros(request, partes);
}

export async function PATCH(request, context) {
  if (ADMIN_UPSTREAM) {
    return reenviar(request, context, "PATCH");
  }
  if (!tursoConfigurado()) {
    return sinBackend();
  }
  const [usuario, negado] = await exigirSesion(request);
  if (negado) {
    return negado;
  }
  const partes = await partesDe(context);
  if (coincide(partes, ["vtubers", "*"], { exacto: false })) {
    return editarVtuber(request, partes[1], usuario);
  }
  if (coincide(partes, ["factions", "*"], { exacto: false })) {
    return editarFaccionRuta(request, partes[1], usuario);
  }
  return noSoportada(partes);
}

export async function PUT(request, context) {
  if (ADMIN_UPSTREAM) {
    return reenviar(request, context, "PUT");
  }
  if (!tursoConfigurado()) {
    return sinBackend();
  }
  const [, negado] = await exigirSesion(request);
  if (negado) {
    return negado;
  }
  const partes = await partesDe(context);
  if (coincide(partes, ["vtubers", "*", "correo"])) {
    return fijarCorreo(request, partes[1]);
  }
  return noSoportada(partes);
}

/** Rutas POST que crean la sesión o la cierran: no la exigen. `null` si no es ninguna. */
function postSinSesion(request, partes) {
  // El login es la ÚNICA ruta sin sesión que entra con contraseña: es la que la crea.
  if (partes[0] === "login") {
    return login(request);
  }
  if (partes[0] === "enlace") {
    return enlaceDeAcceso(request, partes[1]);
  }
  if (partes[0] === "logout") {
    return logout(request);
  }
  return null;
}

/** Rutas POST con sesión ya comprobada. */
function postConSesion(request, partes, usuario) {
  if (coincide(partes, ["vtubers"])) {
    return crearVtuber(request, usuario);
  }
  if (coincide(partes, ["vtubers", "bulk-status"], { exacto: false })) {
    return estadoMasivo(request, usuario);
  }
  if (coincide(partes, ["vtubers", "*", "image", "*"], { exacto: false })) {
    return subirImagen(request, partes[1], partes[3]);
  }
  if (coincide(partes, ["solicitudes", "*", "resolver"], { exacto: false })) {
    return resolverSolicitudRuta(request, partes[1], usuario);
  }
  if (coincide(partes, ["misiones", "reclamos", "*", "*", "revocar"])) {
    return revocarReclamoRuta(partes[2], partes[3], usuario);
  }
  if (coincide(partes, ["factions"])) {
    return crearFaccionRuta(request, usuario);
  }
  if (coincide(partes, ["factions", "*", "image"], { exacto: false })) {
    return subirEmblema(request, partes[1], usuario);
  }
  return noSoportada(partes);
}

export async function POST(request, context) {
  if (ADMIN_UPSTREAM) {
    return reenviar(request, context, "POST");
  }
  if (!tursoConfigurado()) {
    return sinBackend();
  }
  const partes = await partesDe(context);
  const sinSesion = postSinSesion(request, partes);
  if (sinSesion) {
    return sinSesion;
  }
  const [usuario, negado] = await exigirSesion(request);
  if (negado) {
    return negado;
  }
  return postConSesion(request, partes, usuario);
}

export async function DELETE(request, context) {
  if (ADMIN_UPSTREAM) {
    return reenviar(request, context, "DELETE");
  }
  if (!tursoConfigurado()) {
    return sinBackend();
  }
  const [usuario, negado] = await exigirSesion(request);
  if (negado) {
    return negado;
  }
  const partes = await partesDe(context);
  if (coincide(partes, ["vtubers", "*", "image", "*"], { exacto: false })) {
    return borrarImagen(partes[1], partes[3]);
  }
  if (coincide(partes, ["factions", "*"], { exacto: false })) {
    return eliminarFaccionRuta(request, partes[1], usuario);
  }
  return noSoportada(partes);
}
