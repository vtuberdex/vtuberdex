/**
 * Publica las imágenes del catálogo en Turso (antes en Vercel Blob).
 *
 * POR QUÉ CAMBIÓ
 * --------------
 * Vercel Blob en Hobby da **2.000 "Advanced Operations" al mes y cada `put` es una**.
 * Subir las 1.593 imágenes agotó la cuota y la tienda quedó **bloqueada 30 días**
 * (`403 Your store is blocked`), así que el sitio publicado se quedó sin imágenes. No
 * fue el tamaño —73 MB de 1 GB— sino el NÚMERO de operaciones: 1.593 `put` contra una
 * cuota de 2.000, sin margen para reintentos ni para el propio panel de Vercel (navegar
 * el store en el dashboard también cuenta como operación avanzada).
 *
 * Turso se cobra por FILAS ESCRITAS y el plan gratuito tiene **10 millones al mes**:
 * subir 1.593 imágenes es el 0,016% de la cuota, y sus 73 MB son el 1,5% de los 5 GB.
 * La misma operación que agotó Blob no roza Turso.
 *
 * Los bytes van al BLOB de `asset_remoto` y el nombre del asset sigue siendo CANÓNICO
 * por slug, así que re-subir SOBRESCRIBE la MISMA fila en vez de crear un duplicado.
 *
 * DOS ORÍGENES, Y LA RAZÓN
 * ------------------------
 * `asset_remoto` distingue `origen = 'catalogo'` (lo que sube este script, desde el
 * manifiesto) de `origen = 'mantenedor'` (lo que sube una persona desde el mantenedor).
 * Al principio compartían fila y eso hacía que subir una imagen desde el mantenedor
 * **borrara la copia del catálogo**: no había vuelta atrás. Con orígenes separados, el
 * reemplazo del mantenedor tapa al del catálogo pero no lo toca, y borrarlo lo deja
 * volver a la vista. Este script ignora las filas de `mantenedor` por completo: ni las
 * poda (no están en el manifiesto) ni las cuenta.
 *
 * Reanudable, que importa con ~1.600 archivos:
 *   · Se consulta de una sola vez qué hay ya en Turso (`SELECT slug, kind, size`).
 *   · Se sube en lotes de 25 dentro de un `batch`.
 *   · Un archivo que falla NO se registra, así que volver a correr reintenta solo lo que
 *     falta.
 *
 * Uso:
 *   node scripts/publish-images.mjs                  # sube lo que falte
 *   node scripts/publish-images.mjs --dry-run        # solo informa
 *   node scripts/publish-images.mjs --force          # resubir todo
 *   node scripts/publish-images.mjs --turso-url ... --turso-token ...
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@libsql/client/node';

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
const MANIFEST = path.resolve(ROOT, 'deploy/data/images.json');

/**
 * Carpetas que se publican. Las retiradas (`thumb`, `avatar`, `ficha`, `radar`, `card`)
 * NO: sus archivos siguen en disco pero ninguna vista los pide, y publicarlas era lo que
 * inflaba el manifiesto y el número de operaciones.
 */
const USED_FOLDERS = new Set(['character', 'logo', 'faction', 'background']);

const URL_TURSO = value('turso-url', process.env.TURSO_DATABASE_URL ?? '');
const AUTH = value('turso-token', process.env.TURSO_AUTH_TOKEN ?? '');

/** Tipo por extensión: las carpetas publicadas son `.webp` y los emblemas `.png`. */
const MIME = { '.webp': 'image/webp', '.png': 'image/png' };

/**
 * Assets a subir, leídos del MANIFIESTO y no de un recorrido de `data/images/`: así solo
 * se sube lo que de verdad está publicado, y una carpeta retirada no puede colarse por
 * seguir existiendo en disco.
 */
function pendientesDelManifiesto(manifest) {
  const lista = [];
  for (const rel of Object.keys(manifest.images ?? {})) {
    const partes = String(rel).split('/');
    if (!USED_FOLDERS.has(partes[1])) continue;
    const abs = path.join(ROOT, 'data', rel);
    if (!fs.existsSync(abs)) {
      console.warn(`[publish] ⚠ omitido (no está en disco): ${rel}`);
      continue;
    }
    const ext = path.extname(abs).toLowerCase();
    lista.push({
      rel,
      abs,
      kind: partes[1],
      slug: path.basename(abs, ext),
      mime: MIME[ext] ?? 'application/octet-stream',
      bytes: fs.statSync(abs).size,
    });
  }
  return lista;
}

async function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`✖ falta el manifiesto: ${MANIFEST} (corre antes: node scripts/build-db.mjs)`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const todos = pendientesDelManifiesto(manifest);
  if (todos.length === 0) {
    console.error('✖ el manifiesto no tiene imágenes publicables');
    process.exit(1);
  }
  console.log(
    `[publish] ${todos.length} imágenes (${(todos.reduce((s, a) => s + a.bytes, 0) / 1024 / 1024).toFixed(1)} MB)${FORCE ? ' — FORZANDO resubida' : ''}`,
  );

  if (DRY_RUN) {
    console.log('[publish] dry-run: no se sube nada');
    console.log(`[publish] carpetas: ${JSON.stringify(manifest.folders)}`);
    return;
  }

  if (!URL_TURSO) {
    console.error('✖ falta TURSO_DATABASE_URL (o --turso-url).');
    console.error('  Vercel Blob quedó bloqueado por cuota: no es un destino válido.');
    process.exit(1);
  }
  const db = createClient({ url: URL_TURSO, authToken: AUTH || undefined });
  /**
   * El esquema NO se redefine aquí: se aplica el de `lib/ediciones.mjs`, que es la única
   * fuente. Tener el `CREATE TABLE` escrito dos veces fue lo que permitió que la tabla
   * quedara con una forma mientras el código esperaba otra; con una sola definición, la
   * migración de `origen` se aplica también desde este script.
   */
  process.env.TURSO_DATABASE_URL = URL_TURSO;
  if (AUTH) process.env.TURSO_AUTH_TOKEN = AUTH;
  const { asegurarTablas } = await import('../lib/ediciones.mjs');
  await asegurarTablas();

  /**
   * El publicador mira SOLO las filas de origen `catalogo`.
   *
   * Las del mantenedor son de otra persona y no se comparan ni se podan: si el publicador
   * las viera, las consideraría residuos (no están en el manifiesto) y borraría los
   * reemplazos hechos a mano, y peor, el conteo de "ya publicado" taparía una imagen del
   * catálogo que sí falta subir.
   */
  const { rows } = await db.execute("SELECT slug, kind, size FROM asset_remoto WHERE origen = 'catalogo'");
  const yaEstan = new Map(rows.map((r) => [`${r.kind}/${r.slug}`, Number(r.size)]));
  console.log(`[publish] ya en Turso: ${yaEstan.size}`);

  // Se compara TAMAÑO además de presencia: si el scraper regeneró una imagen, el nombre
  // canónico es el mismo pero el contenido cambió, y sin esta comprobación la versión
  // vieja se quedaría publicada para siempre.
  const cola = FORCE
    ? todos
    : todos.filter((a) => yaEstan.get(`${a.kind}/${a.slug}`) !== a.bytes);

  /**
   * PODA: lo que está en Turso y ya no está en el manifiesto es un residuo (p. ej. los
   * emblemas de una campaña retirada). El publicador es la fuente de la verdad de qué
   * debe existir, así que también limpia lo que sobra.
   */
  const esperados = new Set(todos.map((a) => `${a.kind}/${a.slug}`));
  const residuos = [...yaEstan.keys()].filter((clave) => !esperados.has(clave));
  if (residuos.length > 0) {
    console.log(`[publish] residuos por borrar: ${residuos.length}`);
    if (!FORCE) {
      for (let i = 0; i < residuos.length; i += 100) {
        const lote = residuos.slice(i, i + 100);
        await db.batch(
          lote.map((clave) => {
            const [kind, ...resto] = clave.split('/');
            return {
              sql: "DELETE FROM asset_remoto WHERE slug = ? AND kind = ? AND origen = 'catalogo'",
              args: [resto.join('/'), kind],
            };
          }),
          'write',
        );
      }
      console.log('[publish] residuos borrados');
    }
  }

  if (cola.length === 0) {
    console.log('[publish] todo estaba ya publicado; nada que subir');
    await db.close();
    return;
  }
  console.log(`[publish] por subir: ${cola.length}`);

  // Lotes de 25 dentro de un `batch` (una transacción): si algo falla a mitad, lo ya
  // subido queda y volver a correr reintenta exactamente lo que falta.
  const LOTE = 25;
  let subidas = 0;
  const fallos = [];

  for (let i = 0; i < cola.length; i += LOTE) {
    const lote = cola.slice(i, i + LOTE);
    const sentencias = [];
    for (const a of lote) {
      try {
        const bytes = fs.readFileSync(a.abs);
        sentencias.push({
          sql: `INSERT INTO asset_remoto (slug, kind, origen, mime, bytes, size, actualizado)
                VALUES (?, ?, 'catalogo', ?, ?, ?, datetime('now'))
                ON CONFLICT (slug, kind, origen) DO UPDATE
                  SET bytes = excluded.bytes, mime = excluded.mime,
                      size = excluded.size, actualizado = excluded.actualizado`,
          args: [a.slug, a.kind, a.mime, bytes, bytes.length],
        });
      } catch (error) {
        fallos.push({ rel: a.rel, error: error.message });
      }
    }
    if (sentencias.length > 0) {
      try {
        await db.batch(sentencias, 'write');
        subidas += sentencias.length;
      } catch (error) {
        for (const a of lote) fallos.push({ rel: a.rel, error: error.message });
      }
    }
    const hechos = Math.min(i + LOTE, cola.length);
    if (hechos % 250 < LOTE || hechos === cola.length) {
      console.log(`[publish] ${hechos}/${cola.length} (subidas ${subidas}, fallos ${fallos.length})`);
    }
  }

  const { rows: finales } = await db.execute(
    "SELECT COUNT(*) AS n, SUM(size) AS bytes FROM asset_remoto WHERE origen = 'catalogo'",
  );
  const n = Number(finales[0].n);
  const bytes = Number(finales[0].bytes ?? 0);
  console.log(`\n[publish] subidas: ${subidas} | fallos: ${fallos.length}`);
  console.log(`[publish] catálogo en Turso ahora: ${n} objetos, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  // Los reemplazos del mantenedor se informan aparte: cuentan como "no es lo que publicó
  // el manifiesto", pero no deben alterar la comprobación de integridad del catálogo.
  const { rows: propios } = await db.execute(
    "SELECT COUNT(*) AS n FROM asset_remoto WHERE origen = 'mantenedor'",
  );
  if (Number(propios[0].n) > 0) {
    console.log(`[publish] reemplazos del mantenedor (intactos, no se tocan): ${Number(propios[0].n)}`);
  }
  if (n !== todos.length) {
    console.warn(`[publish] ⚠ el manifiesto declara ${todos.length} y en Turso hay ${n}`);
  }
  if (fallos.length > 0) {
    console.log('[publish] fallos (muestra):');
    for (const f of fallos.slice(0, 10)) console.log(`   ✖ ${f.rel}: ${f.error}`);
    console.log('[publish] vuelve a ejecutar el script: reintenta solo lo que falta');
    process.exitCode = 1;
  }
  await db.close();
}

main().catch((error) => {
  console.error('[publish] ERROR', error.message);
  process.exit(1);
});
