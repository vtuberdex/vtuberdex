// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `GET /api/minecraft/reglas` — curva de experiencia, topes de XP de juego, stats que suben y catálogo de estados
 * para el plugin de Minecraft. Público: son las mismas reglas que explica `/niveles`.
 * El catálogo de misiones sale de las VIGENTES (con los ajustes del panel); si la base no responde se cae al de código,
 * para que el plugin no se quede sin reglas. El caché es corto: un ajuste del panel debe llegar en un minuto.
 */
import { reglas } from "../../../../lib/minecraft.mjs";
import { ejecutorDeSolicitudes } from "../../../../lib/solicitudes.mjs";
import { misionesVigentes } from "../../../../server/src/misiones.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const vigentes = await misionesVigentes(await ejecutorDeSolicitudes()).catch(
    () => undefined,
  );
  return Response.json(reglas(vigentes), {
    headers: { "cache-control": "public, max-age=60" },
  });
}
