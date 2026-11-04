/**
 * `/api/minecraft-admin/plugins` — sube un jar de plugin.
 *
 * Un jar es código que se ejecuta en el servidor: se comprueba el rol, la extensión, que el
 * nombre no lleve rutas y el tamaño máximo ANTES de escribir nada.
 *
 * El cuerpo de la petición son los BYTES del jar y el nombre viaja en `?nombre=`. No se usa
 * `multipart/form-data` a propósito: el panel manda el `File` tal cual (el navegador lo
 * transmite en streaming) y así la ruta no tiene que montar un formulario en memoria.
 */
import {
  LIMITE_JAR_BYTES,
  autorizar,
  guardarJar,
  sesionDeLaPeticion,
  validarJar,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

export const config = { api: { bodyParser: false } };

const sinCache = { "cache-control": "no-store" };

const rechazo = (cuerpo, status) =>
  Response.json(cuerpo, { status, headers: sinCache });

export async function POST(request) {
  const permiso = autorizar(sesionDeLaPeticion(request));
  if (!permiso.ok) return rechazo(permiso.cuerpo, permiso.status);

  const url = new URL(request.url);
  const nombre = url.searchParams.get("nombre") ?? request.headers.get("x-nombre-archivo");
  if (!nombre) return rechazo({ error: "falta_nombre" }, 400);

  // Si el navegador anuncia el tamaño, se corta aquí: no se leen 9 MB para nada.
  const anunciado = Number(request.headers.get("content-length"));
  if (Number.isFinite(anunciado) && anunciado > LIMITE_JAR_BYTES) {
    return rechazo(
      {
        error: "archivo_demasiado_grande",
        detail: `el máximo son ${LIMITE_JAR_BYTES} bytes`,
        limite: LIMITE_JAR_BYTES,
      },
      413,
    );
  }

  const datos = new Uint8Array(await request.arrayBuffer());
  const comprobacion = validarJar({ nombre, tamano: datos.byteLength });
  if (!comprobacion.ok) return rechazo(comprobacion.cuerpo, comprobacion.status);

  const resultado = await guardarJar({ nombre, contenido: datos });
  if (!resultado.ok) return rechazo(resultado.cuerpo, resultado.status);
  return Response.json(resultado.metadatos, { status: 201, headers: sinCache });
}
