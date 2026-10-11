/**
 * Simulacro del recálculo de experiencia: pasa TODAS las fichas por la fórmula única
 * (`experienciaDeFicha`, `server/src/experiencia.mjs`) y compara con el nivel que traían. Solo lee.
 *
 *   npm run informe:experiencia                  resumen + top 15 + fichas que más bajan
 *   npm run informe:experiencia -- --slug x      el desglose de una ficha
 *   npm run informe:experiencia -- --json        todo, para procesarlo aparte
 *
 * Corre con el entorno de producción (Turso: likes, XP de juego, premium y ediciones) o informará con la
 * base empaquetada y sin likes. El nivel «antes» es el que traía la ficha o el mantenedor.
 */
import { dbConDiario } from '../lib/diario.mjs';
import { contarLikes, experienciaDe } from '../lib/likes.mjs';
import { xpJuegoDe } from '../lib/minecraft.mjs';
import { searchVtubers } from '../server/src/search.mjs';

const args = process.argv.slice(2);
const slug = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;
const comoJson = args.includes('--json');

const db = await dbConDiario();
// `searchVtubers` pagina (100 como máximo): se recorre hasta agotar las páginas.
const cartas = [];
for (let page = 1, paginas = 1; page <= paginas; page += 1) {
  const r = searchVtubers(db, { page, perPage: 100, includeHidden: true });
  cartas.push(...r.items);
  paginas = r.pageCount;
}
const filas = [];
for (const card of cartas) {
  if (slug && card.slug !== slug) continue;
  const [likes, xpJuego] = await Promise.all([contarLikes(card.id), xpJuegoDe(card.id)]);
  const exp = experienciaDe(card, likes, xpJuego);
  filas.push({ dex: card.dexNumber, slug: card.slug, antes: card.level ?? null, despues: exp.level, likes, premium: card.premium?.grade ?? null, ...exp.desglose });
}

if (comoJson) {
  console.log(JSON.stringify(filas, null, 2));
} else if (slug) {
  console.table(filas);
} else {
  const niveles = filas.map((f) => f.despues).sort((a, b) => a - b);
  const q = (p) => niveles[Math.min(niveles.length - 1, Math.floor(niveles.length * p))];
  console.log(`${filas.length} fichas · nivel después: min ${niveles[0]} · p50 ${q(0.5)} · p90 ${q(0.9)} · max ${niveles.at(-1)}`);
  console.log('Top 15:');
  console.table([...filas].sort((a, b) => b.total - a.total).slice(0, 15));
  console.log('Fichas que más bajan de nivel:');
  console.table(filas.filter((f) => f.antes !== null && f.despues < f.antes).sort((a, b) => b.antes - b.despues - (a.antes - a.despues)).slice(0, 15));
}
