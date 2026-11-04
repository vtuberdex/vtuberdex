/**
 * `/api/minecraft-admin/estado` — jars y configuraciones presentes en el servidor.
 * Exige el rol `mantenedor` en la propia ruta: la página escondida no protege nada.
 */
import {
  conMantenedor,
  listarMinecraft,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async () =>
    respuestaJson(await listarMinecraft()),
  );
}
