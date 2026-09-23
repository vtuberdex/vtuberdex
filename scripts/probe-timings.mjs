/**
 * Sonda de tiempos: cuánto cuesta cada pieza del camino de lectura.
 *
 * Mide el PISO de SQLite (node:sqlite, base empaquetada, en proceso) para poder
 * separar lo que es cómputo local de lo que es red (Turso). Sin Turso no hay
 * forma de saber cuánto de los ~0.8 s de producción es la función y cuánto el
 * catálogo.
 *
 * Se lanza desde la raíz: node scripts/probe-timings.mjs
 */
import { performance } from 'node:perf_hooks';

import { getDb } from '../lib/db.mjs';
import { facetCounts, getNeighbors, getVtuberBySlug, searchVtubers } from '../server/src/search.mjs';

/** Mediana de n ejecuciones, para que un pico de GC no decida el número. */
function mediana(n, fn) {
  const tiempos = [];
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now();
    fn();
    tiempos.push(performance.now() - t0);
  }
  tiempos.sort((a, b) => a - b);
  return Number(tiempos[Math.floor(tiempos.length / 2)].toFixed(2));
}

const t0 = performance.now();
const db = getDb();
const apertura = Number((performance.now() - t0).toFixed(2));

console.log('--- apertura de la base (una vez por instancia) ---');
console.log(`openDatabase():        ${apertura} ms`);

console.log('\n--- consultas del catálogo (piso local, sin red) ---');
console.log(`searchVtubers p24:     ${mediana(20, () => searchVtubers(db, { perPage: 24, page: 1 }))} ms`);
console.log(`searchVtubers p100:    ${mediana(20, () => searchVtubers(db, { perPage: 100, page: 1 }))} ms`);
console.log(`searchVtubers q=hat:   ${mediana(20, () => searchVtubers(db, { q: 'hatsune', perPage: 24, page: 1 }))} ms`);
console.log(`facetCounts():         ${mediana(20, () => facetCounts(db, { language: null, q: '' }))} ms`);

const primera = searchVtubers(db, { perPage: 1, page: 1 }).items[0];
console.log(`getVtuberBySlug():     ${mediana(20, () => getVtuberBySlug(db, primera.slug))} ms`);
console.log(`getNeighbors():        ${mediana(20, () => getNeighbors(db, primera.dexNumber))} ms`);

console.log('\n--- cuántas consultas prepara cada llamada (el coste real) ---');
const cuenta = { prepare: 0, get: 0, all: 0 };
const originales = {};
for (const m of ['prepare']) {
  originales[m] = db[m].bind(db);
  db[m] = (...args) => {
    cuenta.prepare += 1;
    const stmt = originales[m](...args);
    for (const k of ['get', 'all', 'run']) {
      const orig = stmt[k].bind(stmt);
      stmt[k] = (...a) => {
        cuenta[k] = (cuenta[k] ?? 0) + 1;
        return orig(...a);
      };
    }
    return stmt;
  };
}
searchVtubers(db, { perPage: 24, page: 1 });
const trasBusqueda = { ...cuenta };
cuenta.prepare = 0;
facetCounts(db, { language: null, q: '' });
console.log(`searchVtubers p24:  prepare=${trasBusqueda.prepare} get=${trasBusqueda.get} all=${trasBusqueda.all}`);
console.log(`facetCounts():      prepare=${cuenta.prepare} get=${cuenta.get} all=${cuenta.all}`);
