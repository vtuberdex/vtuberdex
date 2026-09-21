/**
 * Build del deploy en Vercel.
 *
 * Deja el proyecto listo para desplegar sin que nada dependa de escribir en
 * disco en tiempo de ejecución (el FS de Vercel es de solo lectura):
 *
 *   1. Compila el front (`web/` -> `web/dist`).
 *   2. Copia ese build a `public/`, que es la carpeta que Vercel reparte por su
 *      CDN. `express.static()` se ignora en Vercel, así que el front tiene que
 *      estar aquí para servirse como estático.
 *   3. Genera la base de solo lectura saneada y el manifiesto de imágenes
 *      (`scripts/build-db.mjs`), que viajan empaquetados en la función.
 *
 * La base NO se copia a `public/`: quedaría accesible por HTTP. Su sitio es
 * `deploy/data/`, que solo entra en el bundle de la función vía `includeFiles`.
 *
 * La URL de Blob no se cablea aquí: el manifiesto guarda rutas y el adaptador
 * las resuelve contra `VTUBERDEX_BLOB_BASE`, así que un store nuevo (otro
 * entorno, preview) no obliga a recompilar.
 *
 * Uso: node scripts/vercel-build.mjs   (también lo llama Vercel como buildCommand)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function step(label, fn) {
  console.log(`\n[build] ▶ ${label}`);
  const result = fn();
  if (result !== 0) {
    console.error(`[build] ✖ falló: ${label}`);
    process.exit(result ?? 1);
  }
}

// 1 + 2. Front: compilar y publicar como estático.
step('front: typecheck', () => {
  const r = spawnSync('npm', ['run', 'typecheck'], { cwd: path.join(ROOT, 'web'), stdio: 'inherit', shell: false });
  return r.status ?? 1;
});

step('front: build', () => {
  const r = spawnSync('npm', ['run', 'build'], { cwd: path.join(ROOT, 'web'), stdio: 'inherit', shell: false });
  return r.status ?? 1;
});

step('front: copiar web/dist -> public', () => {
  const dist = path.join(ROOT, 'web', 'dist');
  const publicDir = path.join(ROOT, 'public');
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    console.error(`[build] no hay build del front en ${dist}`);
    return 1;
  }
  fs.rmSync(publicDir, { recursive: true, force: true });
  fs.cpSync(dist, publicDir, { recursive: true });
  const files = fs.readdirSync(publicDir);
  console.log(`[build] public/: ${files.join(', ')}`);
  return 0;
});

// 3. Datos: base saneada + manifiesto.
step('datos: base de solo lectura + manifiesto de imágenes', () => {
  const args = [path.join(HERE, 'build-db.mjs')];
  if (process.env.VTUBERDEX_BLOB_BASE) args.push('--blob-base', process.env.VTUBERDEX_BLOB_BASE);
  const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  return r.status ?? 1;
});

step('verificar que la base no quedó publicada', () => {
  const leaked = [
    path.join(ROOT, 'public', 'vtuberdex.db'),
    path.join(ROOT, 'public', 'data'),
    path.join(ROOT, 'public', 'deploy'),
  ].filter((p) => fs.existsSync(p));
  if (leaked.length > 0) {
    console.error(`[build] la base de datos quedó en la carpeta pública: ${leaked.join(', ')}`);
    return 1;
  }
  console.log('[build] la base no es accesible por HTTP');
  return 0;
});

console.log('\n[build] listo');
