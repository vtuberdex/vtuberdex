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
import { NextResponse } from 'next/server';

import {
  aplicarImagenesDelMantenedor,
  aplicarReemplazosALista,
  borrarAssetDelMantenedor,
  guardarAssetDelMantenedor,
  leerAssetDelMantenedor,
  renombrarAssetsDelMantenedor,
  reemplazosDelMantenedor,
  tursoConfigurado,
} from '../../../../lib/ediciones.mjs';
import { aplicarYAnotar, dbConDiario } from '../../../../lib/diario.mjs';
import { KINDS_GESTIONABLES, EXTENSION_DE_CARPETA } from '../../../../lib/carpetas.mjs';
import {
  cerrarSesion,
  credencialesConfiguradas,
  diagnosticarCredenciales,
  emitirSesion,
  formatoDeHash,
  leerSesion,
  tokenDeCabecera,
  usuarioEsperado,
} from '../../../../lib/admin-auth.mjs';
import { entrarConEnlace, pedirEnlaceDeAcceso } from '../../../../lib/admin-enlace.mjs';
import { ipDelCliente, origenPermitido } from '../../../../lib/likes.mjs';
import {
  adminListQuerySchema,
  bulkStatusSchema,
  factionCreateSchema,
  factionUpdateSchema,
  formatIssues,
  fichaCorreoSchema,
  vtuberCreateSchema,
  vtuberUpdateSchema,
} from '../../../../server/src/validation.mjs';
import { MutationError, listarFacciones, ultimoDex } from '../../../../server/src/mutations.mjs';
import { resumenDeRechazos } from '../../../../server/src/rechazos.mjs';
import { ejecutorDeSolicitudes } from '../../../../lib/solicitudes.mjs';
import { correoDeBienvenida, enviarCorreo } from '../../../../lib/correo.mjs';
import {
  SolicitudError,
  fichaDesdeInscripcion,
  correosDeFichas,
  fijarCorreoDeFicha,
  leerSolicitud,
  listarSolicitudes,
  resolverSolicitud,
} from '../../../../server/src/solicitudes.mjs';
import { listarConCorreo } from '../../../../server/src/correo-fichas.mjs';
import { estadisticasDelMantenedor } from '../../../../server/src/estadisticas-admin.mjs';
import { prepararModificacion } from '../../../../server/src/modificacion.mjs';
import { vistaPrevia } from '../../../../server/src/solicitud-vista.mjs';
import { getVtuberBySlug } from '../../../../server/src/search.mjs';
import { readWebpSize } from '../../../../server/src/seed.mjs';

export const dynamic = 'force-dynamic';

/** Servidor de escritura para desarrollo; en producción no existe. */
const ADMIN_UPSTREAM = process.env.VTUBERDEX_ADMIN_URL ?? null;

const noDisponible = (detail) =>
  NextResponse.json({ error: 'no_encontrado', detail }, { status: 404 });

const noAutenticado = () => NextResponse.json({ error: 'no_autenticado' }, { status: 401 });

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
  if (!user) return [null, noAutenticado()];
  return [user, null];
}

/**
 * Respuesta de error de una mutación: el estado y el código que decidieron las reglas
 * compartidas (`server/src/mutations.mjs`), idénticos a los del Express local.
 */
function responderError(error) {
  if (error instanceof MutationError) {
    return NextResponse.json({ error: error.code, detail: error.detail }, { status: error.status });
  }
  console.error('[admin] error al guardar', error);
  return NextResponse.json({ error: 'error_al_guardar', detail: error.message }, { status: 500 });
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
  if (!detalle) return null;
  return aplicarImagenesDelMantenedor(detalle, await reemplazosDelMantenedor(detalle.slug));
}

/** Ficha por id sobre la base materializada, o `null`. */
function fichaPorId(db, id) {
  return db.prepare('SELECT id, slug FROM vtuber WHERE id = ?').get(Number(id)) ?? null;
}

/** Reenvía al Express local (comportamiento de siempre, sin cambios). */
async function reenviar(request, context, method) {
  const { path } = await context.params;
  const suffix = Array.isArray(path) ? path.join('/') : (path ?? '');
  const url = `${ADMIN_UPSTREAM.replace(/\/$/, '')}/api/admin/${suffix}${new URL(request.url).search}`;
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
      body: method === 'GET' ? undefined : await request.arrayBuffer(),
    });
  } catch (error) {
    // El mantenedor está configurado pero no responde (ECONNREFUSED: se levantó
    // solo Next, o el contenedor del admin se cayó). Sin este `catch`, el
    // `fetch` lanzaba y la ruta devolvía **500** en vez del 404 documentado.
    return noDisponible(`el mantenedor no responde en ${ADMIN_UPSTREAM}: ${error.message}`);
  }
  return new NextResponse(response.body, { status: response.status, headers: response.headers });
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
        error: 'sin_credenciales',
        detail: 'falta VTUBERDEX_ADMIN_PASSWORD_HASH: genera el hash con `node scripts/admin-hash.mjs`',
      },
      { status: 500 },
    );
  }
  const body = await request.json().catch(() => null);
  const {
    ok,
    usuarioOk,
    claveOk,
  } = diagnosticarCredenciales(body?.username, body?.password);
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
      ? { valido: false, problemas: ['falta VTUBERDEX_ADMIN_PASSWORD_HASH'] }
      : formatoDeHash();
    return NextResponse.json(
      {
        error: 'credenciales_invalidas',
        usuarioOk,
        claveOk,
        usuarioEsperado: usuarioEsperado(),
        hash,
      },
      { status: 401 },
    );
  }
  const user = { id: 0, username: usuarioEsperado(), role: 'admin' };
  const token = await emitirSesion(user);
  if (!token) return noDisponible('no se pudo emitir la sesión (¿Turso configurado?)');
  return NextResponse.json({ token, user: { username: user.username, role: user.role } });
}

/**
 * `POST /api/admin/enlace` (pide el enlace por correo) y `POST /api/admin/enlace/entrar` (lo gasta).
 *
 * Son sin sesión por definición: son las que la crean. Pedir el enlace responde siempre lo mismo
 * para cualquier correo bien formado (ver `lib/admin-enlace.mjs`).
 */
async function enlaceDeAcceso(request, accion) {
  const cabeceras = { 'cache-control': 'no-store' };
  if (!origenPermitido(request.headers)) return NextResponse.json({ error: 'origen_no_permitido' }, { status: 403, headers: cabeceras });
  const cuerpo = await request.json().catch(() => null);
  try {
    const { status, cuerpo: respuesta } =
      accion === 'entrar'
        ? await entrarConEnlace(typeof cuerpo?.token === 'string' ? cuerpo.token : '')
        : await pedirEnlaceDeAcceso({ email: cuerpo?.email, ip: ipDelCliente(request.headers) });
    return NextResponse.json(respuesta, { status, headers: cabeceras });
  } catch (error) {
    console.error(`[admin] enlace de acceso: ${error.message}`);
    return NextResponse.json({ error: 'no_disponible', detail: 'No se pudo procesar. Inténtalo de nuevo.' }, { status: 503, headers: cabeceras });
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
      mode: 'turso',
      login: false,
      note: 'falta VTUBERDEX_ADMIN_PASSWORD_HASH: define la contraseña con `node scripts/admin-hash.mjs`',
    });
  }
  const user = await leerSesion(tokenDeCabecera(request));
  if (!user) return noAutenticado();
  return NextResponse.json({ mode: 'turso', login: true, user: { username: user.username, role: user.role } });
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
    console.error('[admin] sin cola de solicitudes: las estadísticas salen sin correos ni pendientes', error);
  }
  return NextResponse.json(await estadisticasDelMantenedor(db, ejecutor), { headers: { 'cache-control': 'no-store' } });
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
    return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  if (Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: 'sin_cambios' }, { status: 400 });
  }
  try {
    const db = await dbConDiario();
    const actual = fichaPorId(db, id);
    if (!actual) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    const { db: dbNueva, resultado } = await aplicarYAnotar(
      { tipo: 'vtuber.editar', id: actual.id, patch: parsed.data },
      usuario.username,
    );
    // Los reemplazos de imagen del mantenedor se guardan por slug: al cambiar la URL se mudan
    // con la ficha, o la imagen subida dejaría de verse.
    if (resultado.slug !== actual.slug) await renombrarAssetsDelMantenedor(actual.slug, resultado.slug);
    return NextResponse.json(await detalleConReemplazos(dbNueva, resultado.slug));
  } catch (error) {
    return responderError(error);
  }
}

/** `POST /api/admin/vtubers` — crea una carta nueva (nace en borrador, al final de la dex). */
async function crearVtuber(request, usuario) {
  const body = await request.json().catch(() => null);
  const parsed = vtuberCreateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  try {
    const { db, resultado } = await aplicarYAnotar({ tipo: 'vtuber.crear', datos: parsed.data }, usuario.username);
    return NextResponse.json(await detalleConReemplazos(db, resultado.slug), { status: 201 });
  } catch (error) {
    return responderError(error);
  }
}

/** `GET /api/admin/vtubers` — listado del mantenedor: incluye borradores y ocultos. */
async function listarVtubers(request) {
  const parsed = adminListQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: 'query_invalida', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  const { q, status, premium, correo, page, perPage } = parsed.data;
  const db = await dbConDiario();
  let ejecutor = null;
  try {
    ejecutor = await ejecutorDeSolicitudes();
  } catch (error) {
    console.error('[admin] sin cola de solicitudes: el listado sale sin datos de correo', error);
  }
  if (correo && !ejecutor) return NextResponse.json({ error: 'solicitudes_no_disponibles' }, { status: 503 });
  const resultado = await listarConCorreo(db, ejecutor, {
    q,
    correo,
    page,
    perPage,
    includeHidden: true,
    status: status === 'all' ? null : status,
    premium: premium ? 'todas' : false,
    sort: 'dex',
  });
  return NextResponse.json({ ...resultado, items: await aplicarReemplazosALista(resultado.items) });
}

/** `GET /api/admin/vtubers/:id` — detalle sin filtrar por estado: es lo que abre el editor. */
async function detalleVtuber(id) {
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  const detalle = actual ? await detalleConReemplazos(db, actual.slug) : null;
  if (!detalle) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  // El correo va SOLO en el detalle del mantenedor; sin cola no tumba la ficha.
  let email = null;
  try {
    const correos = await correosDeFichas(await ejecutorDeSolicitudes(), {
      resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }),
    });
    email = correos.get(actual.id) ?? null;
  } catch (error) {
    console.error('[admin] no se pudo leer el correo de la ficha', error);
  }
  return NextResponse.json({ ...detalle, email });
}

/** `PUT /api/admin/vtubers/:id/correo` — fija o quita el correo de una ficha (vive en la cola, no en el diario). */
async function fijarCorreo(request, id) {
  const parsed = fichaCorreoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  if (!actual) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  try {
    const ejecutor = await ejecutorDeSolicitudes();
    const resolverFicha = (slug) => getVtuberBySlug(db, slug, { includeHidden: true });
    const anterior = (await correosDeFichas(ejecutor, { resolverFicha })).get(actual.id) ?? null;
    const email = await fijarCorreoDeFicha(ejecutor, actual.id, parsed.data.email);
    // Bienvenida solo si el correo es NUEVO para la ficha (guardar el mismo otra vez no reenvía). Si el
    // envío falla el correo ya quedó guardado: se avisa en la respuesta en vez de deshacer el cambio.
    let bienvenida = 'no';
    if (email && email !== anterior) {
      try {
        const ficha = resolverFicha(actual.slug);
        const { asunto, texto, html } = correoDeBienvenida({ nombre: ficha?.name, slug: actual.slug });
        await enviarCorreo({ para: email, asunto, texto, html });
        bienvenida = 'enviada';
      } catch (error) {
        console.error(`[admin] no se pudo enviar la bienvenida a la ficha ${actual.slug}: ${error.message}`);
        bienvenida = 'fallo';
      }
    }
    return NextResponse.json({ email, bienvenida });
  } catch (error) {
    if (error instanceof SolicitudError) return NextResponse.json({ error: error.code, detail: error.detail }, { status: error.status });
    console.error('[admin] no se pudo guardar el correo', error);
    return NextResponse.json({ error: 'solicitudes_no_disponibles', detail: error.message }, { status: 503 });
  }
}

/** `GET /api/admin/dex/next` — el siguiente número libre al final de la dex. */
async function siguienteDex() {
  const db = await dbConDiario();
  return NextResponse.json({ next: ultimoDex(db) + 1 });
}

// ------------------------------------------------------------- facciones

/** `GET /api/admin/factions` — las facciones con su conteo real. */
async function listaDeFacciones() {
  return NextResponse.json({ items: listarFacciones(await dbConDiario()) });
}

/** Aplica una operación de facción y devuelve la lista nueva (la UI repinta desde ella). */
async function mutarFaccion(operacion, usuario, status = 200) {
  try {
    const { db, resultado } = await aplicarYAnotar(operacion, usuario.username);
    return NextResponse.json({ faction: resultado, items: listarFacciones(db) }, { status });
  } catch (error) {
    return responderError(error);
  }
}

async function crearFaccionRuta(request, usuario) {
  const parsed = factionCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  return mutarFaccion({ tipo: 'faccion.crear', datos: parsed.data }, usuario, 201);
}

async function editarFaccionRuta(request, id, usuario) {
  const parsed = factionUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  return mutarFaccion({ tipo: 'faccion.editar', id: Number(id), patch: parsed.data }, usuario);
}

/**
 * Medidas de un PNG leídas de su cabecera (IHDR), o `null` si los bytes no son un PNG.
 * JS puro: aquí no hay `sharp` (binario nativo que no viaja a la función).
 */
function leerMedidasPng(bytes) {
  const firma = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || firma.some((valor, i) => bytes[i] !== valor)) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * `POST /api/admin/factions/:id/image` — sube el emblema de una facción (PNG).
 *
 * El cliente lo normaliza a PNG de hasta 512 px antes de enviarlo (en producción no hay `sharp`),
 * y aquí se valida la FIRMA, no la extensión. Se guarda como asset del mantenedor (`kind =
 * 'faction'`, por slug de la facción) y la facción pasa a apuntar a él con `?v=<ms>`: la ruta es
 * canónica y sin versión el navegador seguiría mostrando el emblema anterior.
 */
async function subirEmblema(request, id, usuario) {
  try {
    const db = await dbConDiario();
    const faccion = db.prepare('SELECT id, slug FROM faction WHERE id = ?').get(Number(id));
    if (!faccion) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'archivo_demasiado_grande', detail: 'el emblema admite hasta 2 MB' }, { status: 400 });
    }
    const medidas = leerMedidasPng(bytes);
    if (!medidas) return NextResponse.json({ error: 'formato_invalido', detail: 'se esperaba un PNG' }, { status: 400 });
    await guardarAssetDelMantenedor(faccion.slug, 'faction', bytes, 'image/png', medidas);
    const ruta = `images/faction/${faccion.slug}.png?v=${Date.now()}`;
    const { db: dbNueva, resultado } = await aplicarYAnotar(
      { tipo: 'faccion.editar', id: faccion.id, patch: { icon: ruta } },
      usuario.username,
    );
    return NextResponse.json({ faction: resultado, items: listarFacciones(dbNueva), asset: { path: ruta, ...medidas, bytes: bytes.length } });
  } catch (error) {
    return responderError(error);
  }
}

async function eliminarFaccionRuta(request, id, usuario) {
  const bruto = new URL(request.url).searchParams.get('mergeInto');
  const destino = bruto === null ? null : Number(bruto);
  if (destino !== null && !Number.isInteger(destino)) {
    return NextResponse.json({ error: 'fusion_invalida', detail: 'mergeInto debe ser un id' }, { status: 400 });
  }
  return mutarFaccion({ tipo: 'faccion.eliminar', id: Number(id), fusionarEn: destino }, usuario);
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
      { error: 'kind_invalido', detail: `use: ${KINDS_GESTIONABLES.join(', ')}` },
      { status: 400 },
    );
  }
  const db = await dbConDiario();
  const actual = fichaPorId(db, id);
  if (!actual) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });

  const bytes = Buffer.from(await request.arrayBuffer());
  // Firma de WebP: "RIFF" + 4 bytes de tamaño + "WEBP". Es el contenedor que usan las
  // carpetas publicadas, así que no hace falta aceptar nada más.
  const esWebp =
    bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!esWebp) {
    return NextResponse.json({ error: 'formato_invalido', detail: 'se esperaba WebP (RIFF/WEBP)' }, { status: 400 });
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
  await guardarAssetDelMantenedor(actual.slug, kind, bytes, 'image/webp', medidas);

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
  const ext = EXTENSION_DE_CARPETA[kind] ?? 'webp';
  const asset = {
    path: `images/${kind}/${actual.slug}.${ext}`,
    width: fila?.width ?? null,
    height: fila?.height ?? null,
    bytes: bytes.length,
    format: 'webp',
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
  if (!actual) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
  if (!KINDS_GESTIONABLES.includes(kind)) {
    return NextResponse.json(
      { error: 'kind_invalido', detail: `use: ${KINDS_GESTIONABLES.join(', ')}` },
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
    restaurado: habia ? 'catalogo' : 'no_habia_reemplazo',
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
  const parsed = bulkStatusSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(parsed.error) }, { status: 400 });
  }
  try {
    const { ids, status } = parsed.data;
    const { resultado } = await aplicarYAnotar({ tipo: 'vtuber.estado', ids, status }, usuario.username);
    return NextResponse.json({ updated: resultado.ids.length, status });
  } catch (error) {
    return responderError(error);
  }
}

/** Respuesta común cuando no hay ningún backend de escritura. */
/**
 * `GET /api/admin/solicitudes?estado=&tipo=` — la cola de inscripciones y bajas que llegaron
 * por los formularios públicos. Trae el contacto confidencial: solo se sirve con sesión.
 */
async function listarSolicitudesRuta(request) {
  const consulta = new URL(request.url).searchParams;
  const estado = consulta.get('estado') ?? 'pendiente';
  const tipo = consulta.get('tipo');
  if (!['pendiente', 'aprobada', 'rechazada', 'procesada', 'todas'].includes(estado) || (tipo && !['inscripcion', 'baja', 'modificacion'].includes(tipo))) {
    return NextResponse.json({ error: 'query_invalida' }, { status: 400 });
  }
  try {
    return NextResponse.json(await listarSolicitudes(await ejecutorDeSolicitudes(), { estado, tipo }));
  } catch (error) {
    console.error('[admin] no se pudo leer la cola de solicitudes', error);
    return NextResponse.json({ error: 'solicitudes_no_disponibles', detail: error.message }, { status: 503 });
  }
}

/**
 * `GET /api/admin/solicitudes/rechazos?dias=7` — qué formulario rechazó qué y por qué campo en los últimos
 * días (sin correos ni contenido): para saber dónde se atasca la gente.
 */
async function rechazosRuta(request) {
  const dias = Math.min(30, Math.max(1, Number(new URL(request.url).searchParams.get('dias')) || 7));
  try {
    return NextResponse.json(await resumenDeRechazos(await ejecutorDeSolicitudes(), { dias }));
  } catch (error) {
    console.error('[admin] no se pudo leer el resumen de rechazos', error);
    return NextResponse.json({ error: 'solicitudes_no_disponibles', detail: error.message }, { status: 503 });
  }
}

/** Lo que el mantenedor puede escribir como dirección de una ficha: letras, números y guiones. */
const SLUG_DE_FICHA = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * `GET /api/admin/solicitudes/:id/vista-previa?ficha=<slug>` — qué pasaría al aprobar, SIN escribir nada: si se
 * puede, qué cambia (antes → después), a qué ficha afecta y, si la ficha no se encontró, candidatas para elegir.
 * `ficha` elige a mano la ficha de una modificación (la misma que luego se manda al aprobar).
 */
async function vistaPreviaRuta(request, id) {
  const fichaSlug = new URL(request.url).searchParams.get('ficha');
  if (fichaSlug !== null && !SLUG_DE_FICHA.test(fichaSlug)) return NextResponse.json({ error: 'query_invalida' }, { status: 400 });
  try {
    const solicitud = await leerSolicitud(await ejecutorDeSolicitudes(), id);
    if (!solicitud) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    return NextResponse.json(vistaPrevia(await dbConDiario(), solicitud, { fichaSlug }), { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    return responderError(error);
  }
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
async function resolverSolicitudRuta(request, id, usuario) {
  const cuerpo = await request.json().catch(() => null);
  const accion = cuerpo?.accion;
  if (!['aprobar', 'rechazar', 'procesar'].includes(accion)) {
    return NextResponse.json({ error: 'payload_invalido', detail: 'accion: aprobar | rechazar | procesar' }, { status: 400 });
  }
  const nota = typeof cuerpo?.nota === 'string' ? cuerpo.nota : '';
  try {
    const ejecutor = await ejecutorDeSolicitudes();
    const solicitud = await leerSolicitud(ejecutor, id);
    if (!solicitud) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });
    if (solicitud.estado !== 'pendiente') {
      return NextResponse.json({ error: 'ya_resuelta', detail: 'esta solicitud ya fue resuelta' }, { status: 409 });
    }
    let vtuberSlug = null;
    if (accion === 'aprobar' && solicitud.tipo === 'modificacion') {
      // Se aplica el parche a la ficha EXISTENTE (`vtuber.editar` del diario); avatar y logo (enlaces)
      // los sube el mantenedor aparte. La ficha se lee del diario ya reproducido, no de la base empaquetada.
      const db = await dbConDiario();
      // El mantenedor puede haber ELEGIDO la ficha cuando lo escrito en el formulario no se resolvía solo.
      let elegida = null;
      if (typeof cuerpo?.fichaSlug === 'string' && cuerpo.fichaSlug) {
        elegida = SLUG_DE_FICHA.test(cuerpo.fichaSlug) ? getVtuberBySlug(db, cuerpo.fichaSlug, { includeHidden: true }) : null;
        if (!elegida) return NextResponse.json({ error: 'ficha_no_encontrada', detail: 'la ficha elegida no existe' }, { status: 404 });
      }
      const { id: fichaId, slug, patch } = prepararModificacion(db, solicitud, { ficha: elegida });
      const datos = vtuberUpdateSchema.safeParse(patch);
      if (!datos.success) {
        return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(datos.error) }, { status: 400 });
      }
      vtuberSlug = slug;
      if (Object.keys(datos.data).length) {
        const { resultado } = await aplicarYAnotar({ tipo: 'vtuber.editar', id: fichaId, patch: datos.data }, usuario.username);
        vtuberSlug = resultado.slug;
      }
    } else if (accion === 'aprobar') {
      if (solicitud.tipo !== 'inscripcion') {
        return NextResponse.json({ error: 'estado_invalido', detail: 'solo se aprueban inscripciones y modificaciones' }, { status: 400 });
      }
      const datos = vtuberCreateSchema.safeParse(fichaDesdeInscripcion(solicitud));
      if (!datos.success) {
        return NextResponse.json({ error: 'payload_invalido', issues: formatIssues(datos.error) }, { status: 400 });
      }
      const { resultado } = await aplicarYAnotar({ tipo: 'vtuber.crear', datos: datos.data }, usuario.username);
      vtuberSlug = resultado.slug;
    }
    const estado = accion === 'aprobar' ? 'aprobada' : accion === 'procesar' ? 'procesada' : 'rechazada';
    const resuelta = await resolverSolicitud(ejecutor, id, { estado, actor: usuario.username, nota, vtuberSlug });
    return NextResponse.json({ solicitud: resuelta });
  } catch (error) {
    if (error instanceof SolicitudError) {
      return NextResponse.json({ error: error.code, detail: error.detail }, { status: error.status });
    }
    return responderError(error);
  }
}

function sinBackend() {
  return noDisponible('el mantenedor solo existe en local: hace falta VTUBERDEX_DB_URL (la base del mantenedor)');
}

export async function GET(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'GET');
  if (!tursoConfigurado()) return sinBackend();
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  const sufijo = partes.join('/');
  if (sufijo === 'session') return sesionTurso(request);
  const [, negado] = await exigirSesion(request);
  if (negado) return negado;
  if (sufijo === 'stats') return estadisticas();
  // `audit` va vacío a propósito: el registro vive en `audit_log`, que la base que se
  // despliega sanea (contiene el hash de la contraseña). Se devuelve `{items: []}` para que
  // la UI muestre "sin registros" en vez de un error que parecería una avería.
  if (sufijo === 'audit') return NextResponse.json({ items: [] });
  if (sufijo === 'vtubers') return listarVtubers(request);
  if (partes[0] === 'vtubers' && partes[1] && partes.length === 2) return detalleVtuber(partes[1]);
  if (sufijo === 'dex/next') return siguienteDex();
  if (sufijo === 'factions') return listaDeFacciones();
  if (sufijo === 'solicitudes') return listarSolicitudesRuta(request);
  if (sufijo === 'solicitudes/rechazos') return rechazosRuta(request);
  if (partes[0] === 'solicitudes' && partes[1] && partes[2] === 'vista-previa' && partes.length === 3) return vistaPreviaRuta(request, partes[1]);
  return noDisponible(`ruta del mantenedor no soportada en producción: ${sufijo}`);
}

export async function PATCH(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'PATCH');
  if (!tursoConfigurado()) return sinBackend();
  const [usuario, negado] = await exigirSesion(request);
  if (negado) return negado;
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  if (partes[0] === 'vtubers' && partes[1]) return editarVtuber(request, partes[1], usuario);
  if (partes[0] === 'factions' && partes[1]) return editarFaccionRuta(request, partes[1], usuario);
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}

export async function PUT(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'PUT');
  if (!tursoConfigurado()) return sinBackend();
  const [, negado] = await exigirSesion(request);
  if (negado) return negado;
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  if (partes[0] === 'vtubers' && partes[1] && partes[2] === 'correo' && partes.length === 3) return fijarCorreo(request, partes[1]);
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}

export async function POST(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'POST');
  if (!tursoConfigurado()) return sinBackend();
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  // El login es la ÚNICA ruta sin sesión: es la que la crea.
  if (partes[0] === 'login') return login(request);
  if (partes[0] === 'enlace') return enlaceDeAcceso(request, partes[1]);
  if (partes[0] === 'logout') return logout(request);
  const [usuario, negado] = await exigirSesion(request);
  if (negado) return negado;
  if (partes[0] === 'vtubers' && partes.length === 1) return crearVtuber(request, usuario);
  if (partes[0] === 'vtubers' && partes[1] === 'bulk-status') return estadoMasivo(request, usuario);
  if (partes[0] === 'vtubers' && partes[1] && partes[2] === 'image' && partes[3]) {
    return subirImagen(request, partes[1], partes[3]);
  }
  if (partes[0] === 'solicitudes' && partes[1] && partes[2] === 'resolver') return resolverSolicitudRuta(request, partes[1], usuario);
  if (partes[0] === 'factions' && partes.length === 1) return crearFaccionRuta(request, usuario);
  if (partes[0] === 'factions' && partes[1] && partes[2] === 'image') return subirEmblema(request, partes[1], usuario);
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}

export async function DELETE(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'DELETE');
  if (!tursoConfigurado()) return sinBackend();
  const [usuario, negado] = await exigirSesion(request);
  if (negado) return negado;
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  if (partes[0] === 'vtubers' && partes[1] && partes[2] === 'image' && partes[3]) {
    return borrarImagen(partes[1], partes[3]);
  }
  if (partes[0] === 'factions' && partes[1]) return eliminarFaccionRuta(request, partes[1], usuario);
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}
