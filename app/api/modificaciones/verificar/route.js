/**
 * `POST /api/modificaciones/verificar` — paso 2 de «actualizar ficha»: canjea el código por un permiso de
 * envío y devuelve las fichas inscritas con ese correo. Las reglas están en `lib/solicitudes.mjs`.
 */
import { verificarCodigo } from '../../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return verificarCodigo(request, 'modificacion');
}
