/**
 * Prepara los artefactos que viajan en el deploy de Vercel.
 *
 * En Vercel el sistema de archivos es de SOLO LECTURA, así que nada de lo que
 * la app necesita puede depender de escribir en disco. Por eso el build deja
 * todo listo ANTES de subir:
 *
 *   1. `deploy/data/vtuberdex.db` — copia AUTOCONTENIDA del catálogo (sin WAL)
 *      y con las tablas de credenciales VACÍAS. La base de local guarda el hash
 *      del admin y el registro de auditoría; eso no viaja a producción ni
 *      siquiera como hash, porque en Vercel nadie inicia sesión.
 *   2. `deploy/data/images.json` — manifiesto `ruta -> URL` para que el
 *      adaptador redirija cada imagen a Vercel Blob.
 *
 * Es idempotente y no toca la base de desarrollo: sale del archivo y escribe
 * en `deploy/`.
 *
 * Uso: node scripts/build-db.mjs [--from data/vtuberdex.db] [--out deploy/data]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { CARPETAS_PUBLICADAS } from '../lib/carpetas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const flag = `--${name}`;
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1) || fallback;
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const SRC_DB = path.resolve(ROOT, value('from', 'data/vtuberdex.db'));
const OUT_DIR = path.resolve(ROOT, value('out', 'deploy/data'));
const OUT_DB = path.join(OUT_DIR, 'vtuberdex.db');
const OUT_MANIFEST = path.join(OUT_DIR, 'images.json');

/**
 * `--if-missing` salta el trabajo si los artefactos ya están.
 *
 * Existe por el build de Vercel: allí `data/` NO existe (está ignorado y las
 * imágenes crudas nunca viajan), así que `VACUUM INTO` no tendría origen. Con
 * esta bandera el build usa el artefacto ya versionado en `deploy/` y solo lo
 * regenera quien tiene los datos locales (el scraper y el seed).
 */
const IF_MISSING = args.includes('--if-missing');

/**
 * Tablas que NO deben viajar a producción: identifican al mantenedor y
 * registran su actividad. En Vercel no hay sesiones, así que vaciarlas no quita
 * ninguna función y sí evita publicar un artefacto de autenticación.
 */
const CREDENTIAL_TABLES = ['admin_user', 'audit_log'];

/**
 * Carpetas de imagen que el front realmente pide.
 *
 * Se publican SOLO estas tres, y la lista es deliberadamente corta porque cada
 * carpeta de más son megabytes en Blob y una ruta que nadie va a pedir:
 *
 *   · `character` — la imagen fuente del VTuber (lienzo 720x1008). La usan la
 *     carta 3D, el listado y la ficha.
 *   · `logo`      — la capa superior de la carta.
 *   · `faction`   — el emblema de facción que la carta superpone.
 *
 * Quedaron fuera, y sus archivos ya no están en disco:
 *   · `thumb`  — ninguna vista la pedía (18 MB).
 *   · `avatar` — duplicado legacy de `character` (13 MB).
 *   · `ficha`  — la ficha apaisada del sitio; era el respaldo de `character` y
 *                hoy los 785 lo tienen, así que nunca se mostraba (33 MB).
 *   · `radar`  — el gráfico de atributos. Se DIBUJA desde los datos con
 *                `StatBars` en la misma página, así que la imagen raster era
 *                redundante (8 MB).
 *   · `card`   — vacía desde siempre.
 */
const USED_FOLDERS = CARPETAS_PUBLICADAS;

function stripCredentials(db) {
  const removed = {};
  for (const table of CREDENTIAL_TABLES) {
    const before = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
    db.exec(`DELETE FROM ${table}`);
    removed[table] = before;
  }
  return removed;
}

/**
 * Reescribe el archivo para que no queden rastros de lo borrado.
 *
 * `DELETE` en SQLite NO borra los datos: marca las páginas como libres y los
 * bytes siguen ahí, recuperables con `strings`. Comprobado: tras vaciar
 * `admin_user`, el archivo seguía conteniendo el hash de la contraseña del
 * mantenedor y el nombre de usuario, listos para viajar al repositorio.
 *
 * `VACUUM` reconstruye el archivo desde cero y deja fuera esas páginas, así que
 * la base publicada no conserva ni el hash ni ningún resto del registro que se
 * quiso eliminar.
 */
function vacuumAwayDeletedRows(db) {
  db.exec('VACUUM');
}

/**
 * Rutas de asset referenciadas por la base.
 *
 * Se normalizan a `images/<carpeta>/<archivo>`, que es la clave que usan tanto
 * el manifiesto como el adaptador de Vercel (`/images/*` -> Blob) y la ruta
 * relativa a `data/` para comprobar que el archivo existe en disco.
 *
 * Se recogen DOS fuentes, y las dos hacen falta:
 *   · `asset`        — personaje, logo, radar (etc.) de cada VTuber.
 *   · `faction.icon` — el emblema de cada facción, que la carta 3D superpone
 *                      como holograma. Vive SOLO en esta columna: mirar únicamente
 *                      `asset` dejaba fuera los 23 emblemas y la capa de
 *                      facciones de la carta se quedaba sin texturas en prod.
 *
 * En la base las rutas vienen con barra inicial (`/images/...`) porque se sirven
 * desde la raíz del sitio: sin normalizar, la carpeta se leía como "images" y no
 * coincidía con ninguna publicable.
 */
function assetPaths(db) {
  const rows = [
    ...db.prepare(`SELECT path AS p FROM asset WHERE path IS NOT NULL`).all(),
    ...db.prepare(`SELECT icon AS p FROM faction WHERE icon IS NOT NULL`).all(),
  ];
  const unique = new Set(
    rows.map((row) => `images/${String(row.p).replace(/^\/?images\//, '')}`),
  );
  unique.delete('images/');
  return [...unique];
}

function buildDatabase() {
  if (!fs.existsSync(SRC_DB)) {
    console.error(`✖ falta la base de origen: ${SRC_DB} (corre: cd server && npm run seed)`);
    process.exit(1);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const src = new DatabaseSync(SRC_DB, { readOnly: true });
  // `VACUUM INTO` produce un archivo único y autocontenido: sin él, el destino
  // heredaría el modo WAL y el deploy llevaría una base que necesita escribir
  // los .wal/.shm al abrir, imposible con el FS de solo lectura.
  if (fs.existsSync(OUT_DB)) fs.rmSync(OUT_DB);
  src.exec(`VACUUM INTO '${OUT_DB.replace(/'/g, "''")}'`);
  const paths = assetPaths(src);
  const counts = {
    vtubers: src.prepare('SELECT COUNT(*) AS n FROM vtuber').get().n,
    assets: src.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
  };
  src.close();

  // El saneado se hace sobre la COPIA ya materializada.
  const out = new DatabaseSync(OUT_DB);
  out.exec('PRAGMA journal_mode = DELETE');
  const removed = stripCredentials(out);
  // `DELETE` deja los bytes en las páginas liberadas: sin este VACUUM, el hash
  // de la contraseña del mantenedor seguía siendo recuperable del archivo que se
  // publica. Va ANTES de escribirlo en `meta` para que el VACUUM tampoco deje
  // rastro de esa escritura.
  vacuumAwayDeletedRows(out);
  // Se deja constancia en `meta` de que el artefacto está saneado: así el
  // propio deploy puede demostrarlo sin inspeccionar tablas.
  out
    .prepare(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
    .run('build_sanitized_at', new Date().toISOString());
  let integrity = null;
  try {
    integrity = out.prepare('PRAGMA integrity_check').get()?.integrity_check ?? null;
  } catch {
    integrity = 'no_comprobado';
  }
  out.close();

  // Comprobación de que el saneado fue REAL: si los bytes del hash siguieran
  // ahí, el artefacto no debe publicarse ni versionarse.
  //
  // Se busca la FORMA del hash (`scrypt$<salt>$<derivado>`, que es lo que
  // escribe `server/src/auth.mjs`), no la palabra "password_hash": esa aparece
  // en el ESQUEMA de la tabla (`CREATE TABLE admin_user (... password_hash TEXT
  // NOT NULL ...)`), que sí viaja porque el esquema es inofensivo. Buscar la
  // palabra daba un falso positivo permanente.
  const bytes = fs.readFileSync(OUT_DB);
  if (/scrypt\$[0-9a-f]{16,}\$[0-9a-f]{32,}/.test(bytes.toString('latin1'))) {
    console.error('✖ la base saneada TODAVÍA contiene el hash de una credencial');
    process.exit(1);
  }

  return { counts, removed, paths, integrity, bytes: fs.statSync(OUT_DB).size };
}

/**
 * Manifiesto de imágenes.
 *
 * Guarda RUTAS, no URLs: la base de Blob se resuelve en tiempo de ejecución
 * (`VTUBERDEX_BLOB_BASE`), así que apuntar el proyecto a otro store —o desplegar
 * un preview con un store distinto— no obliga a recompilar. `images.json`
 * conserva además las rutas como claves porque es también la lista de lo que
 * está publicado: el publicador y el verificador la leen de aquí.
 *
 * Solo se publican las rutas que la BASE referencia y que pertenecen a una
 * carpeta que el front usa. Quedan fuera a propósito:
 *   · `thumb`  — la referencia la base pero NO el front (verificado: ninguna
 *                vista la pide); publicarla sería subir 18 MB para nadie.
 *   · `avatar` — duplicado legacy de `character` (misma imagen, dos claves).
 *   · `ficha`  — la ficha apaisada del sitio; el respaldo de la carta. Hoy los
 *                785 tienen `character`, así que no se publica.
 */
function buildManifest(paths, blobBase) {
  const byFolder = {};
  const missing = [];
  const included = [];
  for (const rel of paths) {
    // `images/<carpeta>/<archivo>.webp` -> carpeta y ruta en disco bajo data/.
    const folder = rel.split('/')[1];
    if (!USED_FOLDERS.includes(folder)) continue;
    const abs = path.join(ROOT, 'data', rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    byFolder[folder] = (byFolder[folder] ?? 0) + 1;
    included.push({ path: rel, bytes: fs.statSync(abs).size });
  }
  included.sort((a, b) => a.path.localeCompare(b.path));
  const images = {};
  for (const item of included) {
    // La clave es la ruta canónica (`images/<carpeta>/<slug>.webp`), que es
    // también el `pathname` del blob: el publicador sube con esa misma clave.
    images[item.path] = item.path;
  }
  return {
    manifest: {
      generatedAt: new Date().toISOString(),
      blobBase: blobBase.replace(/\/$/, ''),
      folders: byFolder,
      count: included.length,
      totalBytes: included.reduce((total, item) => total + item.bytes, 0),
      images,
    },
    missing,
  };
}

/**
 * ¿Hay que hacer el trabajo?
 *
 * Con `--if-missing` (el modo del build de Vercel) se reutiliza lo que ya esté
 * construido: sin `data/` no habría de dónde sacar la base, y lo que importa es
 * que el artefacto ESTÉ, no de dónde venga. Sin la bandera se reconstruye
 * siempre, que es lo que quieren el scraper y el seed tras cambiar el dataset.
 */
if (IF_MISSING && fs.existsSync(OUT_DB) && fs.existsSync(OUT_MANIFEST)) {
  console.log(`[build-db] ya existen los artefactos en ${path.relative(ROOT, OUT_DIR)}; se reutilizan`);
  process.exit(0);
}

const BLOB_BASE = value('blob-base', process.env.VTUBERDEX_BLOB_BASE ?? '');
const { counts, removed, paths, integrity, bytes } = buildDatabase();
const { manifest, missing } = buildManifest(paths, BLOB_BASE);
fs.writeFileSync(OUT_MANIFEST, JSON.stringify(manifest, null, 1));

console.log(`[build-db] base -> ${path.relative(ROOT, OUT_DB)} (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
console.log(`[build-db] integridad: ${integrity} | vtubers: ${counts.vtubers} | assets: ${counts.assets}`);
console.log(`[build-db] credenciales eliminadas: ${JSON.stringify(removed)}`);
console.log(`[build-db] imágenes publicables: ${manifest.count} (${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB) ${JSON.stringify(manifest.folders)}`);
if (missing.length > 0) {
  console.log(`[build-db] ⚠ ${missing.length} rutas de asset referenciadas pero ausentes en disco (muestra): ${missing.slice(0, 5).join(', ')}`);
}
