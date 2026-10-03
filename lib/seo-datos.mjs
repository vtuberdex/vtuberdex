/**
 * Lecturas de catálogo que necesita el SEO (metadatos, sitemap), del lado del servidor.
 *
 * Usan la MISMA base que la API pública (`dbConDiario`: empaquetada + diario del mantenedor),
 * así que una ficha renombrada, despublicada o creada se refleja en el sitemap y en los
 * metadatos igual que en la web. `cache` de React comparte la lectura entre `generateMetadata`
 * y la página dentro de una misma petición: sin él cada ficha se leería dos veces.
 */
import { cache } from 'react';

import { dbConDiario } from './diario.mjs';
import { aplicarImagenesDelMantenedor, reemplazosDelMantenedor } from './ediciones.mjs';
import { KINDS_GESTIONABLES } from './carpetas.mjs';
import { getVtuberBySlug } from '../server/src/search.mjs';

/** Mismo TTL que la ficha de la API: una ráfaga de visitas comparte la pregunta al diario. */
const TTL_DIARIO_MS = 2000;

/**
 * Ficha pública por slug, con las imágenes del mantenedor encima, o `null` si no existe o no
 * está publicada (un borrador es un 404, igual que en la API).
 */
export const fichaPublica = cache(async (slug) => {
  const db = await dbConDiario({ ttlMs: TTL_DIARIO_MS });
  const card = getVtuberBySlug(db, slug);
  if (!card) return null;
  try {
    return aplicarImagenesDelMantenedor(card, await reemplazosDelMantenedor(card.slug, KINDS_GESTIONABLES));
  } catch (error) {
    // Las imágenes remotas son un extra: sin ellas el catálogo empaquetado sigue sirviendo.
    console.error(`[seo] la ficha ${slug} sale sin imágenes del mantenedor: ${error.message}`);
    return card;
  }
});

/** Fichas publicadas en orden de dex: lo mínimo para el sitemap y la lista del índice. */
export async function fichasPublicadas({ limit } = {}) {
  const db = await dbConDiario({ ttlMs: TTL_DIARIO_MS });
  const sql = `SELECT slug, name FROM vtuber WHERE status = 'published' ORDER BY dex_number ASC${limit ? ' LIMIT ?' : ''}`;
  const filas = limit ? db.prepare(sql).all(limit) : db.prepare(sql).all();
  return filas.map((f) => ({ slug: f.slug, name: f.name }));
}
