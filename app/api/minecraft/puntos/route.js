// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/** `POST /api/minecraft/puntos` — gasta puntos de stats de la ficha vinculada (solo con `X-Minecraft-Token`). */
import { repartirDesdeElJuego } from "../../../../lib/minecraft.mjs";

export const dynamic = "force-dynamic";

export function POST(request) {
  return repartirDesdeElJuego(request);
}
