/**
 * `GET /api/meta` — facetas y contadores para el panel de filtros.
 *
 * Se calculan en SQLite (nunca recorriendo filas en JS) y se devuelven junto a la
 * fecha del dataset, igual que en el servidor Express.
 */
import { getDb } from '../../../lib/db.mjs';
import { facetCounts } from '../../../server/src/search.mjs';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const db = getDb();
  const searchParams = new URL(request.url).searchParams;
  const language = searchParams.get('language') ?? null;
  const q = searchParams.get('q') ?? '';
  const generatedAt =
    db.prepare(`SELECT value FROM meta WHERE key = 'dataset_generated_at'`).get()?.value ?? null;
  return Response.json({ ...facetCounts(db, { language, q }), generatedAt });
}
