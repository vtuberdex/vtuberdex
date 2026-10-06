/**
 * `POST /api/modificaciones` — el formulario PÚBLICO para pedir cambios en una ficha ya registrada.
 *
 * Exige el `permiso` que sale de verificar el correo (`/codigo` y `/verificar`). No toca el catálogo: deja una
 * solicitud `pendiente` (el correo ya está verificado) que el mantenedor revisa y, si la aprueba,
 * aplica a la ficha. Las reglas están en `server/src/solicitudes.mjs`.
 */
import { recibirSolicitud } from '../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return recibirSolicitud(request, 'modificacion');
}
