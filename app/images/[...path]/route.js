/**
 * `GET /images/*` — sirve una imagen publicada.
 *
 * En Vercel las imágenes no viajan en el repositorio ni en el bundle de la
 * función: viven en Blob (64 MB no tienen sitio en ninguno de los dos), así que
 * en producción esta ruta resuelve la ruta canónica contra el manifiesto y
 * responde un **301 a Blob**.
 *
 * En LOCAL no hay Blob (`VTUBERDEX_BLOB_BASE` sin definir) y las imágenes están
 * en `data/images/`: ahí se lee el archivo del disco y se devuelve tal cual. Sin
 * esta rama, `npm run dev` mostraba la app entera sin imágenes — el 301 apuntaba
 * a una base vacía y todo salía roto, justo lo que uno necesita ver bien cuando
 * prueba en local.
 *
 * Dos decisiones que importan:
 *   · Una ruta desconocida da **404 explícito**, no un redirect a ninguna parte.
 *     Un 302 ciego convertiría cada imagen que falta en un error confuso de Blob.
 *   · El **301** de producción es seguro porque la ruta pública es estable: si
 *     cambia el contenido, el scraper reescribe el MISMO archivo canónico por slug.
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { resolveImageUrl, usesLocalImages } from '../../../lib/db.mjs';
import { leerAssetRemoto, tursoConfigurado } from '../../../lib/ediciones.mjs';
import { CARPETAS_PUBLICADAS } from '../../../lib/carpetas.mjs';

export const dynamic = 'force-dynamic';

/** Tipo por extensión. Las carpetas publicadas son `.webp` y `.png` (emblemas). */
const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

/**
 * Raíz de las imágenes locales.
 *
 * Escrita literal a propósito: componerla con `path.resolve(process.cwd(), x)`
 * dentro de un bucle hace que Turbopack lo detecte como acceso dinámico al
 * sistema de archivos y trace el proyecto ENTERO dentro de cada función (aviso
 * explícito del build).
 */
const LOCAL_IMAGE_ROOT = path.join(process.cwd(), 'data', 'images');

/**
 * Raíz de los reemplazos del mantenedor bajados de Turso (`npm run download:images`).
 *
 * POR QUÉ ESTÁ APARTE DE `data/images/` Y NO ENCIMA
 * -------------------------------------------------
 * Las dos fuentes escriben el mismo nombre canónico, así que dejarlas en el mismo árbol mezcla
 * el contenido del mantenedor con el del catálogo. Lo que rompe no es esta ruta: es
 * `scripts/build-db.mjs`, que arma el MANIFIESTO desde las filas `asset` de la base local, y el
 * manifiesto es la lista de lo que sube `publish-images.mjs`. Con los bytes del mantenedor en
 * `data/images/` el manifiesto pasó de 1594 a 1625 objetos, y una corrida del publicador habría
 * subido ese contenido **como `origen = 'catalogo'`**, destruyendo la imagen original del
 * catálogo en Turso (una sola fila por `(slug, kind, origen)`, sin copia de debajo).
 *
 * Con la carpeta separada esa contaminación es IMPOSIBLE por construcción, y aquí solo hay que
 * decidir la precedencia en la LECTURA: gana el reemplazo, porque así sirve la API cuando hay
 * Turso (`leerAssetRemoto` hace ganar a `origen = 'mantenedor'`). Si esta carpeta no existe, la
 * app se comporta exactamente como antes: sirve el catálogo y nada más.
 *
 * Escrita literal por la misma razón que `LOCAL_IMAGE_ROOT`: componerla dinámicamente hace que
 * Turbopack trace el proyecto entero dentro de cada función.
 */
const REEMPLAZOS_IMAGE_ROOT = path.join(process.cwd(), 'data', 'mantenedor');

/**
 * Comprueba que la ruta resuelta no se escape de su raíz (`../`).
 *
 * Recibe la raíz porque ahora hay DOS árboles locales: el del catálogo y el de los reemplazos
 * del mantenedor. Con la raíz fija de antes, servir un reemplazo habría dado `no_encontrado`
 * sin ningún error visible.
 */
function isInsideRoot(filePath, raiz = LOCAL_IMAGE_ROOT) {
  const rel = path.relative(raiz, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * `ETag` de un archivo local, derivado de su mtime + tamaño.
 *
 * POR QUÉ HACE FALTA (y por qué no basta con un `max-age` bajo)
 * ------------------------------------------------------------
 * En local el disco es la fuente de verdad y el mantenedor (Express) reescribe el MISMO
 * archivo canónico al reemplazar una imagen. Con `max-age=3600` el navegador se quedaba
 * con el búfer anterior una HORA: la imagen nueva estaba en disco y la vista seguía
 * pintando la vieja — exactamente el síntoma de "subo una imagen y no se actualiza".
 *
 * Bajar el `max-age` a 60 no arregla el problema, solo lo acorta, y quitar la caché sin
 * más obligaría a transferir cada imagen en cada visita. Revalidar SÍ lo arregla: el
 * navegador vuelve a preguntar y el servidor responde 304 (sin cuerpo) mientras el
 * archivo no cambie. El `ETag` sale del `mtime` y el tamaño, que es lo que cambia cuando
 * el mantenedor reescribe el archivo.
 */
function etagDeArchivo(absolute, bytes) {
  try {
    const { mtimeMs, size } = statSync(absolute);
    return `"${Math.round(mtimeMs).toString(36)}-${size.toString(36)}"`;
  } catch {
    // Sin `stat` (carrera con un borrado) se cae al tamaño, que sigue siendo un validador
    // útil: el archivo que se acaba de escribir casi nunca mide lo mismo que el anterior.
    return `"${bytes.byteLength.toString(36)}"`;
  }
}

/**
 * `Last-Modified` a partir de la marca guardada en la fila.
 *
 * Acepta los dos formatos que conviven en la tabla: el ISO con milisegundos que escribe la
 * subida desde hoy y el `datetime('now')` (`2026-09-23 15:23:32`, sin zona) de las filas
 * antiguas. Devuelve `null` si no se puede interpretar: una cabecera inválida rompería la
 * respuesta entera, y `Last-Modified` es un extra, no un requisito.
 */
function fechaDeMarca(marca) {
  const normalizada = String(marca ?? '').includes('T') ? String(marca) : `${String(marca).replace(' ', 'T')}Z`;
  const fecha = new Date(normalizada);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toUTCString();
}

/** Lee la imagen de un árbol local; `null` si no existe o la ruta es sospechosa. */
function serveLocal(key, etagPedido, raiz = LOCAL_IMAGE_ROOT) {
  const absolute = path.join(raiz, key.replace(/^images\//, ''));
  if (!isInsideRoot(absolute, raiz)) return null;

  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return null;
  }
  const type = CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream';
  const etag = etagDeArchivo(absolute, bytes);
  /**
   * El 304 tiene que responder ANTES de mandar los bytes: si el navegador ya tiene esa
   * versión, enviarla de nuevo es el coste que la revalidación existe para evitar.
   */
  if (etagPedido && etagPedido === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': 'no-cache' },
    });
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': type,
      etag,
      /**
       * `no-cache` NO significa "no guardes": significa "guarda, pero revalida antes de
       * usarlo". Es lo correcto aquí porque el archivo de disco SÍ puede cambiar entre dos
       * peticiones (lo reescribe el mantenedor) y la revalidación es un 304 barato sin
       * cuerpo. En producción la rama de Turso sigue con caché larga: allí las URLs van
       * versionadas por la subida (ver `aplicarImagenesDelMantenedor`).
       */
      'cache-control': 'no-cache',
      'content-length': String(bytes.byteLength),
    },
  });
}

export async function GET(request, { params }) {
  const { path: segments } = await params;
  const key = `images/${Array.isArray(segments) ? segments.join('/') : segments}`;
  /**
   * El validador que manda el cliente, si lo manda.
   *
   * Se lee de la petición y no del `query`: la versión `?v=` de la URL identifica la
   * REVISIÓN del recurso, mientras que `If-None-Match` es lo que el navegador usa para
   * preguntar "¿sigue valiendo lo que tengo?". Son dos cosas distintas y la segunda es la
   * que convierte una revalidación en un 304 sin cuerpo.
   */
  const etagPedido = request.headers.get('if-none-match');

  /**
   * El manifiesto decide qué se sirve, pero solo para las carpetas PUBLICADAS.
   *
   * Antes esto era `published = Boolean(resolveImageUrl(key))` a secas, y ahí estaba el
   * segundo fallo de la subida en producción: el manifiesto lo genera `npm run build:data` a
   * partir de las filas `asset` de la base, así que **una imagen recién subida no está en él**.
   * Al condicionar la consulta a Turso a `published`, el fondo que alguien acababa de subir
   * daba 404 con sus bytes ya guardados y visibles en el gestor.
   *
   * El propósito del manifiesto es que una CARPETA RETIRADA (`radar`, `thumb`, `ficha`,
   * `avatar`) responda 404 aunque su archivo siga existiendo. Eso se conserva tal cual: si la
   * carpeta no es una de las publicadas, se corta aquí. Dentro de una carpeta publicada, la
   * fila de Turso manda: es donde el mantenedor escribe.
   */
  const carpeta = key.split('/')[1];
  if (!CARPETAS_PUBLICADAS.includes(carpeta)) {
    return Response.json({ error: 'imagen_no_publicada', path: key }, { status: 404 });
  }
  const published = Boolean(resolveImageUrl(key));

  /**
   * EL ORDEN DE LAS FUENTES IMPORTA, y este es el bug que apareció en producción.
   *
   * `usesLocalImages()` decide "modo local" mirando si hay `VTUBERDEX_BLOB_BASE`. Eso era
   * correcto cuando las imágenes venían de Blob, pero ahora vienen de **Turso**, y en
   * Vercel esa variable NO está definida: la ruta se creía en local, buscaba el archivo
   * en `data/images/` (que no existe en el deploy) y respondía 404 `imagen_no_publicada`
   * **para las 1.593 imágenes que sí estaban subidas**. El catálogo funcionaba y las
   * imágenes no, que es el síntoma exacto que se vio en producción.
   *
   * Así que Turso se consulta PRIMERO y la rama local solo se alcanza cuando no hay
   * ningún almacén externo configurado (el `npm run dev` de siempre).
   */
  if (tursoConfigurado()) {
    const remoto = await leerAssetRemoto(key);
    if (remoto) {
      /**
       * El `ETag` sale de la marca de la fila (`actualizado`), que es la MISMA que versiona
       * la URL del catálogo: si el navegador manda `If-None-Match` con la versión que ya
       * tiene, la respuesta correcta es un 304 sin cuerpo — ni la imagen viaja, ni el CDN
       * se llena de copias nuevas solo porque cambió el query.
       */
      const etag = remoto.actualizado ? `"${String(remoto.actualizado).replace(/[^0-9]/g, '')}"` : null;
      if (etag && etagPedido === etag) {
        return new Response(null, { status: 304, headers: { etag } });
      }
      /**
       * Si la URL trae la versión (`?v=`) Y coincide con la marca de la fila, el contenido de ESA
       * URL ya no puede cambiar: reemplazar o restaurar la imagen produce otra versión y, con
       * ella, otra URL. Se puede cachear un año como `immutable`, sin revalidar ni en el borde
       * ni en el navegador. Sin versión, o con una versión que ya no es la vigente, se queda la
       * caché corta de abajo (la copia vieja no puede vivir mucho).
       */
      const versionPedida = new URL(request.url).searchParams.get('v');
      const marca = remoto.actualizado ? String(remoto.actualizado).replace(/\D/g, '') : '';
      const versionVigente = Boolean(versionPedida) && versionPedida === marca;
      return new Response(remoto.bytes, {
        status: 200,
        headers: {
          'content-type': remoto.mime,
          ...(etag ? { etag, 'last-modified': fechaDeMarca(remoto.actualizado) } : {}),
          /**
           * Caché CORTA a propósito. El mantenedor puede reemplazar esta imagen y, al
           * restaurarla, la copia antigua sigue viva en el CDN de Vercel: con
           * `s-maxage=3600` el usuario veía la imagen reemplazada hasta una HORA después
           * de haberla restaurado. Comprobado en producción (con `?bust=` salía la del
           * catálogo y sin él la vieja). Cinco minutos de CDN y uno de navegador son
           * suficiente protección de cuota y no dejan una imagen obsoleta a la vista.
           */
          'cache-control': versionVigente
            ? 'public, max-age=31536000, s-maxage=31536000, immutable'
            : 'public, max-age=60, s-maxage=300',
          'content-length': String(remoto.bytes.byteLength),
        },
      });
    }
    /**
     * Con Turso configurado, lo que no está en la base NO se busca en otro sitio: se
     * responde 404 explícito. Antes esto caía al 301 de Blob, y como la tienda de Blob
     * quedó **bloqueada** (`403 Your store is blocked`), ese rodeo convertía una imagen
     * que falta en un error ajeno y confuso en vez de decir que no está.
     */
    return Response.json({ error: 'imagen_no_publicada', path: key }, { status: 404 });
  }

  if (usesLocalImages()) {
    /**
     * MODO LOCAL: primero el REEMPLAZO del mantenedor, después el catálogo de `data/images/`.
     *
     * PRECEDENCIA: es la misma que sirve la API cuando hay Turso (`leerAssetRemoto` ordena
     * `origen = 'mantenedor'` primero), así que la vista local y la de producción muestran la
     * MISMA imagen. Si esta rama fuera al revés, bajar los reemplazos no serviría de nada: se
     * seguiría viendo el catálogo.
     *
     * POR QUÉ LOS REEMPLAZOS NO ESTÁN EN `data/images/`
     * ------------------------------------------------
     * Porque ese árbol es la fuente del MANIFIESTO (`scripts/build-db.mjs` lo arma desde las filas
     * `asset` de la base local) y el manifiesto es la lista de lo que publica
     * `publish-images.mjs`. Tener ahí los bytes del mantenedor hacía que el publicador pudiera
     * subirlos **como `origen = 'catalogo'`**, destruyendo la imagen original del catálogo en
     * Turso. Aparte quedan dos cosas separadas y la contaminación es imposible, no improbable.
     *
     * Ninguna de las dos ramas exige estar en el manifiesto: en LOCAL el disco es la fuente de
     * verdad —lo que hay es lo que se acaba de subir— y `isInsideRoot` sigue impidiendo salir de
     * su carpeta. En PRODUCCIÓN el manifiesto sigue mandando y la carpeta retirada sigue dando
     * 404: de eso se encargan las ramas de arriba, que se evalúan antes.
     */
    const reemplazo = serveLocal(key, etagPedido, REEMPLAZOS_IMAGE_ROOT);
    if (reemplazo) return reemplazo;
    const local = serveLocal(key, etagPedido);
    if (local) return local;
    return Response.json({ error: 'imagen_no_publicada', path: key }, { status: 404 });
  }

  if (!published) {
    return Response.json({ error: 'imagen_no_publicada', path: key }, { status: 404 });
  }

  return new Response(null, {
    status: 301,
    headers: {
      location: resolveImageUrl(key),
      // Cache larga en el borde: el nombre del asset es canónico, no versionado.
      'cache-control': 'public, max-age=86400, s-maxage=604800, immutable',
    },
  });
}
