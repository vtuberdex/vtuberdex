/** `POST /api/minecraft/email` — `/vtd email <correo>` en el juego: manda los códigos de vínculo a ese correo (solo el plugin). */
import { pedirCodigoPorCorreo } from '../../../../lib/minecraft.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return pedirCodigoPorCorreo(request);
}
