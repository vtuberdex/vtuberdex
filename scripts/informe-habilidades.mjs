/**
 * Pasa el validador de habilidades (`server/src/habilidades.mjs`) por TODAS las fichas con kit e
 * informa qué reglas se rompen. Solo lee: no corrige nada.
 *
 *   npm run informe:habilidades                     resumen por regla + fichas con más errores
 *   npm run informe:habilidades -- --slug madkoding el detalle de una ficha
 *   npm run informe:habilidades -- --codigo verbo_invertido   las fichas que rompen esa regla
 *   npm run informe:habilidades -- --json > x.json  todo, para procesarlo aparte
 *
 * Lee la base con el diario aplicado (`dbConDiario`), igual que `marcar:graduados`: en la VPS hay que
 * correrlo con el entorno del servicio (`TURSO_DATABASE_URL=file:...`) o informará sobre la base
 * empaquetada, sin las ediciones del mantenedor.
 */
import { dbConDiario } from '../lib/diario.mjs';
import { CODIGOS, validarKit } from '../server/src/habilidades.mjs';

const args = process.argv.slice(2);
const valor = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};
const soloSlug = valor('--slug');
const soloCodigo = valor('--codigo');
const comoJson = args.includes('--json');

const db = await dbConDiario();
const fichas = db
  .prepare(
    `SELECT v.id, v.slug, v.name, v.dex_number AS dex
       FROM vtuber v
      WHERE EXISTS (SELECT 1 FROM skill s WHERE s.vtuber_id = v.id)
      ORDER BY v.dex_number`,
  )
  .all();
const leerHabilidades = db.prepare(
  `SELECT category, name, effect_html AS effectHtml FROM skill
    WHERE vtuber_id = ? AND category IN ('active', 'passive', 'ultimate')
    ORDER BY category, position, id`,
);
const leerFacciones = db.prepare(
  `SELECT f.slug FROM vtuber_faction vf JOIN faction f ON f.id = vf.faction_id
    WHERE vf.vtuber_id = ? ORDER BY vf.position`,
);

const informe = [];
for (const f of fichas) {
  if (soloSlug && f.slug !== soloSlug) continue;
  const habilidades = leerHabilidades.all(f.id);
  const facciones = leerFacciones.all(f.id).map((r) => r.slug);
  // Una ficha sin facciones no dice nada de la exclusividad: no se acusa a ciegas.
  let problemas = validarKit({ habilidades, facciones: facciones.length ? facciones : null });
  if (soloCodigo) problemas = problemas.filter((p) => p.codigo === soloCodigo);
  const ultimate = habilidades.find((h) => h.category === 'ultimate');
  informe.push({ ...f, facciones, ultimateConDado: /1d6/i.test(ultimate?.effectHtml ?? ''), problemas });
}

if (comoJson) {
  console.log(JSON.stringify(informe, null, 2));
  process.exit(0);
}

const dex = (n) => `#${String(n).padStart(3, '0')}`;

if (soloSlug) {
  const f = informe[0];
  if (!f) {
    console.error(`No hay ninguna ficha con kit y slug «${soloSlug}».`);
    process.exit(1);
  }
  console.log(`${dex(f.dex)} ${f.name} (${f.facciones.join(', ') || 'sin facciones'})`);
  if (!f.problemas.length) console.log('  Cumple todas las reglas que se pueden comprobar.');
  for (const p of f.problemas) console.log(`  [${p.gravedad}] ${p.pieza}: ${p.detalle}  (${p.codigo})`);
  process.exit(0);
}

const porCodigo = new Map();
for (const f of informe) {
  for (const codigo of new Set(f.problemas.map((p) => p.codigo))) {
    porCodigo.set(codigo, (porCodigo.get(codigo) ?? 0) + 1);
  }
}
const conErrores = informe.filter((f) => f.problemas.some((p) => p.gravedad === 'error'));
const limpias = informe.filter((f) => !f.problemas.length);

console.log(`Fichas con kit: ${informe.length}`);
console.log(`  sin ningún problema: ${limpias.length}`);
console.log(`  con al menos un error: ${conErrores.length}`);
console.log(`  Ultimates con 1d6: ${informe.filter((f) => f.ultimateConDado).length} (el prompt pide no usarlo siempre)`);
console.log('\nFichas afectadas por regla:');
for (const [codigo, descripcion] of Object.entries(CODIGOS)) {
  const n = porCodigo.get(codigo) ?? 0;
  if (n) console.log(`  ${String(n).padStart(4)}  ${descripcion}  (${codigo})`);
}

const peores = [...conErrores]
  .sort((a, b) => b.problemas.filter((p) => p.gravedad === 'error').length - a.problemas.filter((p) => p.gravedad === 'error').length)
  .slice(0, soloCodigo ? Infinity : 15);
console.log(soloCodigo ? `\nFichas con «${soloCodigo}»:` : '\nLas 15 fichas con más errores:');
for (const f of soloCodigo ? informe.filter((x) => x.problemas.length) : peores) {
  const errores = f.problemas.filter((p) => p.gravedad === 'error').length;
  console.log(`  ${dex(f.dex)} ${f.name} (${f.slug}): ${errores} errores, ${f.problemas.length - errores} avisos`);
}
console.log('\nDetalle de una ficha: npm run informe:habilidades -- --slug <slug>');
