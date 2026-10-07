// Copia TODAS las tablas de Turso a un archivo SQLite local (libsql `file:`), para
// dejar de depender del servicio. Uso:
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run copiar:turso [-- --salida data/turso-local.db]
// El token solo se lee del entorno: no se escribe en ningún archivo.
import { createClient } from '@libsql/client/node';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const i = process.argv.indexOf('--salida');
const salida = resolve(i > 0 ? process.argv[i + 1] : 'data/turso-local.db');
const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
if (!url) { console.error('✖ falta TURSO_DATABASE_URL'); process.exit(1); }

mkdirSync(dirname(salida), { recursive: true });
for (const s of ['', '-wal', '-shm']) rmSync(salida + s, { force: true });

const origen = createClient({ url, authToken });
const destino = createClient({ url: `file:${salida}` });

async function conReintentos(fn, intentos = 5) {
  for (let k = 1; ; k++) {
    try { return await fn(); } catch (e) {
      if (k >= intentos) throw e;
      await new Promise((r) => setTimeout(r, 1000 * k));
    }
  }
}

const { rows: objetos } = await origen.execute(
  "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name");
const tablas = objetos.filter((o) => o.type === 'table');
for (const t of tablas) await destino.execute(String(t.sql));

for (const t of tablas) {
  const nombre = String(t.name);
  const q = `"${nombre.replace(/"/g, '""')}"`;
  let n = 0;
  const lote = nombre === 'asset_remoto' ? 5 : 200; // cada fila de asset lleva una imagen entera
  for (let off = 0; ; off += lote) {
    const { rows, columns } = await conReintentos(() => origen.execute(`SELECT * FROM ${q} ORDER BY rowid LIMIT ${lote} OFFSET ${off}`));
    if (!rows.length) break;
    const sql = `INSERT INTO ${q} (${columns.map((c) => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`;
    await destino.batch(rows.map((r) => ({ sql, args: columns.map((c) => r[c]) })), 'write');
    n += rows.length;
  }
  console.log(`${nombre}: ${n} filas`);
}
for (const o of objetos.filter((o) => o.type !== 'table')) {
  try { await destino.execute(String(o.sql)); } catch (e) { console.warn(`aviso ${o.name}: ${e.message}`); }
}
console.log(`✓ copia en ${salida}`);
origen.close(); destino.close();
