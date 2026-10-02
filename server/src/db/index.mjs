/**
 * Acceso a SQLite y utilidades de esquema.
 *
 * Se usa `node:sqlite` (incluido en Node 22+) para que el contenedor de datos
 * sea un único archivo, sin dependencias nativas que compilar.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { consolidarFacciones } from './../mutations.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_PATH = path.join(HERE, 'schema.sql');
export const DEFAULT_DB_PATH = process.env.VTUBERDEX_DB
  ? path.resolve(process.env.VTUBERDEX_DB)
  : path.resolve(HERE, '..', '..', '..', 'data', 'vtuberdex.db');

/**
 * Migraciones incrementales.
 *
 * El esquema usa `CREATE TABLE IF NOT EXISTS`, así que una columna nueva NO se
 * añade a una base ya existente. Cada migración se aplica una sola vez y queda
 * registrada en `meta` para que abrir la base sea idempotente.
 */
const MIGRATIONS = [
  {
    id: '2026-09-add-card-text',
    sql: `ALTER TABLE vtuber ADD COLUMN card_text TEXT;
          ALTER TABLE vtuber ADD COLUMN card_text_confidence INTEGER;`,
  },
  {
    /**
     * Da cabida al asset `character`: la figura recortada y normalizada al
     * lienzo de la carta (720x1008). Antes las vistas dibujaban al VTuber con
     * `avatar`, que llega con proporción arbitraria (hay avatares de 1.76 y de
     * 0.42), y al meterlos en un marco de carta salían deformados.
     *
     * SQLite no deja modificar un CHECK con ALTER TABLE, así que la tabla se
     * reconstruye: se copia a una tabla nueva con el CHECK ampliado y se
     * renombra. Los índices y la FK se recrean con ella.
     */
    id: '2026-09-asset-character-kind',
    sql: `DROP VIEW IF EXISTS v_vtuber_card;
          CREATE TABLE asset_new (
            id         INTEGER PRIMARY KEY,
            vtuber_id  INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
            kind       TEXT NOT NULL CHECK (kind IN ('card', 'thumb', 'logo', 'avatar', 'radar', 'character')),
            path       TEXT NOT NULL,
            source_url TEXT,
            width      INTEGER,
            height     INTEGER,
            bytes      INTEGER,
            UNIQUE (vtuber_id, kind)
          );
          INSERT INTO asset_new (id, vtuber_id, kind, path, source_url, width, height, bytes)
            SELECT id, vtuber_id, kind, path, source_url, width, height, bytes FROM asset;
          DROP TABLE asset;
          ALTER TABLE asset_new RENAME TO asset;
          CREATE INDEX IF NOT EXISTS idx_asset_vtuber ON asset (vtuber_id);`,
  },
  {
    /**
     * Unifica `avatar` en `character`.
     *
     * Durante un tiempo el personaje se guardó bajo DOS claves (`avatar` y
     * `character`) apuntando al MISMO archivo `images/character/<slug>.webp`, y
     * las vistas leían una u otra según el archivo: bastaba tocar una para que
     * la carta 3D se quedara sin imagen. Ahora la imagen del VTuber es una sola,
     * `character`, y la ficha apaisada del sitio queda solo como respaldo en
     * disco (nunca como asset).
     */
    id: '2026-09-unify-character-asset',
    sql: `UPDATE OR REPLACE asset SET kind = 'character' WHERE kind = 'avatar';`,
  },
  {
    /**
     * Da cabida al asset `background`: la imagen que la carta 3D pinta POR DETRÁS
     * del personaje. Es un cuarto tipo de imagen fuente, y el único que puede
     * faltar sin que se note: sin fila, `uHasBackground` queda en 0 y la carta se
     * dibuja exactamente como antes.
     *
     * Se reconstruye la tabla porque SQLite no permite modificar un CHECK con
     * ALTER TABLE, igual que en la migración de `character`. La vista se suelta
     * primero: la recrea `VIEWS_SQL` al terminar de aplicar las migraciones.
     */
    id: '2026-09-asset-background-kind',
    sql: `DROP VIEW IF EXISTS v_vtuber_card;
          CREATE TABLE asset_new (
            id         INTEGER PRIMARY KEY,
            vtuber_id  INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
            kind       TEXT NOT NULL CHECK (kind IN ('card', 'thumb', 'logo', 'avatar', 'radar', 'character', 'background')),
            path       TEXT NOT NULL,
            source_url TEXT,
            width      INTEGER,
            height     INTEGER,
            bytes      INTEGER,
            UNIQUE (vtuber_id, kind)
          );
          INSERT INTO asset_new (id, vtuber_id, kind, path, source_url, width, height, bytes)
            SELECT id, vtuber_id, kind, path, source_url, width, height, bytes FROM asset;
          DROP TABLE asset;
          ALTER TABLE asset_new RENAME TO asset;
          CREATE INDEX IF NOT EXISTS idx_asset_vtuber ON asset (vtuber_id);`,
  },
  {
    /**
     * Limpia las facciones: el scrape trajo variantes con errata (`Netherbane2`, `Mythical Lecagy`…)
     * que se sembraron como facciones distintas (26 en vez de 22) y fichas con 3-4 facciones
     * cuando la carta solo tiene dos emblemas. Se fusionan las variantes y se conservan las dos
     * primeras de cada ficha; el resto se reasigna a mano desde el mantenedor.
     */
    id: '2026-10-facciones-canonicas',
    run: (db) => consolidarFacciones(db),
  },
];

/**
 * Vistas de apoyo. Se (re)crean en CADA apertura y SIEMPRE después de las
 * migraciones: una migración que reconstruya una tabla referenciada por una
 * vista tiene que poder soltarla primero, y así queda recreada al terminar en
 * vez de quedar caída hasta el siguiente arranque.
 */
const VIEWS_SQL = `
DROP VIEW IF EXISTS v_vtuber_card;
CREATE VIEW v_vtuber_card AS
SELECT
  v.id,
  v.dex_number      AS dexNumber,
  v.slug,
  v.name,
  v.phrase,
  v.theme_color     AS themeColor,
  v.power_score     AS powerScore,
  v.has_detail      AS hasDetail,
  v.status,
  (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'card')  AS cardImage,
  (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'thumb') AS thumbImage,
  (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'logo')  AS logoImage,
  (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'radar') AS radarImage,
  (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'character') AS characterImage,
  (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'background') AS backgroundImage,
  (SELECT group_concat(c.name, ', ') FROM vtuber_country vc
     JOIN country c ON c.id = vc.country_id WHERE vc.vtuber_id = v.id) AS countryNames,
  (SELECT c.name FROM vtuber_country vc JOIN country c ON c.id = vc.country_id
     WHERE vc.vtuber_id = v.id ORDER BY vc.position LIMIT 1) AS primaryCountry,
  (SELECT c.slug FROM vtuber_country vc JOIN country c ON c.id = vc.country_id
     WHERE vc.vtuber_id = v.id ORDER BY vc.position LIMIT 1) AS primaryCountrySlug,
  (SELECT c.flag FROM vtuber_country vc JOIN country c ON c.id = vc.country_id
     WHERE vc.vtuber_id = v.id ORDER BY vc.position LIMIT 1) AS primaryCountryFlag,
  (SELECT group_concat(t.label, ', ') FROM vtuber_tag vt JOIN tag t ON t.id = vt.tag_id
     WHERE vt.vtuber_id = v.id AND t.kind = 'group') AS groupNames,
  (SELECT group_concat(t.label, ', ') FROM vtuber_tag vt JOIN tag t ON t.id = vt.tag_id
     WHERE vt.vtuber_id = v.id AND t.kind = 'artist') AS artistNames
FROM vtuber v;
`;

function applyMigrations(db) {
  for (const migration of MIGRATIONS) {
    const key = `migration:${migration.id}`;
    const already = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    if (already) continue;
    try {
      if (migration.run) migration.run(db);
      else db.exec(migration.sql);
    } catch (error) {
      // Columna ya presente (base creada con el esquema nuevo): no es un fallo.
      if (!/duplicate column name/i.test(String(error))) throw error;
    }
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
      .run(key, new Date().toISOString());
  }
}

/** Abre (creando si hace falta) la base y aplica el esquema. */
export function openDatabase(dbPath = DEFAULT_DB_PATH, { readonly = false } = {}) {
  if (!readonly) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath, { readOnly: readonly });
  db.exec('PRAGMA foreign_keys = ON;');
  if (!readonly) {
    db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    applyMigrations(db);
    db.exec(VIEWS_SQL);
  }
  return db;
}

/** Ejecuta una función dentro de una transacción. */
export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

/** Lee un valor de `meta`. */
export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
  return row?.value ?? null;
}

/** Escribe un valor de `meta`. */
export function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, String(value));
}
