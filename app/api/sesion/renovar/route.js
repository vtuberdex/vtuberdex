/**
 * `POST /api/sesion/renovar` — alarga la sesión de visitante SIN repetir la prueba de trabajo.
 *
 * La cookie dura pocos minutos; el navegador la renueva sola mientras la pestaña está visible. Exige
 * la cookie vigente (atada a red y User-Agent) y un tope total de `VIDA_MAXIMA_S` desde el reto.
 * Caducada o pasada de tope → 401 `sesion_requerida` y el cliente vuelve a resolver el reto.
 */
import { redDeLaPeticion, redExenta } from "../../../../lib/anti-scraping.mjs";
import {
  COOKIE,
  VIDA_SESION_S,
  renovarSesion,
} from "../../../../lib/sesion-visitante.mjs";

export const dynamic = "force-dynamic";

export function POST(request) {
  const sinCache = { "cache-control": "no-store" };
  const ip = redDeLaPeticion(request.headers);
  if (!ip || redExenta(ip))
    return new Response(null, { status: 204, headers: sinCache });
  const valor = renovarSesion(
    request.headers.get("cookie"),
    ip,
    request.headers.get("user-agent") ?? "",
  );
  if (!valor)
    return Response.json(
      { error: "sesion_requerida" },
      { status: 401, headers: sinCache },
    );
  const seguro = request.headers.get("x-forwarded-proto") === "https";
  return new Response(null, {
    status: 204,
    headers: {
      ...sinCache,
      "set-cookie": `${COOKIE}=${valor}; Path=/; Max-Age=${VIDA_SESION_S}; HttpOnly; SameSite=Lax${seguro ? "; Secure" : ""}`,
    },
  });
}
