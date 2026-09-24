/**
 * Baja a `data/mantenedor/` los reemplazos de imagen que solo existen en Turso.
 *
 * POR QUÉ EXISTE
 * --------------
 * El mantenedor escribe en Turso, y esa mitad del contenido **no está en ningún disco**: los
 * bytes viven en el BLOB de `asset_remoto`. Sin bajarlos no hay respaldo (Turso ES el
 * respaldo) y el entorno local —que corre SIN credenciales, así que usa la rama de disco de
 * `app/images/[...path]/route.js`— pinta las imágenes del scrape mientras producción pinta
 * las nuevas. Medido cuando se escribió: de 87 filas `origen = 'mantenedor'`, **cero**
 * coincidían con el disco y 30 de los 31 fondos no existían allí.
 *
 * POR QUÉ A `data/mantenedor/` Y NO A `data/images/` (esto ya costó una vez)
 * -----------------------------------------------------------------------
 * Las dos fuentes escriben el MISMO archivo canónico (`data/images/<carpeta>/<slug>.webp`),
 * así que bajar la del mantenedor encima de la del catálogo contamina el artefacto
 * desplegable. Medido, y es el fallo que este diseño arregla:
 *
 *   · El MANIFIESTO sale de las filas `asset` de la base local (`scripts/build-db.mjs`), así
 *     que dejarlas apuntando a los bytes del mantenedor metió esas 31 claves en
 *     `deploy/data/images.json`: pasó de 1594 a 1625 objetos y de 1 a 32 fondos.
 *   · El manifiesto es la lista de lo que publica `publish-images.mjs`, y el publicador
 *     compara TAMAÑO de disco contra Turso. Con el manifiesto contaminado, una corrida suya
 *     habría subido el contenido del mantenedor **como `origen = 'catalogo'`, destruyendo la
 *     imagen original del catálogo** (una sola fila por `(slug, kind, origen)`: no hay copia
 *     de debajo). La poda de residuos, en sentido contrario, igual.
 *   · Y el deploy no es el único camino al desastre: el riesgo toca el almacén COMPARTIDO,
 *     porque la base local es la que genera el manifiesto.
 *
 * `data/mantenedor/` es TEMPORAL e ignorada por git, así que:
 *   · `data/images/` queda prístino → el manifiesto y el publicador no pueden contaminarse
 *     POR CONSTRUCCIÓN, no por una guarda que alguien pueda olvidar.
 *   · el deploy no la ve: `vercel deploy` sube la app + `deploy/data/`, nunca `data/`.
 *   · la vista local la usa POR ENCIMA del catálogo, que es la precedencia que sirve la API
 *     (lo que subió una persona gana). Eso lo hace `app/images/[...path]/route.js` en su rama
 *     local, y solo cuando no hay Turso configurado.
 *
 * NO TOCA NINGUNA BASE. Ni la local (el mantenedor local escribe sus propias filas `asset` al
 * subir; una bajada no debe fingir una subida — y esas filas son justo lo que contamina el
 * manifiesto) ni el catálogo de `deploy/`. Es un espejo de bytes hacia un directorio de
 * trabajo: si alguien borra `data/mantenedor/`, no se pierde nada — Turso tiene los originales
 * y volver a correrlo lo reconstruye.
 *
 * ES REANUDABLE E IDEMPOTENTE
 * ---------------------------
 * Compara TAMAÑO por archivo (el mismo criterio que `publish-images.mjs`, en el otro sentido)
 * y escribe un `indice.json` con lo que hay en Turso, que es lo que lee la ruta local para
 * saber qué tapar y con qué versión. Volver a correrlo es la forma de refrescar tras una
 * subida nueva, que es lo normal: el mantenedor está vivo mientras esto se ejecuta (medido: el
 * conjunto pasó de 84 a 99 filas durante el trabajo).
 *
 * CREDENCIALES
 * ------------
 * `--turso-url` / `--turso-token`, o `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` del entorno, o
 * de un `.env` (`--env-file`, por defecto `.env.dev.local`, que es lo que deja `npx vercel env
 * pull --environment=development`). Las de *development* se usan a propósito: en Vercel las de
 * producción están marcadas **sensitive** y la API devuelve un placeholder, no el valor (ver
 * AGENTS.md). Apuntan a la MISMA base, así que sirven igual.
 *
 * Uso:
 *   node scripts/descargar-imagenes.mjs                   # lo que falte (reanudable)
 *   node scripts/descargar-imagenes.mjs --dry-run         # solo informa
 *   node scripts/descargar-imagenes.mjs --forzar          # baja todo otra vez
 *   node scripts/descargar-imagenes.mjs --solo-ediciones  # sin imágenes
 *   node scripts/descargar-imagenes.mjs --env-file .env.dev.local
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createClient } from '@libsql/client/node';

import { EXTENSION_DE_CARPETA, KINDS_GESTIONABLES } from '../lib/carpetas.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * El origen que se baja, y el único.
 *
 * Se declara aquí en vez de importarlo de `lib/ediciones.mjs` para no arrastrar el cliente de
 * Turso a la importación del módulo (este script lo crea él mismo, tras resolver las
 * credenciales). Tiene que coincidir con `ORIGEN_MANTENEDOR` de aquel archivo, y
 * `lib/descarga-imagenes.test.ts` lo comprueba cruzado para que no puedan divergir.
 *
 * El origen `catalogo` NO se baja nunca: no es un reemplazo, ya está en `data/images/` desde
 * el scrape, y bajarlo encima es exactamente lo que contaminaba el manifiesto. Por eso no hay
 * un `--origen`: la única cosa que este script puede bajar es lo que no está en ningún disco.
 */
export const ORIGEN_QUE_SE_BAJA = 'mantenedor';

/**
 * Dónde viven los bytes bajados: carpeta TEMPORAL, fuera del artefacto desplegable.
 *
 * El nombre es deliberado —`mantenedor`, el mismo vocabulario que el `origen` de Turso— para
 * que la correspondencia sea evidente. Ver la cabecera para la razón de no usar `data/images/`.
 */
export const CARPETA_TEMPORAL = path.join('data', 'mantenedor');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const flag = `--${name}`;
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1) || fallback;
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** Lee un `.env` de Vercel (`CLAVE="valor"`) y lo devuelve como objeto. */
export function leerEnvFile(ruta) {
  const env = {};
  for (const linea of fs.readFileSync(ruta, 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

/**
 * Comprueba que un destino es seguro, es decir: que NO es el árbol que se publica.
 *
 * POR QUÉ ES CÓDIGO Y NO UN COMENTARIO
 * ------------------------------------
 * El fallo original de este script fue escribir los reemplazos del mantenedor en
 * `data/images/`, que es de donde sale el manifiesto y, con él, lo que sube
 * `publish-images.mjs`. Un comentario no impide que alguien pase `--destino data/images`
 * "para probar": aquí el script se niega. Se valida por ruta RESUELTA y con el separador, para
 * que `data/images-otra` o un `../` no cuelen por comparación de prefijo de texto.
 *
 * @param {string} destino ruta absoluta ya resuelta
 * @returns {string|null} motivo del rechazo, o `null` si es seguro
 */
export function motivoDestinoInseguro(destino) {
  const prohibidos = [
    { ruta: path.join(ROOT, 'data', 'images'), porque: 'es el árbol del catálogo, y el manifiesto sale de él' },
    { ruta: path.join(ROOT, 'deploy'), porque: 'es el artefacto que se despliega y se versiona' },
  ];
  for (const { ruta, porque } of prohibidos) {
    if (destino === ruta || destino.startsWith(`${ruta}${path.sep}`)) return `${path.relative(ROOT, ruta)} (${porque})`;
  }
  return null;
}

/**
 * Qué archivos hay que bajar y dónde van.
 *
 * Pura a propósito (recibe el `stat` ya resuelto): es la parte con reglas y se prueba sin red
 * ni Turso. Compara TAMAÑO y no presencia por la misma razón que el publicador: el nombre
 * canónico no cambia aunque cambie el contenido, así que "ya existe" dejaría la versión vieja
 * para siempre en el lado que no se miró.
 *
 * @param {Array<{slug: string, kind: string, size: number}>} filas
 * @param {{stat: (abs: string) => number|null, raiz?: string, forzar?: boolean}} opciones
 * @returns {Array<{slug: string, kind: string, abs: string, rel: string, size: number, motivo: string, local: number|null}>}
 */
export function planDeDescarga(filas, { stat, raiz = path.join(ROOT, CARPETA_TEMPORAL), forzar = false }) {
  const plan = [];
  for (const fila of filas) {
    const ext = EXTENSION_DE_CARPETA[fila.kind] ?? 'webp';
    const rel = path.join(fila.kind, `${fila.slug}.${ext}`);
    const abs = path.join(raiz, rel);
    const local = stat(abs);
    const size = Number(fila.size);
    if (forzar) plan.push({ ...fila, abs, rel, size, motivo: 'forzado', local });
    else if (local === null) plan.push({ ...fila, abs, rel, size, motivo: 'falta', local });
    else if (local !== size) plan.push({ ...fila, abs, rel, size, motivo: 'distinto', local });
  }
  return plan;
}

/**
 * El índice que lee la ruta local para saber qué tapar por encima del catálogo.
 *
 * Puro y con UNA definición: lo escriben el script (desde Turso) y lo lee
 * `app/images/[...path]/route.js` (desde el disco). Se construye desde las filas y no desde el
 * directorio a propósito: refleja lo que hay en la nube AHORA, así que una entrada no puede
 * quedarse apuntando a un archivo que alguien borró a mano, y una imagen borrada en el
 * mantenedor desaparece del índice en la siguiente bajada.
 *
 * `actualizado` viaja porque es lo que versiona la URL local (`?v=`): sin él, reemplazar una
 * imagen dejaría la copia vieja en el navegador — el fallo que ya se pagó en producción y que
 * `marcaDeVersion` resuelve en el camino de Turso.
 */
export function indiceDeReemplazos(filas) {
  return filas
    .map((fila) => ({
      slug: fila.slug,
      kind: fila.kind,
      size: Number(fila.size),
      width: fila.width ?? null,
      height: fila.height ?? null,
      actualizado: fila.actualizado ?? null,
    }))
    .sort((a, b) => (a.kind === b.kind ? a.slug.localeCompare(b.slug) : a.kind.localeCompare(b.kind)));
}

/** `stat` de un archivo en bytes, o `null` si no existe. */
function tamanoDe(abs) {
  try {
    return fs.statSync(abs).size;
  } catch {
    return null;
  }
}

async function main() {
  const DRY_RUN = has('dry-run');
  const FORZAR = has('forzar');
  const SOLO_EDICIONES = has('solo-ediciones');
  const SIN_EDICIONES = has('sin-ediciones');
  const DESTINO = path.resolve(ROOT, value('destino', CARPETA_TEMPORAL));
  const ENV_FILE = value('env-file', path.join(ROOT, '.env.dev.local'));
  const EDICIONES = value('ediciones', path.join(ROOT, 'data', 'mantenedor-ediciones.json'));

  const inseguro = motivoDestinoInseguro(DESTINO);
  if (inseguro) {
    console.error(`✖ --destino no puede ser ${inseguro}:`);
    console.error('  bajarlos ahí mete los reemplazos del mantenedor en el MANIFIESTO, y una corrida');
    console.error('  de publish:images los subiría como origen=catalogo, destruyendo la imagen original');
    console.error(`  del catálogo en Turso. Usa la carpeta temporal (${CARPETA_TEMPORAL}).`);
    process.exit(1);
  }

  let url = value('turso-url', process.env.TURSO_DATABASE_URL ?? '');
  let token = value('turso-token', process.env.TURSO_AUTH_TOKEN ?? '');
  let deArchivo = null;
  if ((!url || !token) && fs.existsSync(ENV_FILE)) {
    const env = leerEnvFile(ENV_FILE);
    url = url || env.TURSO_DATABASE_URL || '';
    token = token || env.TURSO_AUTH_TOKEN || '';
    deArchivo = ENV_FILE;
  }
  if (!url) {
    console.error('✖ falta la URL de Turso.');
    console.error('  Pásala con --turso-url o TURSO_DATABASE_URL, o deja un .env-file legible.');
    console.error('  Las de PRODUCCIÓN están marcadas *sensitive* en Vercel y no se pueden leer:');
    console.error('  usa las de *development* (npx vercel env pull --environment=development).');
    process.exit(1);
  }
  console.log(
    `[bajar] Turso: ${url}${deArchivo ? ` (credenciales de ${path.relative(ROOT, deArchivo)})` : ' (del entorno)'}`,
  );
  console.log(`[bajar] destino: ${path.relative(ROOT, DESTINO)} (temporal, fuera del artefacto desplegable)`);

  const db = createClient({ url, authToken: token || undefined });

  /**
   * Las EDICIONES de texto viven SOLO en Turso y se pierden igual de fácil que las imágenes, así
   * que se vuelcan en la misma pasada. Es un respaldo legible, no una fuente del build: lo que
   * sirve la app son las filas de Turso.
   */
  if (!SIN_EDICIONES) {
    const { rows } = await db.execute('SELECT slug, campo, valor, actualizado FROM edicion ORDER BY slug, campo');
    fs.mkdirSync(path.dirname(EDICIONES), { recursive: true });
    fs.writeFileSync(EDICIONES, `${JSON.stringify(rows.map((r) => ({ ...r })), null, 2)}\n`);
    console.log(`[bajar] ediciones respaldadas: ${rows.length} -> ${path.relative(ROOT, EDICIONES)}`);
  }
  if (SOLO_EDICIONES) {
    await db.close();
    return;
  }

  /**
   * Se listan las filas SIN la columna `bytes`: cada fila de asset lleva una imagen entera y aquí
   * solo hacen falta los metadatos para decidir qué bajar (misma razón por la que
   * `reemplazosDePagina` de `lib/ediciones.mjs` no la selecciona). Solo los tipos que el
   * mantenedor puede reemplazar (`KINDS_GESTIONABLES`): `faction` se publica pero no se toca a
   * mano, así que no hay nada suyo que bajar.
   */
  const marcadoresKind = KINDS_GESTIONABLES.map(() => '?').join(', ');
  const { rows } = await db.execute({
    sql: `SELECT slug, kind, size, width, height, actualizado FROM asset_remoto
          WHERE origen = ? AND kind IN (${marcadoresKind})
          ORDER BY kind, slug`,
    args: [ORIGEN_QUE_SE_BAJA, ...KINDS_GESTIONABLES],
  });
  console.log(`[bajar] filas en Turso (origen ${ORIGEN_QUE_SE_BAJA}): ${rows.length}`);

  const plan = planDeDescarga(rows, { stat: tamanoDe, raiz: DESTINO, forzar: FORZAR });
  const porMotivo = plan.reduce((acc, p) => ({ ...acc, [p.motivo]: (acc[p.motivo] ?? 0) + 1 }), {});
  const totalMB = (plan.reduce((s, p) => s + p.size, 0) / 1024 / 1024).toFixed(1);
  console.log(
    `[bajar] al día: ${rows.length - plan.length} | por bajar: ${plan.length} (${totalMB} MB) ${JSON.stringify(porMotivo)}`,
  );
  for (const p of plan.slice(0, 30)) {
    console.log(`   · ${p.kind}/${p.slug} ${p.motivo} (${p.local ?? '—'} -> ${p.size})`);
  }
  if (plan.length > 30) console.log(`   · ... y ${plan.length - 30} más`);

  if (DRY_RUN) {
    console.log('[bajar] dry-run: no se escribe nada');
    await db.close();
    return;
  }

  let escritas = 0;
  const fallos = [];
  for (const [i, p] of plan.entries()) {
    try {
      /**
       * Una fila por imagen: los bytes viajan en la respuesta, así que pedirlos de una en una
       * mantiene la memoria acotada y hace que un fallo aislado no tire el lote entero. Como la
       * decisión ya está tomada por tamaño, lo que falla se reintenta al volver a correrlo.
       */
      const { rows: contenido } = await db.execute({
        sql: 'SELECT bytes FROM asset_remoto WHERE slug = ? AND kind = ? AND origen = ?',
        args: [p.slug, p.kind, ORIGEN_QUE_SE_BAJA],
      });
      if (contenido.length === 0 || contenido[0].bytes == null) {
        fallos.push({ rel: p.rel, error: 'la fila desapareció entre la lista y la descarga' });
        continue;
      }
      const bytes = Buffer.from(contenido[0].bytes);
      fs.mkdirSync(path.dirname(p.abs), { recursive: true });
      fs.writeFileSync(p.abs, bytes);
      escritas++;
    } catch (error) {
      fallos.push({ rel: p.rel, error: error.message });
    }
    if ((i + 1) % 15 === 0 || i + 1 === plan.length) {
      console.log(`[bajar] ${i + 1}/${plan.length} (escritas ${escritas}, fallos ${fallos.length})`);
    }
  }

  /**
   * El índice se escribe SIEMPRE, también en una corrida que no bajó nada: es la información que
   * la ruta local necesita para saber qué tapar, y regenerarlo es lo que mantiene el directorio
   * temporal coherente con Turso (incluidas las claves que se borraron en el mantenedor, que
   * desaparecen de aquí sin que haya que borrar archivos a mano).
   */
  const indice = indiceDeReemplazos(rows);
  fs.mkdirSync(DESTINO, { recursive: true });
  fs.writeFileSync(path.join(DESTINO, 'indice.json'), `${JSON.stringify(indice, null, 2)}\n`);

  /**
   * Verificación final leyendo el DISCO, no lo que se creía haber escrito: el tamaño de cada
   * archivo del índice contra el de su fila en Turso. Es lo que delata una escritura truncada.
   */
  let verificadas = 0;
  const discrepantes = [];
  for (const fila of indice) {
    const ext = EXTENSION_DE_CARPETA[fila.kind] ?? 'webp';
    const abs = path.join(DESTINO, fila.kind, `${fila.slug}.${ext}`);
    const local = tamanoDe(abs);
    if (local === fila.size) verificadas++;
    else discrepantes.push({ rel: `${fila.kind}/${fila.slug}`, local, turso: fila.size });
  }

  await db.close();

  console.log(`\n[bajar] escritas: ${escritas} | fallos: ${fallos.length}`);
  console.log(`[bajar] índice: ${indice.length} entradas -> ${path.relative(ROOT, path.join(DESTINO, 'indice.json'))}`);
  console.log(`[bajar] verificación en disco: ${verificadas}/${indice.length} con el tamaño de Turso`);
  for (const d of discrepantes.slice(0, 10)) console.log(`   ✖ ${d.rel}: disco ${d.local} vs Turso ${d.turso}`);
  for (const f of fallos.slice(0, 10)) console.log(`   ✖ ${f.rel}: ${f.error}`);
  if (fallos.length > 0 || discrepantes.length > 0) {
    console.log('[bajar] vuelve a ejecutarlo: reintenta solo lo que falta');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error('[bajar] ERROR', error.message);
    process.exit(1);
  });
}
