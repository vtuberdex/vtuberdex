/**
 * `POST /api/inscripciones/verificar` — paso 2 de la inscripción: canjea el código por una sesión y
 * devuelve el borrador que esa persona dejó a medias (si lo hay). Las reglas están en `lib/solicitudes.mjs`.
 */
import { verificarCodigo } from '../../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return verificarCodigo(request, 'inscripcion');
}
