/**
 * Acceso al catálogo desde las rutas de Next.js.
 *
 * La base viene EMPAQUETADA en la función (ver `outputFileTracingIncludes` en
 * `next.config.mjs`) y se abre en SOLO LECTURA: el sistema de archivos de Vercel
 * es inmutable y SQLite no podría escribir su journal. Abrirla así funciona
 * —incluido FTS5— y es lo que hace posible servir el catálogo real sin ninguna
 * base de datos externa.
 *
 * Se cachea a nivel de módulo porque en producción la app se reutiliza entre
 * peticiones (Fluid compute): abrir la base en cada una sería pagar el coste de
 * nuevo para un archivo que no cambia.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openDatabase } from '../server/src/db/index.mjs';

/**
 * Rutas de los artefactos del deploy.
 *
 * Se resuelven de forma ESTÁTICA a propósito. La primera versión probaba varias
 * raíces con `path.resolve(process.cwd(), ...)` dentro de un bucle, y el
 * empaquetador de Next (Turbopack) lo detectó como acceso dinámico al sistema de
 * archivos: al no poder acotar qué se lee, **traza el proyecto entero** y lo
 * mete en cada función. Eso hincha el deploy y puede pasarse de los límites de
 * tamaño de Vercel.
 *
 * Con las rutas escritas literalmente, el trazador ve `deploy/data/...` y solo
 * incluye eso (más lo que declara `outputFileTracingIncludes`). En servidor
 * serverless el directorio de trabajo ES la raíz del proyecto, así que basta con
 * `process.cwd()`, y en local coincide porque los scripts se ejecutan desde la
 * raíz del repo.
 */
const DB_PATH = process.env.VTUBERDEX_DB ?? path.join(process.cwd(), 'deploy', 'data', 'vtuberdex.db');
const MANIFEST_PATH = path.join(process.cwd(), 'deploy', 'data', 'images.json');

let cachedDb = null;
let cachedManifest = null;

/** Base del catálogo, en solo lectura. Se abre una vez por instancia. */
export function getDb() {
  if (!cachedDb) cachedDb = openDatabase(DB_PATH, { readonly: true });
  return cachedDb;
}

/**
 * Manifiesto de imágenes publicadas: `images/<carpeta>/<archivo>` -> ruta del blob.
 *
 * Guarda rutas canónicas y no URLs a propósito: la base de Blob se resuelve en
 * tiempo de ejecución (`VTUBERDEX_BLOB_BASE`), así que apuntar el proyecto a otro
 * store no obliga a reconstruir nada.
 *
 * Si el archivo no está o no se puede parsear se devuelve un mapa vacío: así cada
 * imagen responde un 404 claro en vez de tumbar la app entera, que es el fallo
 * que importa cuando lo único roto es el manifiesto.
 */
export function getImageManifest() {
  if (cachedManifest) return cachedManifest;
  try {
    cachedManifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')).images ?? {};
  } catch {
    cachedManifest = {};
  }
  return cachedManifest;
}

/**
 * URL pública de una imagen del manifiesto, o `null` si no está publicada.
 *
 * Dos modos, y el orden importa:
 *
 *   1. **Con `VTUBERDEX_BLOB_BASE`** (producción) se sirve desde Blob, que es
 *      donde viven las imágenes: no viajan en el bundle.
 *   2. **Sin ella** (desarrollo local) se devuelve la ruta RELATIVA al propio
 *      sitio (`/images/...`). Así `npm run dev` muestra las imágenes reales de
 *      `data/images/` sin obligar a tener Blob configurado ni a resubir 64 MB
 *      para trabajar. Antes esto devolvía `null` y toda la app local salía sin
 *      una sola imagen, que es una trampa difícil de diagnosticar.
 *
 * La firma devuelve una URL lista para el `<img src>`: quien la consume no tiene
 * que saber de dónde sale.
 */
export function resolveImageUrl(key) {
  const rel = getImageManifest()[key];
  if (!rel) return null;
  const base = process.env.VTUBERDEX_BLOB_BASE ?? '';
  if (!base) return `/${rel}`;
  return `${base.replace(/\/$/, '')}/${rel}`;
}

/**
 * ¿Estamos en modo local (sin Blob)?
 *
 * Lo usa la ruta `/images/*`: en producción responde un 301 a Blob, pero en local
 * Blob no existe, así que ahí tiene que servir el archivo de `data/images/`.
 */
export function usesLocalImages() {
  return !(process.env.VTUBERDEX_BLOB_BASE ?? '');
}

export { DB_PATH, MANIFEST_PATH };
