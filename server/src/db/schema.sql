-- ============================================================================
-- VTuberDex — esquema relacional normalizado (SQLite)
--
-- Reemplaza la "pokédex" plana del origen (un div por carta con atributos
-- sueltos) por un modelo en el que la búsqueda, las facetas y el mantenedor
-- trabajan sobre índices en vez de recorrer el DOM.
--
-- Reglas:
--  · `dex_number` es el identificador estable de la carta (fuente: fichas/vtuberN.jpg).
--  · `slug` es la clave pública en URLs (/v/:slug).
--  · Los atributos multivaluados (países, idiomas, grupos, artistas, facciones)
--    viven en tablas puente, no en columnas con comas.
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- --- metadatos --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- --- países -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS country (
  id     INTEGER PRIMARY KEY,
  slug   TEXT NOT NULL UNIQUE,
  name   TEXT NOT NULL,
  name_en TEXT,
  flag   TEXT,
  lang   TEXT,
  vtuber_count INTEGER NOT NULL DEFAULT 0
);

-- --- idiomas ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS language (
  code TEXT PRIMARY KEY,
  name TEXT
);

-- --- etiquetas libres (grupos y artistas) -----------------------------------
CREATE TABLE IF NOT EXISTS tag (
  id    INTEGER PRIMARY KEY,
  kind  TEXT NOT NULL CHECK (kind IN ('group', 'artist')),
  slug  TEXT NOT NULL,
  label TEXT NOT NULL,
  vtuber_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, slug)
);

-- --- facciones --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS faction (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  icon  TEXT,
  vtuber_count INTEGER NOT NULL DEFAULT 0
);

-- --- carta principal --------------------------------------------------------
CREATE TABLE IF NOT EXISTS vtuber (
  id               INTEGER PRIMARY KEY,
  dex_number       INTEGER NOT NULL UNIQUE,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  search_name      TEXT NOT NULL,
  alt              TEXT,
  phrase           TEXT,
  phrase_html      TEXT,
  -- Texto personalizado que viene IMPRESO en la imagen de la carta (OCR). Es un
  -- campo distinto de `phrase`: la frase del HTML es corta y esto suele ser una
  -- historia larga que solo existe en el arte. Se marca su origen y confianza.
  card_text        TEXT,
  card_text_confidence INTEGER,
  theme_color      TEXT,
  secondary_color  TEXT,
  palette          TEXT,          -- JSON: paleta extraída de la imagen
  birthday         TEXT,
  height           TEXT,
  hashtag          TEXT,
  favorite_color   TEXT,
  level            INTEGER,
  exp_current      INTEGER,
  exp_max          INTEGER,
  hp_current       INTEGER,
  hp_max           INTEGER,
  mp_current       INTEGER,
  mp_max           INTEGER,
  power_score      INTEGER,       -- suma ponderada de stats (orden "poder")
  has_detail       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'draft', 'hidden')),
  source_index_image TEXT,
  source_detail_url  TEXT,
  data_quality     TEXT,          -- JSON: campos faltantes detectados
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_vtuber_dex   ON vtuber (dex_number);
CREATE INDEX IF NOT EXISTS idx_vtuber_slug  ON vtuber (slug);
CREATE INDEX IF NOT EXISTS idx_vtuber_score ON vtuber (power_score DESC);
CREATE INDEX IF NOT EXISTS idx_vtuber_theme ON vtuber (theme_color);

-- --- puentes ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vtuber_country (
  vtuber_id  INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  country_id INTEGER NOT NULL REFERENCES country (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vtuber_id, country_id)
);

CREATE TABLE IF NOT EXISTS vtuber_language (
  vtuber_id INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  code      TEXT NOT NULL,
  PRIMARY KEY (vtuber_id, code)
);

CREATE TABLE IF NOT EXISTS vtuber_tag (
  vtuber_id INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  tag_id    INTEGER NOT NULL REFERENCES tag (id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vtuber_id, tag_id)
);

CREATE TABLE IF NOT EXISTS vtuber_faction (
  vtuber_id  INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  faction_id INTEGER NOT NULL REFERENCES faction (id) ON DELETE CASCADE,
  position   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (vtuber_id, faction_id)
);

-- Alias de URL: el slug anterior de una ficha cuyo slug se cambió (ver mutations.mjs).
CREATE TABLE IF NOT EXISTS slug_alias (
  slug      TEXT PRIMARY KEY,
  vtuber_id INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE
);

-- --- datos de la ficha de detalle -------------------------------------------
CREATE TABLE IF NOT EXISTS profile_field (
  id        INTEGER PRIMARY KEY,
  vtuber_id INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  value     TEXT NOT NULL,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_profile_vtuber ON profile_field (vtuber_id, position);

CREATE TABLE IF NOT EXISTS stat (
  id        INTEGER PRIMARY KEY,
  vtuber_id INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  label     TEXT NOT NULL,
  slug      TEXT NOT NULL,
  value     INTEGER,
  value_text TEXT,
  max       INTEGER,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_stat_vtuber ON stat (vtuber_id, position);

CREATE TABLE IF NOT EXISTS skill (
  id          INTEGER PRIMARY KEY,
  vtuber_id   INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('active', 'passive', 'ultimate', 'other')),
  section     TEXT,
  type        TEXT,
  name        TEXT,
  effect      TEXT,
  effect_html TEXT,
  factions    TEXT,   -- JSON: iconos de facción de la habilidad
  position    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_skill_vtuber ON skill (vtuber_id, category, position);

CREATE TABLE IF NOT EXISTS social (
  id        INTEGER PRIMARY KEY,
  vtuber_id INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  platform  TEXT NOT NULL,
  label     TEXT,
  url       TEXT NOT NULL,
  icon      TEXT,
  position  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_social_vtuber ON social (vtuber_id, position);

CREATE TABLE IF NOT EXISTS asset (
  id         INTEGER PRIMARY KEY,
  vtuber_id  INTEGER NOT NULL REFERENCES vtuber (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('card', 'thumb', 'logo', 'character', 'radar', 'background')),
  path       TEXT NOT NULL,
  source_url TEXT,
  width      INTEGER,
  height     INTEGER,
  bytes      INTEGER,
  UNIQUE (vtuber_id, kind)
);

-- --- búsqueda full-text (FTS5 + triggers de sincronización) ------------------
-- Tabla FTS normal (guarda su propia copia del texto) para poder hacer DELETE
-- por fila al re-importar; `content=''` sería "contentless" y lo prohíbe.
CREATE VIRTUAL TABLE IF NOT EXISTS vtuber_fts USING fts5 (
  name,
  phrase,
  tags,
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS vtuber_fts_ai AFTER INSERT ON vtuber BEGIN
  INSERT INTO vtuber_fts (rowid, name, phrase, tags)
  VALUES (new.id, new.name, COALESCE(new.phrase, ''), '');
END;

CREATE TRIGGER IF NOT EXISTS vtuber_fts_ad AFTER DELETE ON vtuber BEGIN
  DELETE FROM vtuber_fts WHERE rowid = old.id;
END;

CREATE TRIGGER IF NOT EXISTS vtuber_fts_au AFTER UPDATE OF name, phrase ON vtuber BEGIN
  DELETE FROM vtuber_fts WHERE rowid = old.id;
  INSERT INTO vtuber_fts (rowid, name, phrase, tags)
  VALUES (new.id, new.name, COALESCE(new.phrase, ''), '');
END;

-- --- mantenedor -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_user (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'editor',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY,
  actor      TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  INTEGER,
  action     TEXT NOT NULL,
  payload    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);

-- --- vistas de apoyo --------------------------------------------------------
-- La vista se define en db/index.mjs (VIEWS_SQL) y se aplica DESPUÉS de las
-- migraciones: SQLite no deja modificar un CHECK con ALTER TABLE, así que una
-- migración que reconstruya `asset` debe poder soltar la vista primero, y
-- recrearla al final. Si viviera aquí, un arranque la dejaría caída.
