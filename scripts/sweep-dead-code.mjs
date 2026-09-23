/**
 * Barrido de código muerto: exports y funciones sin consumidores.
 *
 * No borra nada: informa. La decisión de qué es muerto y qué es API pública la toma una
 * persona, porque un export sin consumidor puede ser (a) resto de un refactor, (b) parte del
 * contrato de un paquete, o (c) usado por un test. Aquí se distinguen los tres casos.
 *
 * Se lanza desde la raíz: node scripts/sweep-dead-code.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const RAIZ = process.cwd();
const IGNORAR = new Set(['node_modules', '.next', '.git', '.verify-stage', 'dist', 'out', 'cache']);

/** Todos los archivos de código del repo, sin los directorios ignorados. */
function archivos(dir, acc = []) {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const ruta = join(dir, entrada);
    const info = statSync(ruta);
    if (info.isDirectory()) archivos(ruta, acc);
    else if (/\.(mjs|js|ts|tsx)$/.test(entrada)) acc.push(ruta);
  }
  return acc;
}

const ARCHIVOS = archivos(RAIZ);
const FUENTES = ARCHIVOS.filter((f) => !/\.test\.(ts|tsx|mjs|js)$/.test(f));
const TESTS = ARCHIVOS.filter((f) => /\.test\.(ts|tsx|mjs|js)$/.test(f));

const leer = (f) => readFileSync(f, 'utf8');
const rel = (f) => relative(RAIZ, f);

/** Exports con nombre de un archivo: nombre -> línea. */
function exportsDe(fuente) {
  const salida = [];
  const patrones = [
    /^export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+const\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+class\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+interface\s+([A-Za-z0-9_$]+)/gm,
    /^export\s+type\s+([A-Za-z0-9_$]+)/gm,
  ];
  for (const patron of patrones) {
    for (const m of fuente.matchAll(patron)) salida.push(m[1]);
  }
  // `export { a, b }` y `export { DB_PATH, MANIFEST_PATH }`.
  for (const m of fuente.matchAll(/^export\s*\{([^}]+)\}/gm)) {
    for (const trozo of m[1].split(',')) {
      const nombre = trozo.trim().split(/\s+as\s+/).pop()?.trim();
      if (nombre) salida.push(nombre);
    }
  }
  return salida;
}

/**
 * Cuenta los usos de cada nombre fuera de su propio archivo, y separa los que vienen de
 * TESTS (un símbolo que solo usan los tests es sospechoso: suele ser un resto del refactor,
 * no API pública).
 */
function consumidores(nombre, propio) {
  const usos = { fuente: [], test: [] };
  const patron = new RegExp(`\\b${nombre.replace(/\$/g, '\\$')}\\b`);
  for (const f of ARCHIVOS) {
    if (f === propio) continue;
    const contenido = leer(f);
    if (!patron.test(contenido)) continue;
    (TESTS.includes(f) ? usos.test : usos.fuente).push(rel(f));
  }
  return usos;
}

console.log('=== EXPORTS SIN CONSUMIDORES FUERA DE SU ARCHIVO ===\n');
const muertos = [];
for (const f of FUENTES) {
  const fuente = leer(f);
  for (const nombre of exportsDe(fuente)) {
    const usos = consumidores(nombre, f);
    const total = usos.fuente.length + usos.test.length;
    if (total === 0) {
      // ¿se usa DENTRO de su propio archivo? Entonces el export sobra, no la función.
      const interno = new RegExp(`\\b${nombre}\\b`, 'g');
      const dentro = (fuente.match(interno) ?? []).length;
      muertos.push({ archivo: rel(f), nombre, interno: dentro > 1, usos });
    }
  }
}

for (const m of muertos) {
  const nota = m.interno
    ? 'usado DENTRO del módulo -> solo sobra el `export`'
    : 'sin ningún uso -> candidato a borrar entero';
  console.log(`${rel(join(RAIZ, m.archivo)).padEnd(42)} ${m.nombre.padEnd(24)} ${nota}`);
}
console.log(`\ntotal: ${muertos.length} exports sin consumidores externos`);

/*
 * NOTA: aquí había un chequeo de `export default` sin consumidor por defecto. Se quitó
 * porque era un FALSO POSITIVO sistemático y un guard que siempre miente es peor que no
 * tenerlo: en este repo los componentes se exportan por NOMBRE (`export function CatalogPage`)
 * y el `export default` es el requisito de Next para las páginas de `app/` (más la config de
 * eslint/next/postcss, que las herramientas importan por su cuenta). El chequeo marcaba 23
 * archivos "muertos" que estaban todos vivos.
 */
