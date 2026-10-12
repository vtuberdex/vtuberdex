/**
 * `GET /api/minecraft/reglas` — curva de experiencia, topes de XP de juego, stats que suben y catálogo de estados
 * para el plugin de Minecraft. Público: son las mismas reglas que explica `/niveles`.
 */
import { reglas } from "../../../../lib/minecraft.mjs";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(reglas(), {
    headers: { "cache-control": "public, max-age=300" },
  });
}
