/**
 * Marca fichas como GRADUADAS. Uso (desde la raíz, con el mismo entorno del servicio):
 *   TURSO_DATABASE_URL=file:$HOME/data/vtuberdex/turso-local.db npm run marcar:graduados -- drawchii "yeicokp harv"
 *   ... -- --quitar nombre     desmarca
 *   ... -- --seco nombre...    solo muestra qué haría
 * Cada argumento se busca por slug o nombre EXACTO (sin tildes ni mayúsculas); si no hay ficha o hay más de
 * una, la lista y NO marca nada de esa línea: adivinar marcaría a otra persona.
 */
import { dbConDiario } from '../lib/diario.mjs';
import { ejecutorDeSolicitudes } from '../lib/solicitudes.mjs';
import { fijarGraduado } from '../server/src/solicitudes.mjs';
import { normalizeText } from '../server/src/text.mjs';

const args = process.argv.slice(2);
const quitar = args.includes('--quitar');
const seco = args.includes('--seco');
const nombres = args.filter((a) => !a.startsWith('--'));
if (!nombres.length) {
  console.error('Pasa al menos un nombre o slug.');
  process.exit(1);
}

const db = await dbConDiario();
const e = await ejecutorDeSolicitudes();
const filas = db.prepare('SELECT id, slug, name FROM vtuber').all();
let problemas = 0;
for (const nombre of nombres) {
  const q = normalizeText(nombre);
  const hallazgos = filas.filter((f) => normalizeText(f.slug) === q || normalizeText(f.name) === q);
  if (hallazgos.length !== 1) {
    problemas += 1;
    console.log(`✗ «${nombre}»: ${hallazgos.length ? 'ambiguo → ' + hallazgos.map((f) => `${f.name} (${f.slug})`).join(', ') : 'sin coincidencia exacta'}`);
    continue;
  }
  const [f] = hallazgos;
  if (!seco) await fijarGraduado(e, f.id, !quitar);
  console.log(`✓ ${f.name} (${f.slug}, id ${f.id}) ${seco ? 'se marcaría' : quitar ? 'desmarcada' : 'graduada'}`);
}
process.exit(problemas ? 2 : 0);
