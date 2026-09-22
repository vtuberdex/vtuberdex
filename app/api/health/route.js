/**
 * `GET /api/health` — estado del catálogo.
 *
 * Mismo contrato que el servidor Express (`server/src/routes.mjs`) para no
 * romper nada de lo que ya consume el front.
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
