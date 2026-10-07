/**
 * `PUT /api/inscripciones/borrador` — guarda lo que la persona lleva escrito, atado a su correo verificado,
 * para que pueda volver a continuar. Las reglas están en `lib/solicitudes.mjs` y `server/src/borradores.mjs`.
 */
import { guardarBorradorDeInscripcion } from '../../../../lib/solicitudes.mjs';

export const dynamic = 'force-dynamic';

export function PUT(request) {
  return guardarBorradorDeInscripcion(request);
}
