// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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
  // `rol` solo decide qué muestra el panel (Experiencia, vetar, configuración…): cada ruta
  // vuelve a comprobarlo por su cuenta. Sin él, el panel trataba a todos como no admin.
  return conMantenedor(request, async (acceso) =>
    respuestaJson({ ...(await listarMinecraft()), rol: acceso.sesion.role }),
  );
}
