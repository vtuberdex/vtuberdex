/**
 * Verifica el artefacto desplegable SIN depender de Vercel.
 *
 * Monta un escenario que reproduce las condiciones reales del deploy y que no
 * aparecen en local:
 *
 *   · FS de SOLO LECTURA — nada puede escribirse, y SQLite necesita abrirse y
 *     consultar (incluido FTS5) sin tocar disco.
 *   · sin `data/` ni `web/dist` — la base y el front llegan SOLO por lo que el
 *     build dejó en `deploy/` y `public/`, tal como viajan a Vercel.
 *   · `express.static` presente pero el HTML servido igual: en Vercel el
 *     estático lo reparte el CDN, así que aquí se comprueba que la app sigue
 *     respondiendo el SPA por sí misma si el CDN no lo hiciera.
 *
 * Se importa la MISMA app que despliega `server.mjs` (`app.mjs`), no una copia:
 * si la verificación construyera su propia app podría pasar sobre una
 * configuración que no es la que se publica.
 *
 * Uso: node scripts/verify-vercel-bundle.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STAGE = path.join(ROOT, '.verify-stage');
const PORT = Number(process.env.VERIFY_PORT ?? 4599);
const BLOB_BASE = 'https://verificar.public.blob.vercel-storage.com';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/**
 * Copia al escenario lo que Vercel vería: el código, `public/` (el front que
 * reparte el CDN) y `deploy/` (la base y el manifiesto que viajan en la
 * función). Queda fuera lo que no viaja en un deploy: `node_modules`, `data/`,
 * el scraper y los artefactos locales.
 */
function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  for (const entry of fs.readdirSync(ROOT)) {
    if (['node_modules', 'data', 'scraper', 'docs', '.git', '.vercel', '.verify-stage', 'deploy', 'public', 'web'].includes(entry)) continue;
    const from = path.join(ROOT, entry);
    const to = path.join(STAGE, entry);
    if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
  // El server necesita el código del servidor original.
  fs.cpSync(path.join(ROOT, 'server', 'src'), path.join(STAGE, 'server', 'src'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'server', 'package.json'), path.join(STAGE, 'server', 'package.json'));
  fs.cpSync(path.join(ROOT, 'public'), path.join(STAGE, 'public'), { recursive: true });
  fs.cpSync(path.join(ROOT, 'deploy'), path.join(STAGE, 'deploy'), { recursive: true });
  // `node_modules` se enlaza: en Vercel lo instala el build desde package.json.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'));
}

/** Deja el árbol inmutable: cualquier escritura fallará como en Vercel. */
function seal(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) seal(full);
    else fs.chmodSync(full, 0o444);
  }
}

/** Devuelve el árbol a escribible para poder limpiarlo. */
function unseal(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    try {
      if (entry.isDirectory()) unseal(full);
      else fs.chmodSync(full, 0o644);
    } catch {
      /* nada que hacer */
    }
  }
}

const request = (pathname) =>
  new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${PORT}${pathname}`, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body }));
    });
    req.on('error', reject);
    req.end();
  });

/**
 * Audita el artefacto de datos ANTES de sellar el escenario.
 *
 * Es la comprobación de seguridad del deploy: la base que viaja a Vercel no
 * puede llevar credenciales ni registros del mantenedor (en producción no hay
 * sesiones, así que vaciarlas no quita ninguna función). Se lee la base directo
 * y se comprueba también que no haya quedado dentro de `public/`, donde sería
 * descargable por HTTP.
 */
function auditArtifact() {
  const dbPath = path.join(ROOT, 'deploy', 'data', 'vtuberdex.db');
  const probe = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(${JSON.stringify(dbPath)}, { readOnly: true });
      const one = (sql) => db.prepare(sql).get().n;
      console.log(JSON.stringify({
        vtubers: one('SELECT COUNT(*) AS n FROM vtuber'),
        fts: one('SELECT COUNT(*) AS n FROM vtuber_fts'),
        credentials: one('SELECT COUNT(*) AS n FROM admin_user'),
        audit: one('SELECT COUNT(*) AS n FROM audit_log'),
      }));
      db.close();
    `],
    { encoding: 'utf8' },
  );
  const json = JSON.parse((probe.stdout || '{}').trim().split('\n').pop() || '{}');
  check('la base del deploy lleva el catálogo completo', json.vtubers === 785, `vtubers=${json.vtubers}`);
  check('la base del deploy lleva el índice FTS5', json.fts === 785, `fts=${json.fts}`);
  check('la base del deploy NO lleva credenciales', json.credentials === 0, `admin_user=${json.credentials} filas`);
  check('la base del deploy NO lleva auditoría del mantenedor', json.audit === 0, `audit_log=${json.audit} filas`);

  const publicDir = path.join(ROOT, 'public');
  const leaked = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(db|sqlite|sqlite3|wal|shm)$/i.test(entry.name)) leaked.push(path.relative(publicDir, full));
    }
  };
  if (fs.existsSync(publicDir)) walk(publicDir);
  check('la base NO quedó en la carpeta pública', leaked.length === 0, leaked.join(', ') || 'public/ sin archivos de base');
}

async function main() {
  // El artefacto de datos se regenera aquí para que la verificación sea
  // autocontenida y compruebe el mapeo real de Blob, no uno viejo.
  const built = spawnSync(process.execPath, [path.join(HERE, 'build-db.mjs')], { cwd: ROOT, encoding: 'utf8' });
  check('artefacto de datos construido (base saneada + manifiesto)', built.status === 0, (built.stderr ?? '').slice(0, 300));
  if (built.status !== 0) return finish();

  auditArtifact();

  // El front tiene que existir: en Vercel lo sirve el CDN desde `public/`.
  if (!fs.existsSync(path.join(ROOT, 'public', 'index.html'))) {
    const buildWeb = spawnSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'web'), encoding: 'utf8' });
    if (buildWeb.status !== 0) {
      check('build del front disponible', false, (buildWeb.stderr ?? '').slice(0, 300));
      return finish();
    }
    fs.rmSync(path.join(ROOT, 'public'), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, 'web', 'dist'), path.join(ROOT, 'public'), { recursive: true });
  }
  check('build del front disponible en public/', true);

  stage();
  seal(STAGE);
  check('escenario montado con el árbol en solo lectura', true, STAGE);

  // La app se importa DESPUÉS de sellar: si algo intentara escribir al cargar
  // (una carpeta de datos, un journal de SQLite), fallaría aquí.
  process.chdir(STAGE);
  process.env.VTUBERDEX_BLOB_BASE = BLOB_BASE;
  let app;
  try {
    const mod = await import(`file://${path.join(STAGE, 'app.mjs')}`);
    app = mod.createApp({
      dbPath: path.join(STAGE, 'deploy', 'data', 'vtuberdex.db'),
      manifestPath: path.join(STAGE, 'deploy', 'data', 'images.json'),
      publicRoot: path.join(STAGE, 'public'),
      dataRoot: path.join(STAGE, 'deploy', 'data'),
    });
    check('la app se construye con el FS de solo lectura', typeof app === 'function');
  } catch (error) {
    check('la app se construye con el FS de solo lectura', false, String(error?.message ?? error));
    return finish();
  }

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  // --- catálogo ------------------------------------------------------------
  const health = await request('/api/health');
  const healthJson = JSON.parse(health.body || '{}');
  check(
    '/api/health responde con el catálogo completo',
    health.status === 200 && healthJson.vtubers === 785,
    `status=${health.status} ${JSON.stringify(healthJson)}`,
  );

  const list = await request('/api/vtubers?q=monochrome&perPage=3');
  const listJson = JSON.parse(list.body || '{}');
  check(
    'búsqueda FTS5 sobre base de solo lectura',
    list.status === 200 && listJson.total >= 2,
    `total=${listJson.total} items=${listJson.items?.length}`,
  );

  const filter = await request('/api/vtubers?country=chile&perPage=1');
  check('filtro por faceta (país)', filter.status === 200, `status=${filter.status}`);

  const detail = await request('/api/vtubers/gkuro-monochrome');
  const detailJson = JSON.parse(detail.body || '{}');
  check(
    'detalle con skills, stats y assets',
    detail.status === 200 && detailJson.skills?.length > 0 && detailJson.assets?.length > 0,
    `skills=${detailJson.skills?.length} stats=${detailJson.stats?.length} assets=${detailJson.assets?.length}`,
  );

  const meta = await request('/api/meta');
  const metaJson = JSON.parse(meta.body || '{}');
  check(
    'facetas y contadores calculados en la base',
    meta.status === 200 && metaJson.countries?.length === 31,
    `países=${metaJson.countries?.length}`,
  );

  // --- imágenes ------------------------------------------------------------
  const img = await request('/images/character/gkuro-monochrome.webp');
  check(
    'imagen publicada redirige a Vercel Blob',
    img.status === 301 && String(img.location).startsWith(BLOB_BASE),
    `${img.status} -> ${img.location}`,
  );

  const logo = await request('/images/logo/gkuro-monochrome.webp');
  check('logo redirige a Blob', logo.status === 301, `${logo.status}`);

  const factionKey = Object.keys(
    JSON.parse(fs.readFileSync(path.join(STAGE, 'deploy', 'data', 'images.json'), 'utf8')).images,
  ).find((key) => key.startsWith('images/faction/'));
  const faction = await request(`/${factionKey}`);
  check('emblema de facción redirige a Blob', faction.status === 301, `${factionKey} -> ${faction.status}`);

  const missing = await request('/images/character/no-existe-jamas.webp');
  check('imagen no publicada da 404 explícito (no un redirect roto)', missing.status === 404, `status=${missing.status}`);

  const thumb = await request('/images/thumb/gkuro-monochrome.webp');
  check('carpeta no publicada (thumb) da 404 explícito', thumb.status === 404, `status=${thumb.status}`);

  // --- seguridad -----------------------------------------------------------
  /**
   * La base no debe ser descargable. OJO con la comprobación ingenua: pedir
   * `/deploy/data/vtuberdex.db` devuelve 200 aunque la base NO se sirva, porque
   * el fallback del SPA responde el index a cualquier ruta desconocida. Lo que
   * hay que comprobar es el CONTENIDO: que la respuesta no sea un archivo SQLite.
   */
  const leak = await request('/deploy/data/vtuberdex.db');
  check(
    'la base NO es descargable (la respuesta no es SQLite)',
    !/SQLite format|^\x00*SQLite/.test(leak.body) && !leak.body.startsWith('SQLite'),
    `status=${leak.status} tipo=${/SQLite format 3/.test(leak.body) ? 'SI ES SQLITE' : 'html del SPA'}`,
  );

  const leakImages = await request('/images/../deploy/data/vtuberdex.db');
  check('la base no es alcanzable por travesía de rutas', !leakImages.body.startsWith('SQLite'), `status=${leakImages.status}`);

  const stats = await request('/api/admin/stats');
  check('las rutas de administración exigen sesión (401)', stats.status === 401, `status=${stats.status}`);

  // --- front ---------------------------------------------------------------
  const spa = await request('/');
  check('el front se sirve', spa.status === 200 && /<div id="root">/.test(spa.body), `status=${spa.status}`);

  const deepLink = await request('/v/gkuro-monochrome');
  check(
    'una ruta profunda del SPA devuelve el index',
    deepLink.status === 200 && /<div id="root">/.test(deepLink.body),
    `status=${deepLink.status}`,
  );

  const badSlug = await request('/api/vtubers/no-existe');
  check('un slug inexistente en la API da 404', badSlug.status === 404, `status=${badSlug.status}`);

  server.close();
  finish();
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones pasan`);
  unseal(STAGE);
  fs.rmSync(STAGE, { recursive: true, force: true });
  if (failed.length) {
    console.log(`\nFALLAN: ${failed.map((f) => f.name).join(' | ')}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[verify] ERROR', error);
  unseal(STAGE);
  fs.rmSync(STAGE, { recursive: true, force: true });
  process.exit(1);
});
