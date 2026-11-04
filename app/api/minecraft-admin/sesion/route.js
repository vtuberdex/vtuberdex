/**
 * `/api/minecraft-admin/sesion` — canjea el enlace mágico y abre (o cierra) la sesión.
 *
 * `POST { token }` consume el enlace de un solo uso y deja la cookie firmada con rol
 * `mantenedor`. `GET` dice quién está dentro. `DELETE` la borra.
 */
import {
  COOKIE_MANTENEDOR,
  autorizar,
  canjearEnlace,
  cookieDeSesion,
  crearSesionMantenedor,
  rolDe,
  sesionDeLaPeticion,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

const sinCache = { "cache-control": "no-store" };

export async function GET(request) {
  const sesion = sesionDeLaPeticion(request);
  const permiso = autorizar(sesion);
  if (!permiso.ok) {
    return Response.json(permiso.cuerpo, { status: permiso.status, headers: sinCache });
  }
  return Response.json(
    { email: sesion.email, role: rolDe(sesion) },
    { headers: sinCache },
  );
}

export async function POST(request) {
  const cuerpo = await request.json().catch(() => null);
  const canje = canjearEnlace(cuerpo?.token);
  if (!canje.ok) {
    return Response.json(canje.cuerpo, { status: canje.status, headers: sinCache });
  }
  const token = crearSesionMantenedor({ email: canje.sesion.email });
  if (!token) {
    return Response.json({ error: "sesion_no_creada" }, { status: 500, headers: sinCache });
  }
  const seguro = request.headers.get("x-forwarded-proto") === "https";
  return Response.json(
    { ok: true, email: canje.sesion.email, role: canje.sesion.role },
    { headers: { ...sinCache, "set-cookie": cookieDeSesion(token, { seguro }) } },
  );
}

export function DELETE() {
  return new Response(null, {
    status: 204,
    headers: {
      ...sinCache,
      "set-cookie": `${COOKIE_MANTENEDOR}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    },
  });
}
