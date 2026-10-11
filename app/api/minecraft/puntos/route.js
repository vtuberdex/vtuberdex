/** `POST /api/minecraft/puntos` — gasta puntos de stats de la ficha vinculada (solo con `X-Minecraft-Token`). */
import { repartirDesdeElJuego } from '../../../../lib/minecraft.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return repartirDesdeElJuego(request);
}
