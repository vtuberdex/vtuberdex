/** `POST /api/mi-ficha` — el estado de la ficha de quien llega con su enlace mágico. Reglas en `lib/mi-ficha.mjs`. */
import { estadoDeMiFicha } from '../../../lib/mi-ficha.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return estadoDeMiFicha(request);
}
