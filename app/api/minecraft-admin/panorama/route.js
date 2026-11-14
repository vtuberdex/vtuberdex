// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/panorama` — jugadores, TPS, tiempo de tick y carga de la máquina.
 * Solo lectura y con el rol de mantenedor comprobado aquí, no solo en la página.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import { obtenerPanorama } from "../../../../lib/minecraft-panorama.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async () =>
    respuestaJson(await obtenerPanorama()),
  );
}
