/**
 * Rutas del mantenedor.
 *
 * DOS MODOS, según quién pueda escribir de verdad:
 *
 *   · **LOCAL** (`VTUBERDEX_ADMIN_URL`): se reenvía al servidor Express, que es el
 *     único que escribe sobre el SQLite de `data/` —subida de imágenes con `sharp`,
 *     cuerpo de 12 MB, auditoría—. Es como se ha trabajado siempre y no cambia.
 *   · **PRODUCCIÓN (Vercel)** (`TURSO_DATABASE_URL`): el sistema de archivos es
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
  aplicarEdiciones,
  aplicarImagenesDelMantenedor,
  borrarAssetDelMantenedor,
  guardarAssetDelMantenedor,
  guardarEdicion,
  guardarEdicionMasiva,
  leerAssetDelMantenedor,
  leerEdiciones,
  reemplazosDelMantenedor,
  tursoConfigurado,
} from '../../../../lib/ediciones.mjs';
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
import { vtuberUpdateSchema, formatIssues } from '../../../../server/src/validation.mjs';
import { getVtuberBySlug } from '../../../../server/src/search.mjs';
import { readWebpSize } from '../../../../server/src/seed.mjs';
import { getDb } from '../../../../lib/db.mjs';

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
 * El detalle de una ficha tal como lo ve el mantenedor, listo para devolverlo.
 *
 * POR QUÉ DEVOLVER EL DETALLE Y NO `{ok:true}`
 * -------------------------------------------
 * El cliente hace `setSelected(respuesta)` con el resultado de cada escritura y vuelve a
 * dibujar la página desde ese objeto (`components/admin-page.tsx`, `onUpdated`). Devolver un
 * acuse —`{ok, slug, kind, size}`— no da error, pero deja la ficha con los campos del
 * catálogo: al subir una imagen, `images[kind]` sigue en `null` y el mantenedor pinta "sin
 * imagen" con la imagen YA guardada. Medido en producción: era el síntoma de "no puedo subir
 * imágenes". El Express devuelve el detalle desde siempre (`res.json({ok, kind, asset,
 * vtuber})`), así que este es el contrato al que hay que igualarse, no uno nuevo.
 *
 * Se aplican las ediciones de Turso por la misma razón por la que las aplica la lectura:
 * `getVtuberBySlug` lee el CATÁLOGO, y sin volver a pasar las ediciones una ficha editada en
 * el mantenedor volvería a mostrar los valores del scrape tras guardar.
 *
 * `includeHidden: true` porque el mantenedor trabaja con fichas despublicadas: sin esto,
 * guardar en una ficha en borrador la haría desaparecer de la pantalla.
 */
async function detalleActualizado(db, slug) {
  const detalle = getVtuberBySlug(db, slug, { includeHidden: true });
  if (!detalle) return null;
  const ediciones = await leerEdiciones();
  return aplicarEdiciones(detalle, ediciones);
}

/**
 * El detalle con los reemplazos de imagen del mantenedor visibles.
 *
 * Se consulta Turso por tipo (solo hay reemplazo si alguien subió una imagen a mano) y se
 * compone con `aplicarImagenesDelMantenedor`. La extensión de cada carpeta sale del módulo
 * compartido: los emblemas de facción son PNG y suponer `.webp` los dejaría fuera.
 */
async function detalleConReemplazos(db, slug) {
  const detalle = await detalleActualizado(db, slug);
  if (!detalle) return null;
  return aplicarImagenesDelMantenedor(detalle, await reemplazosDelMantenedor(slug));
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
 * `GET /api/admin/stats` — totales y calidad del catálogo.
 *
 * Se calcula sobre la SQLite empaquetada (las MISMAS consultas que el Express) y luego se
 * aplican las ediciones, para que los totales no contradigan la lista que el mantenedor
 * muestra al lado: si alguien despublica una ficha, `notPublished` tiene que subir.
 *
 * `audit` no se calcula: el registro de auditoría vive en `audit_log`, que en la base
 * desplegada va VACÍO a propósito (lleva el hash de la contraseña y se sanea con VACUUM). Se
 * devuelve una lista vacía en vez de un 404 para que la pestaña de auditoría de la UI
 * muestre "sin registros" y no un error.
 */
async function estadisticas() {
  const db = getDb();
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN has_detail = 1 THEN 1 ELSE 0 END) AS withDetail,
              SUM(CASE WHEN status != 'published' THEN 1 ELSE 0 END) AS notPublished
         FROM vtuber`,
    )
    .get();
  const quality = db
    .prepare('SELECT data_quality AS flags, COUNT(*) AS count FROM vtuber GROUP BY data_quality ORDER BY count DESC')
    .all()
    .map((row) => ({ flags: JSON.parse(row.flags ?? '[]'), count: row.count }));
  const themes = db.prepare('SELECT COUNT(DISTINCT theme_color) AS n FROM vtuber').get().n;

  const ediciones = await leerEdiciones();
  let despublicadas = 0;
  for (const campos of Object.values(ediciones)) {
    if (campos.status !== undefined) {
      const valor = campos.status === null ? null : jsonTolerante(campos.status);
      if (valor && valor !== 'published') despublicadas += 1;
    }
  }
  return NextResponse.json({
    totals: {
      ...totals,
      total: Number(totals.total ?? 0),
      withDetail: Number(totals.withDetail ?? 0),
      notPublished: Number(totals.notPublished ?? 0) + despublicadas,
    },
    themes,
    quality,
  });
}

/** `JSON.parse` tolerante: una fila antigua o corrupta no debe tumbar las estadísticas. */
function jsonTolerante(bruto) {
  try {
    return JSON.parse(bruto);
  } catch {
    return bruto;
  }
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
 * `PATCH /api/admin/vtubers/:id` — guarda una edición en Turso.
 *
 * Se resuelve el `id` a `slug` contra el catálogo (el mantenedor sigue trabajando con
 * ids) y se valida con `vtuberUpdateSchema`, el MISMO esquema que usa el Express: si la
 * validación fuera otra, una edición aceptada en local podría ser rechazada en
 * producción y el mantenedor tendría dos comportamientos.
 */
async function editarVtuber(request, id) {
  const db = getDb();
  const actual = db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(Number(id));
  if (!actual) return NextResponse.json({ error: 'no_encontrado' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = vtuberUpdateSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'payload_invalido', issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }
  const guardado = await guardarEdicion(actual.slug, parsed.data);
  if (!guardado) {
    return NextResponse.json({ error: 'sin_cambios', slug: actual.slug }, { status: 400 });
  }
  /**
   * El detalle COMPLETO, no un acuse.
   *
   * El cliente hace `setSelected(await api.updateVtuber(...))` (`admin-page.tsx`). Al devolver
   * `{ok, slug, editado}`, ese objeto pasaba a ser la ficha seleccionada: sin `name`, sin
   * `assets`, sin `images` — con los campos en `undefined`, el formulario aparecía vacío
   * después de guardar. El Express devuelve `res.json(updated)` desde siempre, así que este es
   * el contrato correcto y el que el tipo `VtuberDetail` del cliente declara.
   */
  const detalle = await detalleConReemplazos(db, actual.slug);
  return NextResponse.json(detalle);
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
  const db = getDb();
  const actual = db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(Number(id));
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
  const db = getDb();
  const actual = db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(Number(id));
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
 * El estado es una edición más, así que va a Turso como cualquier otro campo. Se hace en
 * un solo `batch` para que sean una operación y no N viajes.
 */
async function estadoMasivo(request) {
  const body = await request.json().catch(() => null);
  const ids = Array.isArray(body?.ids) ? body.ids : null;
  if (!ids || !body?.status) {
    return NextResponse.json({ error: 'payload_invalido', detail: 'ids[] y status' }, { status: 400 });
  }
  const db = getDb();
  const lugar = ids.map(() => '?').join(',');
  const filas = db.prepare(`SELECT slug FROM vtuber WHERE id IN (${lugar})`).all(...ids.map(Number));
  const actualizados = await guardarEdicionMasiva(filas.map((f) => f.slug), 'status', body.status);
  return NextResponse.json({ ok: true, actualizados, status: body.status });
}

export async function GET(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'GET');
  if (!tursoConfigurado()) {
    return noDisponible('el mantenedor solo existe en local: en Vercel hace falta TURSO_DATABASE_URL');
  }
  const { path } = await context.params;
  const sufijo = Array.isArray(path) ? path.join('/') : (path ?? '');
  if (sufijo === 'session') return sesionTurso(request);
  if (sufijo === 'stats') {
    const [, negado] = await exigirSesion(request);
    if (negado) return negado;
    return estadisticas();
  }
  // `audit` va vacío a propósito: el registro vive en `audit_log`, que la base que se
  // despliega sanea (contiene el hash de la contraseña). Se devuelve `{items: []}` para que
  // la UI muestre "sin registros" en vez de un error que parecería una avería.
  if (sufijo === 'audit') {
    const [, negado] = await exigirSesion(request);
    if (negado) return negado;
    return NextResponse.json({ items: [] });
  }
  return noDisponible(`ruta del mantenedor no soportada en producción: ${sufijo}`);
}

export async function PATCH(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'PATCH');
  if (!tursoConfigurado()) {
    return noDisponible('el mantenedor solo existe en local: en Vercel hace falta TURSO_DATABASE_URL');
  }
  const [, negado] = await exigirSesion(request);
  if (negado) return negado;
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  if (partes[0] === 'vtubers' && partes[1]) return editarVtuber(request, partes[1]);
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}

export async function POST(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'POST');
  if (!tursoConfigurado()) {
    return noDisponible('el mantenedor solo existe en local: en Vercel hace falta TURSO_DATABASE_URL');
  }
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  // El login es la ÚNICA ruta sin sesión: es la que la crea.
  if (partes[0] === 'login') return login(request);
  if (partes[0] === 'logout') return logout(request);
  const [, negado] = await exigirSesion(request);
  if (negado) return negado;
  if (partes[0] === 'vtubers' && partes[1] === 'bulk-status') return estadoMasivo(request);
  if (partes[0] === 'vtubers' && partes[1] && partes[2] === 'image' && partes[3]) {
    return subirImagen(request, partes[1], partes[3]);
  }
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}

export async function DELETE(request, context) {
  if (ADMIN_UPSTREAM) return reenviar(request, context, 'DELETE');
  if (!tursoConfigurado()) {
    return noDisponible('el mantenedor solo existe en local: en Vercel hace falta TURSO_DATABASE_URL');
  }
  const [, negado] = await exigirSesion(request);
  if (negado) return negado;
  const { path } = await context.params;
  const partes = Array.isArray(path) ? path : [path];
  if (partes[0] === 'vtubers' && partes[1] && partes[2] === 'image' && partes[3]) {
    return borrarImagen(partes[1], partes[3]);
  }
  return noDisponible(`ruta del mantenedor no soportada en producción: ${partes.join('/')}`);
}
