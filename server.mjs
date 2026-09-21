/**
 * Servidor VTuberDex para Vercel.
 *
 * Vercel detecta este archivo (patrón documentado de "Node server": `server.mjs`
 * en la raíz con `app.listen()`) y enruta TODAS las peticiones hacia él. Se usa
 * este patrón en lugar de la carpeta `api/` porque no necesita `rewrites`: las
 * reglas de reescritura cambian la URL interna y el router tendría que
 * reconstruir la ruta original. Aquí Express recibe la URL tal como la pidió el
 * navegador, que es lo que `routes.mjs` espera.
 *
 * Dos cosas del entorno de Vercel que este archivo asume a propósito (verificado
 * contra la documentación y contra un escenario de solo lectura local):
 *
 *   · `express.static()` NO sirve archivos en Vercel — el estático lo reparte el
 *     CDN desde `public/**`, que es donde el build copia `web/dist`. Por eso el
 *     front se sirve igual (`static` se mantiene solo como respaldo en local) y
 *     el fallback del SPA lee el `index.html` de `public/`.
 *   · El sistema de archivos es de SOLO LECTURA. La base viaja empaquetada en la
 *     función vía `includeFiles` (ver `vercel.json`) y se abre con
 *     `readonly: true`; el catálogo se consulta —incluido FTS5— sin escribir.
 *
 * En Vercel el catálogo es de SOLO LECTURA por diseño: el mantenedor se levanta
 * en local (`scripts/dev-up.sh`) y sus cambios se publican regenerando los
 * artefactos (`npm run build` + `npm run publish:images`), no escribiendo en
 * producción.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createApp } from './app.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Busca un archivo del deploy probando las raíces donde puede quedar.
 *
 * El empaquetado de Vercel (Node File Trace) coloca los archivos incluidos
 * manteniendo su ruta relativa, pero la raíz desde la que se ejecuta la función
 * no es la misma en todos los casos: `process.cwd()` es lo que la documentación
 * recomienda y `HERE` (la carpeta del propio archivo) cubre el caso de que la
 * función se ejecute desde otra profundidad. Se prueban en orden y se devuelve
 * la primera que exista: así el mismo código funciona en Vercel y en local sin
 * variables de entorno.
 */
function resolveDeployFile(relative) {
  const candidates = [
    path.resolve(process.cwd(), relative),
    path.resolve(HERE, relative),
    path.resolve(HERE, '..', relative),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
}

const DB_PATH = resolveDeployFile(path.join('deploy', 'data', 'vtuberdex.db'));
const MANIFEST_PATH = resolveDeployFile(path.join('deploy', 'data', 'images.json'));
const PUBLIC_ROOT = resolveDeployFile('public');
const DATA_ROOT = path.dirname(DB_PATH);

const app = createApp({ dbPath: DB_PATH, manifestPath: MANIFEST_PATH, publicRoot: PUBLIC_ROOT, dataRoot: DATA_ROOT });

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[vtuberdex] escuchando en :${port} | base: ${DB_PATH} | estático: ${PUBLIC_ROOT}`);
});
