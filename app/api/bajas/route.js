/**
 * `POST /api/bajas` — el formulario PÚBLICO de baja. Exige los mismos términos que la
 * inscripción. Deja una solicitud `pendiente`; nada del catálogo cambia hasta que el mantenedor
 * la procesa.
 */
import { recibirSolicitud } from '../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return recibirSolicitud(request, 'baja');
}
