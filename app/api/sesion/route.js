/**
 * `/api/sesion` (y `/renovar`) — sesión de visitante con prueba de trabajo (ver `lib/sesion-visitante.mjs`).
 *
 *  · GET  → `{ reto, bits }`: el reto que hay que resolver.
 *  · POST `{ reto, solucion }` → 204 y `Set-Cookie: vtd_s` si la prueba es correcta.
 */
import { redDeLaPeticion, redExenta } from "../../../lib/anti-scraping.mjs";
import {
  COOKIE,
  VIDA_SESION_S,
  crearReto,
  hashDeRed,
  sesionesAgotadas,
  solucionValida,
  valorDeSesion,
} from "../../../lib/sesion-visitante.mjs";

export const dynamic = "force-dynamic";

const SIN_CACHE = { "cache-control": "no-store" };

export function GET() {
  return Response.json(crearReto(), { headers: SIN_CACHE });
}

export async function POST(request) {
  const cuerpo = await request.json().catch(() => null);
  const ip = redDeLaPeticion(request.headers);
  if (!ip || redExenta(ip)) {
    // Sin red identificable (desarrollo local, loopback) la API no exige sesión: nada que emitir.
    return new Response(null, { status: 204, headers: SIN_CACHE });
  }
  if (sesionesAgotadas(hashDeRed(ip))) {
    return Response.json(
      { error: "demasiadas_sesiones" },
      { status: 429, headers: { ...SIN_CACHE, "retry-after": "600" } },
    );
  }
  if (!solucionValida(cuerpo?.reto, cuerpo?.solucion)) {
    return Response.json(
      { error: "prueba_invalida" },
      { status: 400, headers: SIN_CACHE },
    );
  }
  const ua = request.headers.get("user-agent") ?? "";
  const seguro = request.headers.get("x-forwarded-proto") === "https";
  const cookie = `${COOKIE}=${valorDeSesion(ip, ua)}; Path=/; Max-Age=${VIDA_SESION_S}; HttpOnly; SameSite=Lax${seguro ? "; Secure" : ""}`;
  return new Response(null, {
    status: 204,
    headers: { ...SIN_CACHE, "set-cookie": cookie },
  });
}
