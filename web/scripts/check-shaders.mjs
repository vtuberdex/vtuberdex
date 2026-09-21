/**
 * Guard de los shaders GLSL: detecta los dos fallos que rompen la compilación y
 * que NO aparecen ni en `tsc` ni en los tests, solo en la consola del navegador.
 *
 *   1. Backticks dentro de un comentario: los shaders viven en template literals,
 *      así que un backtick en un comentario cierra el string. El error de esbuild
 *      apunta a la línea SIGUIENTE y no menciona el comentario, así que se pierden
 *      muchas iteraciones buscando en el código equivocado.
 *   2. Uniformes usados en el fragment shader pero declarados en otro sitio (o no
 *      declarados): GLSL falla con "undeclared identifier" y la superficie sale
 *      negra o sin el efecto.
 *
 * Uso: node scripts/check-shaders.mjs  (salida != 0 si hay algún fallo)
 */
import fs from 'node:fs';
import path from 'node:path';

const file = path.join(import.meta.dirname, '..', 'src', 'features', 'card3d', 'shaders.ts');
const src = fs.readFileSync(file, 'utf8');
const problemas = [];

// 1) Backticks que no sean la apertura o el cierre de cada shader.
const lineas = src.split('\n');
for (const [i, linea] of lineas.entries()) {
  if (!linea.includes('`')) continue;
  if (/^\s*(export const \w+ = \/\* glsl \*\/ `|`;)\s*$/.test(linea)) continue;
  problemas.push(`backtick fuera de apertura/cierre en la línea ${i + 1}: ${linea.trim()}`);
}

// 2) Uniformes usados sin declarar, por bloque de shader.
const bloques = [...src.matchAll(/export const (\w+) = \/\* glsl \*\/ `([\s\S]*?)`;/g)];
for (const [, nombre, cuerpo] of bloques) {
  const declarados = new Set([...cuerpo.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
  const usados = new Set([...cuerpo.matchAll(/\bu[A-Z]\w*/g)].map((m) => m[0]));
  for (const u of usados) {
    if (!declarados.has(u) && !u.startsWith('uv')) {
      problemas.push(`${nombre}: uniform NO declarado -> ${u}`);
    }
  }
}

if (problemas.length) {
  console.error('SHADERS CON PROBLEMAS:');
  for (const p of problemas) console.error('  - ' + p);
  process.exit(1);
}
console.log('shaders OK (sin backticks sueltos ni uniforms sin declarar)');
