/** `GET|DELETE /api/minecraft/jugador/:uuid` — a qué ficha está vinculado un jugador, o soltar el vínculo (solo el plugin). */
import {
  desvincularDesdeElJuego,
  jugador,
} from "../../../../../lib/minecraft.mjs";

export const dynamic = "force-dynamic";

export async function GET(request, { params }) {
  const { uuid } = await params;
  return jugador(request, uuid);
}

export async function DELETE(request, { params }) {
  const { uuid } = await params;
  return desvincularDesdeElJuego(request, uuid);
}
