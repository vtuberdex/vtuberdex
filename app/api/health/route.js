/**
 * `GET /api/health` — estado del catálogo.
 *
 * Mismo contrato que el servidor Express (`server/src/routes.mjs`) para no
 * romper nada de lo que ya consume el front.
 *
 * NOTA: aquí vivía un `GET /api/meta` (facetas globales + fecha del dataset) que se retiró
 * porque **no lo consumía nadie**: el panel de filtros se llena con las `facets` que ya
 * viajan en la respuesta de `/api/vtubers` (`catalog-page.tsx` → `data?.facets`), y el
 * catálogo se pide con `facet=all`, así que esa consulta no ahorraba ni un viaje. Medido:
 * tardaba **313 ms** en producción (0,346 / 0,313 / 0,313 en tres rondas) para servir un
 * dato que nadie pedía.
 *
 * Si algún día hace falta la fecha del dataset en el cliente, sigue en
 * `meta.dataset_generated_at` de la base. El Express del mantenedor conserva el suyo
 * (`server/src/routes.mjs:167`, con sus tests): es otra superficie, no este endpoint.
 */
import { getDb } from '../../../lib/db.mjs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const db = getDb();
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS vtubers,
              SUM(CASE WHEN has_detail = 1 THEN 1 ELSE 0 END) AS withDetail
         FROM vtuber WHERE status = 'published'`,
    )
    .get();
  // `sessions` se mantiene en 0: en producción el catálogo es de solo lectura y
  // no hay sesiones de mantenedor que contar. El front no lo usa para decidir nada.
  return Response.json({ status: 'ok', ...counts, sessions: 0 });
}
