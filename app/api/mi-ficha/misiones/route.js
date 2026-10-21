/** `POST /api/mi-ficha/misiones` — reclama el grado de una misión de grado completada. Reglas en `lib/mi-ficha.mjs`. */
import { misionesDeMiFicha } from "../../../../lib/mi-ficha.mjs";

export const dynamic = "force-dynamic";

export function POST(request) {
  return misionesDeMiFicha(request);
}
