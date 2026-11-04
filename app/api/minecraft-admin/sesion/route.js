/**
 * `/api/minecraft-admin/sesion` — canjea el enlace mágico y abre (o cierra) la sesión.
 *
 * `POST { token }` consume el enlace de un solo uso y deja la cookie firmada con rol
 * `mantenedor`. `GET` dice quién está dentro. `DELETE` la borra.
 */
import {
  COOKIE_MANTENEDOR,
  SIN_CACHE,
  canjearEnlace,
  conMantenedor,
  cookieDeSesion,
  crearSesionMantenedor,
  respuestaJson,
  rolDe,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async (acceso) =>
    respuestaJson({ email: acceso.sesion.email, role: rolDe(acceso.sesion) }),
  );
}

export async function POST(request) {
  const cuerpo = await request.json().catch(() => null);
  const canje = canjearEnlace(cuerpo?.token);
  if (!canje.ok) return respuestaJson(canje.cuerpo, canje.status);
  const token = crearSesionMantenedor({ email: canje.sesion.email });
  if (!token) return respuestaJson({ error: "sesion_no_creada" }, 500);
  const seguro = request.headers.get("x-forwarded-proto") === "https";
  return Response.json(
    { ok: true, email: canje.sesion.email, role: canje.sesion.role },
    { headers: { ...SIN_CACHE, "set-cookie": cookieDeSesion(token, { seguro }) } },
  );
}

export function DELETE() {
  return new Response(null, {
    status: 204,
    headers: {
      ...SIN_CACHE,
      "set-cookie": `${COOKIE_MANTENEDOR}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}
