// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/** `POST /api/minecraft/vincular` — el plugin canjea el código de «Mi ficha» (solo con `X-Minecraft-Token`). */
import { vincularDesdeElJuego } from "../../../../lib/minecraft.mjs";

export const dynamic = "force-dynamic";

export function POST(request) {
  return vincularDesdeElJuego(request);
}
