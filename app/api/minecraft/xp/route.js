/** `POST /api/minecraft/xp` — un lote de XP ganada jugando, para la ficha vinculada (solo con `X-Minecraft-Token`). */
import { recibirXp } from '../../../../lib/minecraft.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return recibirXp(request);
}
