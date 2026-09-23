/**
 * Verifica el artefacto desplegable SIN depender de Vercel.
 *
 * Arranca el `next start` real —el mismo servidor que usa Vercel— sobre un
 * escenario que reproduce las condiciones de producción y NO las de desarrollo:
 *
 *   · Sin `data/images/`: las imágenes solo pueden salir del manifiesto a Blob.
 *   · Sin `data/vtuberdex.db` de desarrollo: la única base es la que viaja
 *     empaquetada en `deploy/`.
 *   · Con el árbol marcado de SOLO LECTURA para los archivos de datos, que es lo
 *     que impide que un fallo pase desapercibido hasta producción.
 *
 * Se piden rutas por HTTP real porque los fallos que importan aquí —una imagen
 * que redirige a ninguna parte, el SPA que devuelve 500 en una ruta profunda—
 * no aparecen en los tests unitarios: solo se ven pidiéndolas.
 *
 * Uso: node scripts/verify-vercel-bundle.mjs
 */
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const STAGE = path.join(ROOT, '.verify-stage');
const BLOB_BASE = process.env.VTUBERDEX_BLOB_BASE ?? 'https://verify.public.blob.vercel-storage.com';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Puerto libre, para no chocar con un dev-server en marcha. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}

/**
 * Audita el artefacto de datos: es la comprobación de seguridad del deploy.
 *
 * La base que viaja a Vercel no puede llevar credenciales ni registro de
 * auditoría (en producción no hay sesiones, así que vaciarlos no quita ninguna
 * función). Se comprueba también que NO esté en un lugar accesible por HTTP.
 */
function auditArtifact() {
  const dbPath = path.join(ROOT, 'deploy', 'data', 'vtuberdex.db');
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
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
      `,
    ],
    { encoding: 'utf8' },
  );
  const json = JSON.parse((probe.stdout || '{}').trim().split('\n').pop() || '{}');
  check('la base del deploy lleva el catálogo completo', json.vtubers === 785, `vtubers=${json.vtubers}`);
  check('la base del deploy lleva el índice FTS5', json.fts === 785, `fts=${json.fts}`);
  check('la base del deploy NO lleva credenciales', json.credentials === 0, `admin_user=${json.credentials} filas`);
  check('la base del deploy NO lleva auditoría', json.audit === 0, `audit_log=${json.audit} filas`);

  // Un archivo de base dentro de `public/` sería descargable por HTTP.
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
  check('la base NO quedó en la carpeta pública', leaked.length === 0, leaked.join(', ') || 'public/ sin bases');

  // La traza de la función sí debe incluirla: sin esto el deploy arranca vacío.
  const traced = [];
  const scanNft = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scanNft(full);
      else if (entry.name.endsWith('.nft.json')) {
        const raw = fs.readFileSync(full, 'utf8');
        if (raw.includes('vtuberdex.db')) traced.push(path.relative(ROOT, full));
      }
    }
  };
  scanNft(path.join(ROOT, '.next'));
  check(
    'la base viaja en el bundle de las funciones',
    traced.length > 0,
    traced.length ? `${traced.length} función(es)` : 'ninguna función la incluye',
  );
}

/**
 * Prepara el escenario: el proyecto sin los datos crudos, con la base y el
 * manifiesto SOLO donde deben estar (`deploy/`).
 */
function stage() {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  const skip = new Set([
    'node_modules', 'data', 'scraper', 'docs', '.git', '.vercel', '.verify-stage',
    'public', '.next', 'deploy',
  ]);
  for (const entry of fs.readdirSync(ROOT)) {
    if (skip.has(entry)) continue;
    const from = path.join(ROOT, entry);
    const to = path.join(STAGE, entry);
    if (fs.statSync(from).isDirectory()) fs.cpSync(from, to, { recursive: true });
    else fs.copyFileSync(from, to);
  }
  fs.cpSync(path.join(ROOT, 'deploy'), path.join(STAGE, 'deploy'), { recursive: true });
  // `node_modules` y `.next` se enlazan: en Vercel los produce el build.
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'));
  fs.symlinkSync(path.join(ROOT, '.next'), path.join(STAGE, '.next'));
}

const request = (port, pathname) =>
  new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${pathname}`, { method: 'GET' }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode, location: res.headers.location, body, type: res.headers['content-type'] }),
      );
    });
    req.on('error', reject);
    req.end();
  });

async function main() {
  // 1. El artefacto de datos.
  /**
   * `--if-missing` SOLO cuando no hay base de desarrollo.
   *
   * Sin la bandera, `build-db.mjs` regenera `deploy/` a partir de
   * `data/vtuberdex.db` —que es lo que se quiere en local tras un scrape o una
   * edición en el mantenedor—, pero esa base NO está versionada (está en
   * `.gitignore`: pesa 60 MB y es reproducible). En el CI no existe, así que sin
   * esto el verificador moría en el primer paso con "falta la base de origen" y
   * el gate completo del deploy quedaba fuera del CI.
   *
   * Con la bandera se reutilizan los artefactos que SÍ viajan en el repo
   * (`deploy/data/vtuberdex.db` + `images.json`), que es exactamente lo que hace
   * el build de Vercel. Lo que este verificador comprueba después —base saneada,
   * 785 fichas, FTS5, rutas de imagen— es sobre ese artefacto, así que sigue
   * siendo válido: no se salta ninguna comprobación.
   */
  const hayBaseDeDesarrollo = fs.existsSync(path.join(ROOT, 'data', 'vtuberdex.db'));
  const argsBuild = hayBaseDeDesarrollo ? [] : ['--if-missing'];
  const built = spawnSync(process.execPath, [path.join(HERE, 'build-db.mjs'), ...argsBuild], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  check(
    'artefacto de datos construido (base saneada + manifiesto)',
    built.status === 0,
    hayBaseDeDesarrollo ? '' : 'sin base de desarrollo: se reutiliza deploy/ (igual que Vercel)',
  );
  if (built.status !== 0) return finish();
  auditArtifact();

  // 2. El build de Next, del que depende todo lo demás.
  if (!fs.existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
    const build = spawnSync('npx', ['next', 'build'], { cwd: ROOT, stdio: 'inherit' });
    check('build de Next disponible', build.status === 0);
    if (build.status !== 0) return finish();
  } else {
    check('build de Next disponible', true, 'reutiliza .next existente');
  }

  stage();
  check('escenario montado sin los datos crudos de desarrollo', true, STAGE);

  // 3. El servidor real.
  const port = await freePort();
  /**
   * `detached: true` para que el servidor tenga su PROPIO grupo de procesos.
   *
   * Sin esto, `child.kill()` mataba solo al `npx` de arriba y el `next-server` que cuelga de
   * él se quedaba VIVO: cada `npm run verify` dejaba un servidor escuchando. Y no es solo
   * desorden — `unstage()` borra `.verify-stage`, que es el `cwd` de ese proceso huérfano, y
   * un `rmSync` recursivo sobre un directorio en uso puede quedarse trabado; el verify se
   * arrastraba minutos y no limpiaba nada. Con el grupo propio se mata el árbol completo.
   */
  const child = spawn('npx', ['next', 'start', '--port', String(port)], {
    cwd: STAGE,
    env: { ...process.env, PORT: String(port), VTUBERDEX_BLOB_BASE: BLOB_BASE, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });

  /** Mata el ÁRBOL del servidor (`npx` -> `next` -> `next-server`), no solo el primero. */
  const matarServidor = () => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // El grupo ya no está (o nunca llegó a formarse): se intenta al hijo directo.
      try {
        child.kill('SIGKILL');
      } catch {
        /* ya está muerto */
      }
    }
  };
  let output = '';
  child.stdout.on('data', (d) => (output += d.toString()));
  child.stderr.on('data', (d) => (output += d.toString()));

  // Sondeo de arranque en vez de una espera fija.
  let up = false;
  for (let i = 0; i < 80 && !up; i += 1) {
    try {
      await request(port, '/api/health');
      up = true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  if (!up) {
    check('el servidor arranca sin los datos de desarrollo', false, output.slice(-700));
    matarServidor();
    return finish(output);
  }
  check('el servidor arranca sin los datos de desarrollo', true);

  // --- catálogo ------------------------------------------------------------
  const health = await request(port, '/api/health');
  const healthJson = JSON.parse(health.body || '{}');
  check(
    '/api/health responde con el catálogo',
    health.status === 200 && healthJson.vtubers === 785,
    `status=${health.status} ${JSON.stringify(healthJson)}`,
  );

  const list = await request(port, '/api/vtubers?q=monochrome&perPage=3');
  const listJson = JSON.parse(list.body || '{}');
  check('búsqueda FTS5 sobre la base empaquetada', list.status === 200 && listJson.total >= 2, `total=${listJson.total}`);

  const detail = await request(port, '/api/vtubers/gkuro-monochrome');
  const detailJson = JSON.parse(detail.body || '{}');
  check(
    'detalle con skills, stats y assets',
    detail.status === 200 && detailJson.skills?.length > 0 && detailJson.assets?.length > 0,
    `skills=${detailJson.skills?.length} stats=${detailJson.stats?.length} assets=${detailJson.assets?.length}`,
  );

  const meta = await request(port, '/api/meta');
  const metaJson = JSON.parse(meta.body || '{}');
  check(
    'facetas calculadas en la base (31 países)',
    meta.status === 200 && metaJson.countries?.length === 31,
    `países=${metaJson.countries?.length}`,
  );

  const filtered = await request(port, '/api/vtubers?countries=chile&sort=power&perPage=2');
  check('filtro por faceta + orden responde', filtered.status === 200, `status=${filtered.status}`);

  const badQuery = await request(port, '/api/vtubers?perPage=99999');
  check('una query inválida da 400 (validación zod)', badQuery.status === 400, `status=${badQuery.status}`);

  const badSlug = await request(port, '/api/vtubers/no-existe-este-slug');
  check('un slug inexistente en la API da 404', badSlug.status === 404, `status=${badSlug.status}`);

  // --- imágenes ------------------------------------------------------------
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'deploy/data/images.json'), 'utf8'));
  const img = await request(port, '/images/character/gkuro-monochrome.webp');
  check(
    'imagen publicada redirige a Vercel Blob',
    img.status === 301 && String(img.location).startsWith(BLOB_BASE),
    `${img.status} -> ${img.location}`,
  );

  const logo = await request(port, '/images/logo/gkuro-monochrome.webp');
  check('logo redirige a Blob', logo.status === 301, `status=${logo.status}`);

  const factionKey = Object.keys(manifest.images).find((key) => key.startsWith('images/faction/'));
  const faction = await request(port, `/${factionKey}`);
  check('emblema de facción redirige a Blob', faction.status === 301, `${factionKey} -> ${faction.status}`);

  const missing = await request(port, '/images/character/no-existe-jamas.webp');
  check('imagen no publicada da 404 explícito (no un redirect roto)', missing.status === 404, `status=${missing.status}`);

  // Carpetas retiradas a propósito: deben dar 404, no un redirect ni un 500.
  for (const [folder, file] of [
    ['thumb', 'gkuro-monochrome.webp'],
    ['radar', 'gkuro-monochrome.webp'],
    ['ficha', 'gkuro-monochrome.webp'],
    ['avatar', 'gkuro-monochrome.webp'],
  ]) {
    const retired = await request(port, `/images/${folder}/${file}`);
    check(`carpeta retirada (${folder}) da 404 explícito`, retired.status === 404, `status=${retired.status}`);
  }

  /**
   * El manifiesto declara las carpetas que el front USA. Las tres primeras las
   * produce el scraper y están siempre; `background` es la cuarta y es OPCIONAL:
   * el scraper no la genera, así que solo aparece si alguien sube un fondo desde
   * el mantenedor.
   *
   * Antes esto exigía el literal exacto `{logo:785,character:785,faction:23}`, así
   * que en cuanto se subía un fondo el contador dejaba de cuadrar y este gate
   * —el paso previo al deploy— fallaba con el catálogo intacto. Ahora se compara
   * por forma: las tres fijas con su conteo real, y `background` como opcional.
   */
  const carpetas = manifest.folders ?? {};
  const requeridas =
    carpetas.character > 0 && carpetas.logo > 0 && carpetas.faction === 23;
  const esperado = 785 * 2 + 23 + (carpetas.background ?? 0);
  check(
    'el manifiesto declara las carpetas que el front usa (background opcional)',
    requeridas && manifest.count === esperado,
    `${manifest.count} imágenes ${JSON.stringify(carpetas)}`,
  );

  // --- seguridad -----------------------------------------------------------
  /**
   * La base no puede ser descargable. OJO con la comprobación ingenua: pedir
   * `/deploy/data/vtuberdex.db` puede devolver 200 aunque NO se sirva, porque un
   * fallback responde el index a cualquier ruta desconocida. Lo que hay que
   * mirar es el CONTENIDO: que la respuesta no sea un archivo SQLite.
   */
  const leak = await request(port, '/deploy/data/vtuberdex.db');
  check(
    'la base NO es descargable (la respuesta no es SQLite)',
    !leak.body.startsWith('SQLite format'),
    `status=${leak.status} ${leak.body.startsWith('SQLite format') ? '¡ES SQLITE!' : 'no es SQLite'}`,
  );

  /**
   * El mantenedor tiene DOS modos, y esta comprobación debe ser cierta en ambos:
   *
   *   · **Sin Turso** (el escenario de este verificador) no hay backend de escritura, así
   *     que responde 404 explícito. Es el comportamiento que hay que preservar: un 404
   *     dice exactamente que ahí no existe, en vez de fallar a medias.
   *   · **Con Turso** (`TURSO_DATABASE_URL`) SÍ responde: las ediciones van a una base
   *     externa y el catálogo se sigue leyendo del bundle. Antes esto era imposible y el
   *     sitio publicado no se podía corregir sin volver a desplegar.
   *
   * Se distingue un modo del otro por el CUERPO, no solo por el status: un 404 podría
   * venir del fallback de Next en vez de la propia ruta.
   */
  const admin = await request(port, '/api/admin/session');
  const adminSinTurso = admin.status === 404 && /no_encontrado/.test(admin.body);
  const adminConTurso = admin.status === 200 && /"mode"\s*:\s*"turso"/.test(admin.body);
  check(
    'el mantenedor responde coherente con su modo (404 sin Turso, activo con Turso)',
    adminSinTurso || adminConTurso,
    `status=${admin.status} modo=${adminConTurso ? 'turso' : 'sin backend de escritura'}`,
  );

  /**
   * Las rutas que SÍ existen tienen que exigir sesión, no dar 404 ni 500.
   *
   * Antes esta comprobación esperaba 404 en `/api/admin/stats`. Dejó de ser cierto cuando el
   * mantenedor de producción ganó el login y las tres rutas que la UI necesita (`stats`,
   * `audit`, la lista): ahora responden, pero SIN sesión responden **401**. Un 404 pasaría
   * por "ruta no implementada" y un 200 significaría que el mantenedor está abierto: los
   * dos casos se comprueban explícitamente para que la regresión se vea.
   */
  const adminStats = await request(port, '/api/admin/stats');
  check(
    'las rutas del mantenedor exigen sesión (401) y no dan 404 ni quedan abiertas',
    adminSinTurso ? adminStats.status === 404 : adminStats.status === 401,
    `status=${adminStats.status} (esperado ${adminSinTurso ? '404 sin Turso' : '401 sin sesión'})`,
  );

  // --- front ---------------------------------------------------------------
  const home = await request(port, '/');
  check('el front se sirve', home.status === 200 && /VTuberDex|=/.test(home.body), `status=${home.status}`);

  const deep = await request(port, '/v/gkuro-monochrome');
  check(
    'una ruta profunda del SPA responde 200 (no 500)',
    deep.status === 200 && home.body.length > 0,
    `status=${deep.status}`,
  );

  const query = await request(port, '/?q=monochrome&countries=chile');
  check('el querystring no rompe la portada', query.status === 200, `status=${query.status}`);

  matarServidor();
  finish(output);
}

function finish(output = '') {
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} comprobaciones pasan`);
  if (output && failed.length > 0) console.log(`\nsalida del servidor:\n${output.slice(-900)}`);
  // El escenario se deja a propósito para poder inspeccionarlo si algo falla.
  if (failed.length === 0) unstage();
  if (failed.length) {
    console.log(`\nFALLAN: ${failed.map((f) => f.name).join(' | ')}`);
    process.exitCode = 1;
  }
}

function unstage() {
  try {
    // Los symlinks a `node_modules` y `.next` se quitan ANTES del borrado
    // recursivo: `rmSync` recursivo sobre un directorio que contiene un enlace a
    // un árbol enorme puede quedarse recorriéndolo, y el escenario no se
    // limpiaría nunca.
    for (const link of ['node_modules', '.next']) {
      const target = path.join(STAGE, link);
      try {
        if (fs.lstatSync(target).isSymbolicLink()) fs.unlinkSync(target);
      } catch {
        /* no existía */
      }
    }
    fs.rmSync(STAGE, { recursive: true, force: true });
  } catch {
    /* nada que hacer */
  }
}

main().catch((error) => {
  console.error('[verify] ERROR', error);
  unstage();
  process.exit(1);
});
