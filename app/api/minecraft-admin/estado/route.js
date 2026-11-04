/**
 * `/api/minecraft-admin/estado` — jars y configuraciones presentes en el servidor.
 * Exige el rol `mantenedor` en la propia ruta: la página escondida no protege nada.
 */
import {
  autorizar,
  listarMinecraft,
  sesionDeLaPeticion,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

const sinCache = { "cache-control": "no-store" };

export async function GET(request) {
  const permiso = autorizar(sesionDeLaPeticion(request));
  if (!permiso.ok) {
    return Response.json(permiso.cuerpo, { status: permiso.status, headers: sinCache });
  }
  return Response.json(await listarMinecraft(), { headers: sinCache });
}
