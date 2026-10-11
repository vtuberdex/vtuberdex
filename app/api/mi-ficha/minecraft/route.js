/** `POST /api/mi-ficha/minecraft` — código para vincular la cuenta de Minecraft, o desvincularla. */
import { minecraftDeMiFicha } from '../../../../lib/mi-ficha.mjs';

export const dynamic = 'force-dynamic';

export function POST(request) {
  return minecraftDeMiFicha(request);
}
