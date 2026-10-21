/** `GET /api/minecraft/misiones/:uuid` — las misiones de la ficha vinculada a un jugador (solo el plugin). */
import { misionesDelJugador } from "../../../../../lib/minecraft.mjs";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { uuid } = await params;
  return misionesDelJugador(request, uuid);
}
