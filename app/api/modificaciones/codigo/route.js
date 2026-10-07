/**
 * `POST /api/modificaciones/codigo` — paso 1 de «actualizar ficha»: manda un código al correo escrito.
 * No guarda ninguna solicitud. Las reglas están en `lib/solicitudes.mjs`.
 */
import { pedirCodigo } from '../../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return pedirCodigo(request, 'modificacion');
}
