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
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { resolveImageUrl, usesLocalImages } from '../../../lib/db.mjs';
import { leerAssetRemoto, tursoConfigurado } from '../../../lib/ediciones.mjs';

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

/** Comprueba que la ruta resuelta no se escape de `data/images/` (`../`). */
function isInsideRoot(filePath) {
  const rel = path.relative(LOCAL_IMAGE_ROOT, filePath);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Lee la imagen de `data/images/`; `null` si no existe o la ruta es sospechosa. */
function serveLocal(key) {
  const absolute = path.join(LOCAL_IMAGE_ROOT, key.replace(/^images\//, ''));
  if (!isInsideRoot(absolute)) return null;

  let bytes;
  try {
    bytes = readFileSync(absolute);
  } catch {
    return null;
  }
  const type = CONTENT_TYPES[path.extname(absolute).toLowerCase()] ?? 'application/octet-stream';
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': type,
      // El nombre del asset es canónico por slug, así que el contenido de una
      // ruta no cambia de forma silenciosa.
      'cache-control': 'public, max-age=3600',
      'content-length': String(bytes.byteLength),
    },
  });
}

export async function GET(_request, { params }) {
  const { path: segments } = await params;
  const key = `images/${Array.isArray(segments) ? segments.join('/') : segments}`;

  // El manifiesto se consulta en los DOS modos: así una carpeta retirada
  // (`radar`, `thumb`, `ficha`, `avatar`) da 404 también en local aunque sus
  // archivos siguieran en disco.
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
    const remoto = published ? await leerAssetRemoto(key) : null;
    if (remoto) {
      return new Response(remoto.bytes, {
        status: 200,
        headers: {
          'content-type': remoto.mime,
          /**
           * Caché CORTA a propósito. El mantenedor puede reemplazar esta imagen y, al
           * restaurarla, la copia antigua sigue viva en el CDN de Vercel: con
           * `s-maxage=3600` el usuario veía la imagen reemplazada hasta una HORA después
           * de haberla restaurado. Comprobado en producción (con `?bust=` salía la del
           * catálogo y sin él la vieja). Cinco minutos de CDN y uno de navegador son
           * suficiente protección de cuota y no dejan una imagen obsoleta a la vista.
           */
          'cache-control': 'public, max-age=60, s-maxage=300',
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
     * MODO LOCAL: se sirve el archivo de `data/images/` DIRECTAMENTE, sin exigir que
     * esté en el manifiesto.
     *
     * POR QUÉ (fallo medido): antes esta rama era `published ? serveLocal(key) : null`,
     * es decir, la lectura de disco estaba CONDICIONADA al manifiesto. El manifiesto lo
     * genera `npm run build:data` a partir de las filas `asset` de la base, así que una
     * imagen recién subida desde el mantenedor no está en él hasta que se regenera. El
     * resultado era un 404 para el archivo que el usuario acababa de subir, con el
     * archivo presente en disco: el síntoma exacto "subo una imagen y no se actualiza".
     *
     * En LOCAL el disco es la fuente de verdad —lo que hay en `data/images/` es lo que
     * se acaba de subir—, y `isInsideRoot` sigue impidiendo salir de la carpeta.
     *
     * En PRODUCCIÓN el manifiesto sigue mandando y la carpeta retirada sigue dando 404:
     * de eso se encargan las dos ramas de arriba, que se evalúan antes y son las que
     * cubre `npm run verify` (`sirve solo lo publicado` + `carpeta retirada -> 404`).
     *
     * Lo que NO se pierde: la carpeta retirada que EXISTA en disco. Si algún día
     * reaparece un `data/images/radar/`, sus archivos se servirían en local; en
     * producción seguirían dando 404. Se acepta a cambio de que el ciclo
     * subir -> ver funcione, que es el propósito de este script.
     */
    const local = serveLocal(key);
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
