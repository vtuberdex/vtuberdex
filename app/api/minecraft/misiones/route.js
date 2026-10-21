/** `POST /api/minecraft/misiones` — avances de misiones reportados por el plugin (solo con `X-Minecraft-Token`). */
import { registrarMisiones } from "../../../../lib/minecraft.mjs";

export const dynamic = "force-dynamic";

export function POST(request) {
  return registrarMisiones(request);
}
