// Respaldo de la base local (la única copia de las ediciones y de las imágenes del mantenedor).
// Uso: node scripts/respaldo-db.mjs [origen.db] [carpeta] [conservar]
// `VACUUM INTO` da una copia consistente con el servicio encendido y la base en WAL;
// copiar solo el `.db` a mano perdería lo que aún está en el `-wal`.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const origen = process.argv[2] ?? `${process.env.HOME}/data/vtuberdex/turso-local.db`;
const carpeta = process.argv[3] ?? `${process.env.HOME}/backups/vtuberdex`;
const conservar = Number(process.argv[4] ?? 7);

mkdirSync(carpeta, { recursive: true });
const sello = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const destino = join(carpeta, `turso-local-${sello}.db`);

const db = new DatabaseSync(origen, { readOnly: true });
db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
db.close();

const check = new DatabaseSync(destino, { readOnly: true });
const { integrity_check: ok } = check.prepare('PRAGMA integrity_check').get();
check.close();
if (ok !== 'ok') { console.error(`✖ la copia ${destino} no pasa integrity_check: ${ok}`); process.exit(1); }

const copias = readdirSync(carpeta).filter((f) => /^turso-local-.*\.db$/.test(f)).sort();
for (const f of copias.slice(0, Math.max(0, copias.length - conservar))) rmSync(join(carpeta, f));
console.log(`✓ ${destino} (${(statSync(destino).size / 1048576).toFixed(0)} MB); ${Math.min(copias.length, conservar)} copias`);
