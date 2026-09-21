/**
 * Importa a SQLite el texto personalizado extraído por OCR de las cartas.
 *
 * Va SEPARADO del seed principal porque el OCR es un proceso largo y opcional:
 * el catálogo debe poder importarse sin él. Se ejecuta después:
 *
 *   node src/import-ocr.mjs [--ocr ../scraper/out/ocr.json] [--min-confidence 40]
 *
 * Solo escribe `card_text` y `card_text_confidence`; no toca el resto de la
 * ficha. Reindexar el buscador después es responsabilidad del llamador (o usa
 * `--reindex`, que refresca FTS y contadores de facetas).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase } from './db/index.mjs';
import { setMeta } from './db/index.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const OCR_PATH = path.resolve(value('ocr', path.join(ROOT, 'scraper', 'out', 'ocr.json')));
const MIN_CONFIDENCE = Number(value('min-confidence', '40'));
const MIN_LENGTH = Number(value('min-length', '40'));
const DB_PATH = value('db', process.env.VTUBERDEX_DB);

/** Limpia artefactos habituales del OCR sin destruir el contenido. */
export function cleanOcrText(raw) {
  return String(raw ?? '')
    // Espacios múltiples y saltos raros.
    .replace(/\s+/g, ' ')
    // Guiones de corte de columna que el OCR mete a mitad de palabra.
    .replace(/(\w)-\s+(\w)/g, '$1$2')
    .trim();
}

export function importOcr({ db, ocr, minConfidence = MIN_CONFIDENCE, minLength = MIN_LENGTH }) {
  const update = db.prepare(
    `UPDATE vtuber SET card_text = ?, card_text_confidence = ?, updated_at = datetime('now')
     WHERE dex_number = ?`,
  );
  const findSlug = db.prepare('SELECT id, slug FROM vtuber WHERE dex_number = ?');

  let saved = 0;
  let skipped = 0;
  let missing = 0;
  const porConfianza = { alta: 0, media: 0, baja: 0 };

  db.exec('BEGIN');
  try {
    for (const item of ocr.items) {
      const text = cleanOcrText(item.text);
      const confidence = typeof item.confidence === 'number' ? item.confidence : 0;
      // Se descarta lo que el OCR no pudo leer con un mínimo de fiabilidad: es
      // preferible un hueco a un texto corrupto en la ficha.
      if (item.error || text.length < minLength || confidence < minConfidence) {
        skipped += 1;
        continue;
      }
      const row = findSlug.get(item.dexNumber);
      if (!row) {
        missing += 1;
        continue;
      }
      update.run(text, confidence, item.dexNumber);
      saved += 1;
      if (confidence >= 80) porConfianza.alta += 1;
      else if (confidence >= 60) porConfianza.media += 1;
      else porConfianza.baja += 1;
    }
    setMeta(db, 'ocr_imported_at', new Date().toISOString());
    setMeta(db, 'ocr_source', path.relative(ROOT, OCR_PATH));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { saved, skipped, missing, porConfianza };
}

/** Refresca el índice full-text y los contadores de facetas. */
export function reindex(db) {
  db.exec(`
    DELETE FROM vtuber_fts;
    INSERT INTO vtuber_fts (rowid, name, phrase, tags)
    SELECT v.id,
           v.name,
           COALESCE(v.phrase, '') || ' ' || COALESCE(v.card_text, ''),
           COALESCE((SELECT group_concat(t.label, ' ') FROM vtuber_tag vt JOIN tag t ON t.id = vt.tag_id WHERE vt.vtuber_id = v.id), '')
           || ' ' ||
           COALESCE((SELECT group_concat(c.name, ' ') FROM vtuber_country vc JOIN country c ON c.id = vc.country_id WHERE vc.vtuber_id = v.id), '')
    FROM vtuber v WHERE v.status = 'published';
    UPDATE country SET vtuber_count = (
      SELECT COUNT(*) FROM vtuber_country vc JOIN vtuber v ON v.id = vc.vtuber_id
      WHERE vc.country_id = country.id AND v.status = 'published');
    UPDATE tag SET vtuber_count = (
      SELECT COUNT(*) FROM vtuber_tag vt JOIN vtuber v ON v.id = vt.vtuber_id
      WHERE vt.tag_id = tag.id AND v.status = 'published');
    UPDATE faction SET vtuber_count = (
      SELECT COUNT(*) FROM vtuber_faction vf JOIN vtuber v ON v.id = vf.vtuber_id
      WHERE vf.faction_id = faction.id AND v.status = 'published');
  `);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(OCR_PATH)) {
    console.error(`✖ falta ${OCR_PATH} (corre antes: scraper/src/ocr.mjs)`);
    process.exit(1);
  }
  const ocr = JSON.parse(fs.readFileSync(OCR_PATH, 'utf8'));
  const db = openDatabase(DB_PATH);
  const result = importOcr({ db, ocr });
  if (flag('reindex')) {
    reindex(db);
    console.log('[ocr-import] índice full-text refrescado');
  }
  const total = db.prepare('SELECT COUNT(*) AS n FROM vtuber WHERE card_text IS NOT NULL').get().n;
  const soloImagen = db
    .prepare(
      `SELECT COUNT(*) AS n FROM vtuber WHERE card_text IS NOT NULL AND has_detail = 0`,
    )
    .get().n;
  console.log(`[ocr-import] guardados: ${result.saved} | descartados: ${result.skipped} | sin fila: ${result.missing}`);
  console.log(`[ocr-import] precisión -> alta(≥80): ${result.porConfianza.alta} media: ${result.porConfianza.media} baja: ${result.porConfianza.baja}`);
  console.log(`[ocr-import] en la base: ${total} fichas con card_text (${soloImagen} sin ficha de detalle)`);
  db.close();
}
