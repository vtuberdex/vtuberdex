/**
 * Tests de las MIGRACIONES del esquema.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * Una migración que reconstruye una tabla (necesario cuando hay que ampliar un
 * CHECK, porque SQLite no permite modificarlo) es el punto más delicado del
 * esquema: si el `INSERT ... SELECT` copia mal, si la vista no se suelta antes o si
 * el renombrado deja los índices colgando, la base se abre igual y el fallo no
 * aparece hasta que alguien busca una imagen. Los tests de búsqueda y de API
 * arrancan siempre de una base NUEVA, así que nunca ejercitan ese camino: aquí se
 * parte de una base REAL degradada al estado anterior, que es el de cualquier
 * instalación existente.
 *
 * POR QUÉ SE DEGRADA UNA BASE REAL Y NO SE CONSTRUYE UNA A MANO
 * ------------------------------------------------------------
 * El primer intento creaba a mano un `vtuber` mínimo y `openDatabase` falló con
 * "no such column: power_score": como el esquema real usa `CREATE TABLE IF NOT
 * EXISTS`, la tabla incompleta se quedaba tal cual y la vista de apoyo no podía
 * crearse. Construir el esquema a mano es frágil y se desincroniza en cuanto se
 * añade una columna; partir de la base de verdad y deshacer SOLO la migración que
 * se prueba sí ejercita el camino real de actualización.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

import { openDatabase } from '../src/db/index.mjs';

const MIGRATION_ID = 'migration:2026-09-asset-background-kind';

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-mig-')), 'test.db');

/**
 * Devuelve una base con el esquema actual EXCEPTO la migración de `background`:
 * `asset` con el CHECK antiguo, la vista dependiente y los datos de siempre.
 *
 * Deshacer la migración es exactamente lo contrario de aplicarla: soltar la vista,
 * reconstruir `asset` sin el tipo nuevo, borrar su marca en `meta`.
 */
function baseSinBackground(dbPath) {
  const db = openDatabase(dbPath);
  db.prepare('INSERT INTO vtuber (dex_number, slug, name, search_name) VALUES (18, ?, ?, ?)').run(
    'gkuro',
    'GKuro',
    'gkuro',
  );
  const vtuberId = db.prepare('SELECT id FROM vtuber WHERE slug = ?').get('gkuro').id;
  const insert = db.prepare('INSERT INTO asset (vtuber_id, kind, path, width, height, bytes) VALUES (?, ?, ?, ?, ?, ?)');
  insert.run(vtuberId, 'character', 'images/character/gkuro.webp', 720, 1008, 1234);
  insert.run(vtuberId, 'logo', 'images/logo/gkuro.webp', 900, 300, 5678);

  db.exec(`
    DROP VIEW IF EXISTS v_vtuber_card;
    CREATE TABLE asset_viejo (
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
    INSERT INTO asset_viejo (id, vtuber_id, kind, path, source_url, width, height, bytes)
      SELECT id, vtuber_id, kind, path, source_url, width, height, bytes FROM asset;
    DROP TABLE asset;
    ALTER TABLE asset_viejo RENAME TO asset;
    CREATE INDEX IF NOT EXISTS idx_asset_vtuber ON asset (vtuber_id);
    CREATE VIEW v_vtuber_card AS
      SELECT v.id, v.slug,
        (SELECT path FROM asset WHERE vtuber_id = v.id AND kind = 'character') AS characterImage
      FROM vtuber v;
  `);
  db.prepare('DELETE FROM meta WHERE key = ?').run(MIGRATION_ID);
  db.close();
}

/** El CHECK antiguo rechaza `background`: comprobación de que la base está degradada. */
function rechazaBackground(dbPath) {
  const db = new DatabaseSync(dbPath);
  assert.throws(
    () => db.prepare("INSERT INTO asset (vtuber_id, kind, path) VALUES (1, 'background', 'x.webp')").run(),
    /constraint/i,
  );
  db.close();
}

test('la migración de `background` amplía el CHECK sin perder las filas existentes', () => {
  const dbPath = tmpDb();
  baseSinBackground(dbPath);
  rechazaBackground(dbPath);

  // Abrir con el código actual aplica la migración pendiente.
  const db = openDatabase(dbPath);

  const filas = db.prepare('SELECT kind, path, bytes FROM asset ORDER BY kind').all();
  assert.equal(filas.length, 2, 'no se perdió ninguna fila de asset');
  assert.deepEqual(
    filas.map((row) => row.kind),
    ['character', 'logo'],
  );
  assert.equal(filas[0].path, 'images/character/gkuro.webp');
  assert.equal(filas[0].bytes, 1234);
  assert.equal(filas[1].bytes, 5678, 'los bytes del logo sobreviven al copiado');

  // El tipo nuevo YA se puede insertar: es el objetivo de la migración.
  const vtuberId = db.prepare('SELECT id FROM vtuber WHERE slug = ?').get('gkuro').id;
  db.prepare(
    "INSERT INTO asset (vtuber_id, kind, path, bytes) VALUES (?, 'background', 'images/background/gkuro.webp', 999)",
  ).run(vtuberId);
  assert.equal(
    db.prepare("SELECT path FROM asset WHERE kind = 'background'").get().path,
    'images/background/gkuro.webp',
  );

  // El CHECK sigue rechazando un tipo inventado: la ampliación no lo abrió de más.
  assert.throws(
    () => db.prepare("INSERT INTO asset (vtuber_id, kind, path) VALUES (?, 'inventado', 'x.webp')").run(vtuberId),
    /CHECK constraint failed|constraint/i,
  );

  db.close();
});

test('la vista dependiente se recrea tras la migración', () => {
  const dbPath = tmpDb();
  baseSinBackground(dbPath);
  const db = openDatabase(dbPath);

  // Si la migración la hubiera dejado caída, esto fallaría con "no such view".
  const row = db.prepare('SELECT slug, characterImage FROM v_vtuber_card').get();
  assert.equal(row.slug, 'gkuro');
  assert.equal(row.characterImage, 'images/character/gkuro.webp');

  db.close();
});

test('la migración es idempotente: reabrir la base no la vuelve a aplicar', () => {
  const dbPath = tmpDb();
  baseSinBackground(dbPath);

  openDatabase(dbPath).close();
  // Segunda apertura sobre la base ya migrada: no debe lanzar (un segundo renombrado
  // de tabla o un CREATE sobre una tabla existente sí lo haría).
  const db = openDatabase(dbPath);
  assert.ok(db.prepare('SELECT value FROM meta WHERE key = ?').get(MIGRATION_ID));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM asset').get().n, 2);
  db.close();
});

test('la vista de apoyo expone el fondo como columna propia', () => {
  const dbPath = tmpDb();
  const db = openDatabase(dbPath);
  const columnas = db.prepare('PRAGMA table_info(v_vtuber_card)').all().map((c) => c.name);
  assert.ok(columnas.includes('backgroundImage'), 'la vista declara backgroundImage');
  db.close();
});

test('la base de desarrollo declara el tipo `background` en su CHECK', () => {
  // Guardia contra el desajuste clásico: el esquema y el código evolucionan juntos.
  const dbPath = path.resolve(import.meta.dirname, '..', '..', 'data', 'vtuberdex.db');
  if (!fs.existsSync(dbPath)) return; // sin base local no hay nada que comprobar
  const db = openDatabase(dbPath, { readonly: true });
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'asset'").get().sql;
  assert.match(sql, /background/, 'el CHECK de asset incluye el tipo background');
  db.close();
});
