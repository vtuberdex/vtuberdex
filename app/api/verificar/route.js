/**
 * `POST /api/verificar` — gasta el token que llegó al correo y confirma la solicitud.
 *
 * Es un POST (lo manda un botón de la página `/verificar`) y no un GET para que los clientes y
 * antivirus que abren los enlaces de los correos no lo consuman sin que la persona llegue.
 */
import { confirmarVerificacion } from '../../../lib/solicitudes.mjs';
import { origenPermitido } from '../../../lib/likes.mjs';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const cabeceras = { 'cache-control': 'no-store' };
  if (!origenPermitido(request.headers)) return Response.json({ error: 'origen_no_permitido' }, { status: 403, headers: cabeceras });
  const cuerpo = await request.json().catch(() => null);
  try {
    const { status, cuerpo: respuesta } = await confirmarVerificacion(typeof cuerpo?.token === 'string' ? cuerpo.token : '');
    return Response.json(respuesta, { status, headers: cabeceras });
  } catch (error) {
    console.error(`[solicitudes] no se pudo confirmar: ${error.message}`);
    return Response.json({ error: 'solicitudes_no_disponibles', detail: 'No se pudo confirmar. Inténtalo de nuevo en unos minutos.' }, { status: 503, headers: cabeceras });
  }
}
