/**
 * Servidor VTuberDex: API JSON + estáticos de imágenes y (opcional) build web.
 */
import path from 'node:path';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import express from 'express';

import { openDatabase } from './db/index.mjs';
import { createSessionStore } from './auth.mjs';
import { createApiRouter } from './routes.mjs';
import { ejecutorSqlite } from './solicitudes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export function createApp({ dbPath, imageRoot = path.join(ROOT, 'data', 'images'), webRoot = path.join(ROOT, 'web', 'dist') } = {}) {
  const db = openDatabase(dbPath);
  const sessions = createSessionStore();
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  // CORS explícito para el dev-server de Vite (5173) y previews.
  app.use((req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use('/images', express.static(imageRoot, { maxAge: '7d', immutable: false }));
  // La cola de solicitudes vive junto a la base (`data/solicitudes.db`): es el MISMO archivo en
  // el que escriben los formularios públicos desde Next. Sin `dbPath` (tests) va en memoria.
  const solicitudes = ejecutorSqlite(new DatabaseSync(dbPath ? path.join(path.dirname(path.resolve(dbPath)), 'solicitudes.db') : ':memory:'));
  app.use('/api', createApiRouter({ db, sessions, imageRoot, solicitudes }));

  if (fs.existsSync(webRoot)) {
    app.use(express.static(webRoot, { maxAge: '1h' }));
    app.get(/^(?!\/api|\/images).*/, (req, res) => {
      res.sendFile(path.join(webRoot, 'index.html'));
    });
  }

  /**
   * Manejador de errores de Express: la firma de CUATRO argumentos es
   * obligatoria para que Express lo reconozca como tal (`next` no se usa, pero
   * quitarlo lo convertiría en un middleware normal). Se marca con `_` en vez de
   * una directiva de eslint para no depender de la posición del comentario.
   */
  app.use((error, req, res, _next) => {
    console.error('[api] error no controlado', error);
    res.status(500).json({ error: 'error_interno', detail: error.message });
  });

  return { app, db, sessions };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT ?? 4000);
  const host = process.env.HOST ?? '0.0.0.0';
  const { app } = createApp({ dbPath: process.env.VTUBERDEX_DB });
  const server = app.listen(port, host, () => {
    console.log(`[vtuberdex] API escuchando en http://${host}:${port}`);
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
