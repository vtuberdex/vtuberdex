/** `POST /api/mi-ficha/enlace` — manda el enlace mágico al correo con que se inscribió la ficha. */
import { pedirEnlaceDeMiFicha } from '../../../../lib/mi-ficha.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return pedirEnlaceDeMiFicha(request);
}
