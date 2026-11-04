/**
 * `/api/minecraft-admin/estado` — jars y configuraciones presentes en el servidor.
 * Exige el rol `mantenedor` en la propia ruta: la página escondida no protege nada.
 */
import {
  accesoDeMantenedor,
  listarMinecraft,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const acceso = accesoDeMantenedor(request);
  if (acceso.rechazo) return acceso.rechazo;
  return respuestaJson(await listarMinecraft());
}
