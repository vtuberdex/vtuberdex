/**
 * `/api/minecraft-admin/configuracion` — lee y guarda la configuración.
 *
 * `GET ?tipo=servidor|plugin&archivo=x.yml` devuelve el texto; `PUT { tipo, archivo, contenido }`
 * lo valida (server.properties línea a línea, yml sin tabuladores) y lo escribe. El rol se
 * comprueba en cada método, no solo en la página.
 */
import {
  autorizar,
  guardarConfiguracion,
  leerConfiguracion,
  sesionDeLaPeticion,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

const sinCache = { "cache-control": "no-store" };

export async function GET(request) {
  const permiso = autorizar(sesionDeLaPeticion(request));
  if (!permiso.ok) {
    return Response.json(permiso.cuerpo, { status: permiso.status, headers: sinCache });
  }
  const url = new URL(request.url);
  const resultado = await leerConfiguracion({
    tipo: url.searchParams.get("tipo") ?? "servidor",
    archivo: url.searchParams.get("archivo") ?? undefined,
  });
  if (!resultado.ok) {
    return Response.json(resultado.cuerpo, { status: resultado.status, headers: sinCache });
  }
  return Response.json(resultado, { headers: sinCache });
}

export async function PUT(request) {
  const permiso = autorizar(sesionDeLaPeticion(request));
  if (!permiso.ok) {
    return Response.json(permiso.cuerpo, { status: permiso.status, headers: sinCache });
  }
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== "object") {
    return Response.json({ error: "cuerpo_invalido" }, { status: 400, headers: sinCache });
  }
  const resultado = await guardarConfiguracion({
    tipo: cuerpo.tipo,
    archivo: cuerpo.archivo,
    contenido: cuerpo.contenido,
  });
  if (!resultado.ok) {
    return Response.json(resultado.cuerpo, { status: resultado.status, headers: sinCache });
  }
  return Response.json({ ok: true, ruta: resultado.ruta }, { headers: sinCache });
}
