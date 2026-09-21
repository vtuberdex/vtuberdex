/**
 * Publica las imágenes del catálogo en Vercel Blob.
 *
 * En Vercel la función no puede leer `data/images/` (no viaja en el deploy y el
 * FS es de solo lectura), así que las imágenes viven en Blob y el adaptador
 * (`app.mjs`) redirige `/images/*` a su URL pública.
 *
 * El manifiesto que consume el deploy es la MISMA lista que este script sube
 * (`deploy/data/images.json`, generado por `scripts/build-db.mjs`): así no puede
 * quedar desincronizado, que en producción se vería como un 404.
 *
 * Rendimiento y reanudabilidad, que importan con ~1800 archivos:
 *   · El store se enumera UNA vez (`blob list` paginado) para saber qué está
 *     subido. Comprobar archivo por archivo serían ~1800 invocaciones extra del
 *     CLI: la primera versión de este script tardaba minutos solo en eso.
 *   · Las subidas van en paralelo (por defecto 8).
 *   · Un archivo cuya subida falló NO se registra como hecho, así que volver a
 *     ejecutar reintenta exactamente lo que falta.
 *
 * Uso:
 *   node scripts/publish-images.mjs                 # sube lo que falte
 *   node scripts/publish-images.mjs --dry-run       # solo informa
 *   node scripts/publish-images.mjs --force         # resubir todo
 *   node scripts/publish-images.mjs --concurrency 8
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

const args = process.argv.slice(2);
const has = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const flag = `--${name}`;
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1) || fallback;
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY_RUN = has('dry-run');
const FORCE = has('force');
const CONCURRENCY = Math.max(1, Number(value('concurrency', '8')));
const MANIFEST = path.resolve(ROOT, 'deploy/data/images.json');
const SCOPE = value('scope', 'madkodings-projects');

/** Ejecuta un comando y devuelve { code, stdout, stderr }. */
function run(command, commandArgs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, { cwd: ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Rutas ya presentes en el store, enumerando con paginación. */
async function listExisting() {
  const existing = new Set();
  let cursor = null;
  let pages = 0;
  for (;;) {
    const argv = ['blob', 'list', '--limit', '1000', '--scope', SCOPE];
    if (cursor) argv.push('--next', cursor);
    const result = await run('vercel', argv);
    if (result.code !== 0) {
      console.warn('[publish] ⚠ no se pudo enumerar el store; se intentará subir todo');
      return null;
    }
    for (const line of result.stdout.split('\n')) {
      // Las líneas útiles llevan el pathname (`images/...`) y luego la URL.
      const match = line.match(/(images\/\S+?)\s+https:\/\//);
      if (match) existing.add(match[1]);
    }
    pages += 1;
    const next = result.stdout.match(/--next\s+(\S+)/);
    cursor = next?.[1] ?? null;
    if (!cursor || pages > 20) break;
  }
  console.log(`[publish] store: ${existing.size} objetos ya publicados (${pages} página(s))`);
  return existing;
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`✖ falta el manifiesto: ${MANIFEST} (corre antes: node scripts/build-db.mjs)`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const entries = Object.keys(manifest.images ?? {});
  if (entries.length === 0) {
    console.error('✖ el manifiesto no tiene imágenes');
    process.exit(1);
  }

  console.log(
    `[publish] ${entries.length} imágenes (${(manifest.totalBytes / 1024 / 1024).toFixed(1)} MB) — concurrencia ${CONCURRENCY}${FORCE ? ' — FORZANDO resubida' : ''}`,
  );
  if (DRY_RUN) {
    console.log('[publish] dry-run: no se sube nada');
    console.log(`[publish] carpetas: ${JSON.stringify(manifest.folders)}`);
    return;
  }

  const existing = FORCE ? new Set() : await listExisting();
  const pending = entries.filter((rel) => !existing || !existing.has(rel));
  if (pending.length === 0) {
    console.log('[publish] todo estaba ya publicado; nada que hacer');
    return;
  }
  console.log(`[publish] por subir: ${pending.length}`);

  let done = 0;
  let uploaded = 0;
  const failures = [];

  const worker = async (queue) => {
    while (queue.length > 0) {
      const rel = queue.shift();
      const abs = path.join(ROOT, 'data', rel);
      if (!fs.existsSync(abs)) {
        failures.push({ rel, error: 'archivo ausente en disco' });
        continue;
      }
      const put = await run('vercel', [
        'blob', 'put', abs,
        '--pathname', rel,
        '--access', 'public',
        '--scope', SCOPE,
      ]);
      if (put.code === 0) uploaded += 1;
      else failures.push({ rel, error: (put.stderr || put.stdout).trim().slice(0, 200) });
      done += 1;
      if (done % 100 === 0 || done === pending.length) {
        console.log(`[publish] ${done}/${pending.length} (subidas ${uploaded}, fallos ${failures.length})`);
      }
    }
  };

  const queue = [...pending];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

  console.log(`\n[publish] subidas: ${uploaded} | fallos: ${failures.length}`);
  if (failures.length > 0) {
    console.log('[publish] fallos (muestra):');
    for (const failure of failures.slice(0, 10)) console.log(`   ✖ ${failure.rel}: ${failure.error}`);
    console.log('[publish] vuelve a ejecutar el script: reintenta solo lo que falta');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[publish] ERROR', error);
  process.exit(1);
});
