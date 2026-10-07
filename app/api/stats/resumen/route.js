/**
 * `GET /api/stats/resumen` — agregados de visitantes para el panel de estado del servidor.
 *
 * NO es público: lo consulta nginx (el panel de la IP) enviando `X-Estado-Token`, que debe coincidir con
 * `VTUBERDEX_STATS_TOKEN`. Desde vtuberdex.com responde 404, igual que una ruta que no existe. Sin el
 * token configurado nunca responde (no hay "modo abierto" por olvido).
 */
import crypto from 'node:crypto';

import { historial } from '../../../../lib/clientes-historial.mjs';
import { nombresDeFichas } from '../../../../lib/ficha-id.mjs';
import { resumen } from '../../../../lib/clientes-stats.mjs';

export const dynamic = 'force-dynamic';

function tokenValido(recibido) {
  const esperado = process.env.VTUBERDEX_STATS_TOKEN;
  if (!esperado || esperado.length < 16 || typeof recibido !== 'string') return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function GET(request) {
  if (!tokenValido(request.headers.get('x-estado-token'))) {
    return Response.json({ error: 'no_encontrado' }, { status: 404 });
  }
  // Lo de AHORA (en memoria) más el histórico mensual (contadores en la base; ver `lib/clientes-historial.mjs`).
  const ahora = resumen();
  const meses = await historial();
  // Los contadores guardan IDs de ficha; los nombres se ponen aquí, al servir. Una ficha que después se retiró (baja) o
  // dejó de ser pública sale como «Ficha retirada»: este panel es accesible por la IP y su nombre es secreto.
  const nombres = await nombresDeFichas([...ahora.fichas_ahora.map((f) => f.id), ...meses.flatMap((m) => m.fichas.map((f) => f.id))]);
  const conNombre = (f) => ({ n: f.n, nombre: nombres.get(f.id)?.nombre ?? 'Ficha retirada', dex: nombres.get(f.id)?.dex ?? null });
  return Response.json(
    {
      ...ahora,
      fichas_ahora: ahora.fichas_ahora.map(conNombre),
      historial: meses.map((m) => ({ ...m, fichas: m.fichas.map(conNombre) })),
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
