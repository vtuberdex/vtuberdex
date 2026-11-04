/**
 * `/api/minecraft-admin/enlace` — pide el enlace mágico del mantenedor.
 *
 * No dice si el correo tiene permiso: responde lo mismo exista o no, para que la ruta no sirva
 * de listín de quién mantiene el servidor. El enlace va en el fragmento de la URL y caduca.
 */
import {
  enviarEnlaceMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const cuerpo = await request.json().catch(() => null);
  const resultado = await enviarEnlaceMantenedor({ email: cuerpo?.email });
  if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
  return respuestaJson({ ok: true });
}
