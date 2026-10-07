/** `POST /api/mi-ficha/puntos` — gasta un punto de habilidad (o los devuelve todos para repartirlos otra vez). */
import { repartirPuntos } from '../../../../lib/mi-ficha.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return repartirPuntos(request);
}
