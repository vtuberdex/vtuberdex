/**
 * `POST /api/inscripciones` — el formulario PÚBLICO de inscripción de una ficha.
 *
 * No crea nada en el catálogo: deja una solicitud `pendiente` que el mantenedor revisa y, si la
 * aprueba, convierte en una ficha en borrador. Las reglas están en `server/src/solicitudes.mjs`.
 */
import { recibirSolicitud } from '../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return recibirSolicitud(request, 'inscripcion');
}
