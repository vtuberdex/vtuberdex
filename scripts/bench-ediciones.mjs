/**
 * A/B del camino de lectura de ediciones/assets, con el cliente de verdad.
 *
 * POR QUÉ UN STUB EN VEZ DE TURSO
 * ------------------------------
 * Las credenciales de producción están marcadas `sensitive` en Vercel y devuelven vacío
 * incluso con `decrypt=true`, así que no se pueden releer para medir. En vez de estimar el
 * número de viajes (que fue justo el error del primer diagnóstico: el cliente de libsql
 * AGRUPA en un solo POST las peticiones concurrentes —`#flushQueue`—, así que "292 viajes"
 * era falso), aquí se mide contra un servidor que habla el MISMO protocolo HTTP
 * (`/v2/pipeline` en JSON) respaldado por SQLite real, con el MISMO código: el cliente
 * `@libsql/client`, `lib/ediciones.mjs` nuevo y una copia del de `HEAD` en
 * `lib/.tmp-ediciones-old.mjs`. Lo que se cuenta son POST recibidos en el servidor.
 *
 * El retardo por petición es configurable para modelar la latencia real de Turso: con
 * `--delay 30` cada POST cuesta 30 ms, el orden de un viaje a un servicio en otra región.
 * Sin retardo se mide el número de viajes, que es el hecho que no depende de la red.
 *
 * Se lanza desde la raíz:
 *   node scripts/bench-ediciones.mjs
 *   node scripts/bench-ediciones.mjs --delay 30
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const RETARDO = Number(args[args.indexOf('--delay') + 1]) || 0;

// ---------------------------------------------------------------- stub de Turso
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE edicion (
    slug TEXT NOT NULL, campo TEXT NOT NULL, valor TEXT,
    actualizado TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (slug, campo)
  );
  CREATE TABLE asset_remoto (
    slug TEXT NOT NULL, kind TEXT NOT NULL, origen TEXT NOT NULL DEFAULT 'catalogo',
    mime TEXT NOT NULL, bytes BLOB NOT NULL, width INTEGER, height INTEGER,
    size INTEGER NOT NULL, actualizado TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (slug, kind, origen)
  );
`);

/**
 * Dos fichas con reemplazo del mantenedor y una edición, sobre las 785 del catálogo: el
 * caso real es que casi ninguna carta tiene nada que aplicar, así que lo que se mide es el
 * coste de PREGUNTAR, no el de aplicar.
 */
db.prepare('INSERT INTO edicion (slug, campo, valor) VALUES (?, ?, ?)').run('yeicokp-harv', 'name', '"CORREGIDO"');
for (const slug of ['yeicokp-harv', 'ex-porygon-z-explicador-de-vtubers']) {
  for (const kind of ['character', 'logo']) {
    db.prepare(
      `INSERT INTO asset_remoto (slug, kind, origen, mime, bytes, width, height, size)
       VALUES (?, ?, 'mantenedor', 'image/webp', ?, 720, 1008, 90000)`,
    ).run(slug, kind, new Uint8Array([1, 2, 3]));
  }
}

const metricas = { peticiones: 0, tipos: {} };

function aJson(valor) {
  if (valor === null || valor === undefined) return { type: 'null' };
  if (typeof valor === 'bigint') return { type: 'integer', value: String(valor) };
  if (typeof valor === 'number') {
    return Number.isInteger(valor) ? { type: 'integer', value: String(valor) } : { type: 'float', value: valor };
  }
  if (valor instanceof Uint8Array) return { type: 'blob', base64: Buffer.from(valor).toString('base64') };
  return { type: 'text', value: String(valor) };
}
function deJson(valor) {
  if (valor.type === 'null') return null;
  if (valor.type === 'integer') return Number(valor.value);
  if (valor.type === 'float') return valor.value;
  if (valor.type === 'blob') return new Uint8Array(Buffer.from(valor.base64, 'base64'));
  return valor.value;
}

function ejecutar(req) {
  metricas.tipos[req.type] = (metricas.tipos[req.type] ?? 0) + 1;

  if (req.type === 'sequence') {
    db.exec(req.sql);
    return { type: 'sequence' };
  }
  if (req.type === 'close') return { type: 'close' };

  const sql = req.stmt.sql;
  const valores = (req.stmt.args ?? []).map(deJson);
  const stmt = db.prepare(sql);
  const esLectura = /^\s*(select|pragma|with)/i.test(sql);
  if (!esLectura) {
    const info = stmt.run(...valores);
    return {
      type: 'execute',
      result: {
        cols: [],
        rows: [],
        affected_row_count: Number(info.changes),
        last_insert_rowid: String(info.lastInsertRowid ?? 0),
      },
    };
  }
  const filas = stmt.all(...valores);
  const nombres = filas.length > 0 ? Object.keys(filas[0]) : [];
  return {
    type: 'execute',
    result: {
      cols: nombres.map((name) => ({ name })),
      rows: filas.map((fila) => Object.values(fila).map(aJson)),
      affected_row_count: 0,
    },
  };
}

const servidor = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (trozo) => { cuerpo += trozo; });
  req.on('end', () => {
    metricas.peticiones += 1;
    const responder = () => {
      let salida;
      try {
        const body = cuerpo ? JSON.parse(cuerpo) : {};
        const results = (body.requests ?? []).map((r) => ({ type: 'ok', response: ejecutar(r) }));
        salida = { results };
      } catch (error) {
        salida = { results: [{ type: 'error', error: { message: String(error.message), code: 'STUB_ERROR' } }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(salida));
    };
    if (RETARDO > 0) setTimeout(responder, RETARDO);
    else responder();
  });
});
await new Promise((resolve) => servidor.listen(0, '127.0.0.1', resolve));
const URL_STUB = `http://127.0.0.1:${servidor.address().port}`;

// ---------------------------------------------------------------- comparación
process.env.TURSO_DATABASE_URL = URL_STUB;
process.env.TURSO_AUTH_TOKEN = 'stub';

const { getDb } = await import('../lib/db.mjs');
const { searchVtubers } = await import('../server/src/search.mjs');
const nuevo = await import('../lib/ediciones.mjs');

/**
 * La versión VIEJA, sacada de git en el momento de correr el bench.
 *
 * Se escribe en un directorio temporal y no en `lib/` a propósito: un archivo pegado
 * dentro del repo acaba versionado por accidente, y este es material de medición, no
 * código. `git show HEAD:lib/ediciones.mjs` es la definición exacta de "lo anterior".
 */
const temp = mkdtempSync(join(tmpdir(), 'vtuberdex-bench-'));
const rutaVieja = join(temp, 'ediciones-old.mjs');
/**
 * El módulo viejo se importa desde `/tmp`, así que sus imports relativos (`./carpetas.mjs`)
 * tienen que reescribirse a URLs absolutas del repo: desde el temporal no resolverían.
 */
/**
 * Raíz del repo, derivada de la posición del script.
 *
 * Estaba escrita literal (`/home/madkoding/...`), que ata el script a esta máquina: una copia
 * del repo en otro sitio habría mirado silenciosamente al árbol original.
 */
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
let fuenteVieja;
try {
  fuenteVieja = execFileSync('git', ['show', 'HEAD:lib/ediciones.mjs'], {
    cwd: RAIZ,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch {
  /*
   * El bench compara contra `HEAD` por diseño, así que necesita un repo git. Se avisa con
   * un mensaje en vez de dejar que el `execFileSync` imprima un stack trace: el fallo real
   * (correr esto desde un árbol exportado sin `.git`) es fácil de confundir con un bug del
   * propio script, y ya costó un diagnóstico.
   */
  console.error(
    '✖ no se pudo leer `HEAD:lib/ediciones.mjs`. Este bench compara el código actual contra la\n' +
      '  versión commiteada, así que tiene que correr dentro del repo (node_modules y .git\n' +
      '  presentes). Si estás en una copia exportada, ejecútalo desde el repo original.',
  );
  process.exit(1);
}
fuenteVieja = fuenteVieja
  .replace("'./carpetas.mjs'", `'${pathToFileURL(join(RAIZ, 'lib/carpetas.mjs')).href}'`)
  .replace(
    "'@libsql/client/node'",
    `'${pathToFileURL(join(RAIZ, 'node_modules/@libsql/client/lib-esm/node.js')).href}'`,
  );
writeFileSync(rutaVieja, fuenteVieja);
const viejo = await import(pathToFileURL(rutaVieja).href);

const dbCatalogo = getDb();

async function mediana(repeticiones, fn) {
  const tiempos = [];
  for (let i = 0; i < repeticiones; i += 1) {
    const t0 = performance.now();
    await fn();
    tiempos.push(performance.now() - t0);
  }
  tiempos.sort((x, y) => x - y);
  return Number(tiempos[Math.floor(tiempos.length / 2)].toFixed(RETARDO ? 0 : 2));
}

/** Deja el contador a cero y devuelve cuántas peticiones hizo `fn`. */
async function contando(fn) {
  metricas.peticiones = 0;
  await fn();
  return metricas.peticiones;
}

console.log(`stub Turso en ${URL_STUB} · retardo por petición: ${RETARDO} ms\n`);

for (const perPage of [24, 48, 100]) {
  const cartas = searchVtubers(dbCatalogo, { perPage, page: 1 }).items;

  // OLD: DDL en cada lectura + 3 SELECT por carta (como en HEAD).
  const tOld = await mediana(3, async () => {
    await viejo.leerEdiciones();
    await viejo.aplicarReemplazosALista(cartas);
  });
  const pOld = await contando(async () => {
    await viejo.leerEdiciones();
    await viejo.aplicarReemplazosALista(cartas);
  });

  // NEW: DDL memoizado + 1 consulta para las ediciones + 1 para toda la página.
  const tNew = await mediana(3, async () => {
    await nuevo.leerEdiciones();
    await nuevo.reemplazosDePagina(cartas.map((c) => c.slug));
  });
  const pNew = await contando(async () => {
    await nuevo.leerEdiciones();
    await nuevo.reemplazosDePagina(cartas.map((c) => c.slug));
  });

  console.log(`perPage=${perPage} (${cartas.length} cartas)`);
  console.log(`  OLD: ${tOld} ms · ${pOld} POST`);
  console.log(`  NEW: ${tNew} ms · ${pNew} POST`);
  console.log(`  peticiones: -${(((pOld - pNew) / pOld) * 100).toFixed(1)}%  ·  tiempo: -${(100 - (tNew / tOld) * 100).toFixed(1)}%`);
}

// ---------------------------------------------------------------- equivalencia
const muestra = searchVtubers(dbCatalogo, { perPage: 24, page: 1 }).items;
const a = await viejo.aplicarReemplazosALista(muestra.map((c) => ({ ...c })));
const b = await nuevo.aplicarReemplazosALista(muestra.map((c) => ({ ...c })));

/**
 * La equivalencia se mide sobre la RUTA, ignorando la versión.
 *
 * `aplicarReemplazosALista` cambió a propósito: ahora la URL de un reemplazo lleva `?v=`
 * (ver `lib/ediciones.mjs`), porque la ruta canónica no cambia al reemplazar y sin la
 * versión el navegador seguía sirviendo la copia anterior. Comparar las cadenas enteras
 * marcaría esa mejora como si fuera una diferencia de comportamiento, que es justo lo que
 * no es. Así que se compara el recurso (la ruta) y se cuenta aparte cuántas fichas quedaron
 * versionadas: ese contador ES el cambio, y verlo a 0 delataría que la versión se perdió.
 */
const sinVersion = (images) =>
  Object.fromEntries(Object.entries(images).map(([k, v]) => [k, typeof v === 'string' ? v.split('?')[0] : v]));

let iguales = 0;
let versionadas = 0;
for (let i = 0; i < a.length; i += 1) {
  const mismaImagen = JSON.stringify(sinVersion(a[i].images)) === JSON.stringify(sinVersion(b[i].images));
  const mismosAssets = JSON.stringify(a[i].assets) === JSON.stringify(b[i].assets);
  if (mismaImagen && mismosAssets) iguales += 1;
  else console.log(`  ✖ difiere ${a[i].slug}`);
  if (JSON.stringify(b[i].images).includes('?v=') && !JSON.stringify(a[i].images).includes('?v=')) {
    versionadas += 1;
  }
}
console.log(`\nequivalencia: ${iguales}/${a.length} fichas idénticas (rutas de imagen + assets) entre viejo y nuevo`);
console.log(`fichas con la URL versionada (?v=) solo en el nuevo: ${versionadas}`);

const aplicadas = b.filter((c) => c.assets?.some((x) => x.bytes === 90000));
console.log(`fichas de la muestra con reemplazo aplicado: ${aplicadas.length}`);

console.log(`\ntipos de petición que hizo el código: ${JSON.stringify(metricas.tipos)}`);

servidor.close();
db.close();
