/**
 * Construye la app Express de VTuberDex.
 *
 * Está separada de `server.mjs` a propósito: el servidor de producción
 * (`server.mjs`) y la verificación del deploy (`scripts/verify-vercel-bundle.mjs`)
 * necesitan la MISMA app, y si cada uno armara la suya la verificación podría
 * pasar sobre una configuración que no es la que se despliega.
 */
import fs from 'node:fs';
import path from 'node:path';

import express from 'express';

import { openDatabase } from './server/src/db/index.mjs';
import { createApiRouter } from './server/src/routes.mjs';
import { createSessionStore } from './server/src/auth.mjs';

/** `ruta -> URL pública` de cada imagen; vacío si el build no generó el archivo. */
function loadManifest(manifestPath) {
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')).images ?? {};
  } catch {
    return {};
  }
}

export function createApp({ dbPath, manifestPath, publicRoot, dataRoot }) {
  const db = openDatabase(dbPath, { readonly: true });
  const sessions = createSessionStore();
  const manifest = loadManifest(manifestPath);
  const app = express();

  app.use(express.json({ limit: '1mb' }));

  /**
   * IMÁGENES: se redirige a Vercel Blob.
   *
   * En el deploy no hay imágenes en disco (no viajan en la función), así que
   * cada ruta se busca en el manifiesto generado por el build. Una ruta
   * desconocida da 404 explícito y no un redirect a ninguna parte: un 302 ciego
   * convertiría cada imagen que falta en un error confuso de Blob.
   *
   * El 301 es seguro aquí porque la ruta pública es estable: si cambia el
   * contenido, el scraper reescribe el MISMO archivo canónico por slug.
   */
  app.get(/^\/images\/(.*)$/, (req, res) => {
    const key = `images/${req.params[0]}`;
    const rel = manifest[key];
    if (!rel) {
      res.status(404).json({ error: 'imagen_no_publicada', path: key });
      return;
    }
    /**
     * La URL se compone en tiempo de ejecución, no se lee del manifiesto: el
     * manifiesto guarda la ruta canónica del blob y la base de Blob viene del
     * entorno (`VTUBERDEX_BLOB_BASE`, que Vercel inyecta al conectar el store).
     * Así un store nuevo no obliga a reconstruir el manifiesto.
     */
    const base = process.env.VTUBERDEX_BLOB_BASE ?? manifest.blobBase;
    if (!base) {
      res.status(503).json({ error: 'blob_no_configurado', path: key });
      return;
    }
    // Cache larga en el borde: el nombre del asset es canónico, no versionado.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    res.redirect(301, `${String(base).replace(/\/$/, '')}/${rel}`);
  });

  app.use('/api', createApiRouter({ db, sessions, imageRoot: path.join(dataRoot, 'images') }));

  /**
   * Fallback del SPA.
   *
   * En Vercel el HTML y los assets del front los sirve el CDN desde `public/**`,
   * así que este bloque solo actúa en el deploy si algo no quedó como estático
   * —y siempre en local, donde `express.static` sí funciona—. Se registra
   * DESPUÉS de `/api` y `/images` y antes del manejador de errores.
   *
   * Se usa `readFileSync` + `res.send` en vez de `res.sendFile`: sobre un
   * sistema de archivos de SOLO LECTURA —el de Vercel— `sendFile` falla con un
   * `NotFoundError` que Express convierte en 500. Verificado: con `sendFile`, la
   * ruta profunda `/v/:slug` devolvía 500 mientras `/` respondía, porque `/` lo
   * resolvía el middleware estático y solo las profundas llegaban aquí.
   *
   * El HTML se lee UNA vez al construir la app: es idéntico en cada petición y
   * la app se reutiliza entre invocaciones (Fluid compute).
   */
  if (publicRoot && fs.existsSync(path.join(publicRoot, 'index.html'))) {
    app.use(express.static(publicRoot));
    const indexHtml = fs.readFileSync(path.join(publicRoot, 'index.html'));
    app.get(/^(?!\/api|\/images).*/, (req, res) => {
      res.type('html').send(indexHtml);
    });
  }

  // eslint-disable-next-line no-unused-vars -- Express exige 4 argumentos
  app.use((error, req, res, next) => {
    console.error('[api] error no controlado', error);
    res.status(500).json({ error: 'error_interno', detail: error.message });
  });

  return app;
}
