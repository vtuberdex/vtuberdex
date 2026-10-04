/**
 * `POST /api/modificaciones` — el formulario PÚBLICO para pedir cambios en una ficha ya registrada.
 *
 * No toca el catálogo: deja una solicitud `pendiente` que el mantenedor revisa y, si la aprueba,
 * aplica a la ficha. Las reglas están en `server/src/solicitudes.mjs`.
 */
import { recibirSolicitud } from '../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return recibirSolicitud(request, 'modificacion');
}
