/**
 * `/api/minecraft-admin/plugins` — sube un jar de plugin.
 *
 * Un jar es código que se ejecuta en el servidor: pueden subirlo los admin y los mantenedores
 * autorizados (la lista cerrada de correos), nadie más. Se comprueba el rol, la extensión, que el
 * nombre no lleve rutas y el tamaño máximo ANTES de escribir nada.
 *
 * El cuerpo de la petición son los BYTES del jar y el nombre viaja en `?nombre=`. No se usa
 * `multipart/form-data` a propósito: el panel manda el `File` tal cual (el navegador lo
 * transmite en streaming) y así la ruta no tiene que montar un formulario en memoria.
 */
import {
  LIMITE_JAR_BYTES,
  accesoDeMantenedor,
  conMantenedor,
  guardarJar,
  respuestaJson,
  validarJar,
} from "../../../../lib/minecraft-admin.mjs";

export const dynamic = "force-dynamic";

import {
  listarPlugins,
  analizarPluginsCargados,
} from "../../../../lib/minecraft-plugins.mjs";
import { ejecutarAccion } from "../../../../lib/minecraft-rcon.mjs";

/** GET: plugins instalados con sus datos y si están cargados (lo que dice `/plugins` por RCON). */
export async function GET(request) {
  return conMantenedor(request, async () => {
    const rcon = await ejecutarAccion("plugins", {}).catch(() => null);
    const cargados = rcon?.ok ? analizarPluginsCargados(rcon.respuesta) : null;
    return respuestaJson(await listarPlugins({ cargados }));
  });
}

export const config = { api: { bodyParser: false } };

export async function POST(request) {
  const acceso = accesoDeMantenedor(request, {});
  if (acceso.rechazo) return acceso.rechazo;

  const url = new URL(request.url);
  const nombre =
    url.searchParams.get("nombre") ?? request.headers.get("x-nombre-archivo");
  if (!nombre) return respuestaJson({ error: "falta_nombre" }, 400);

  // Si el navegador anuncia el tamaño, se corta aquí: no se leen 9 MB para nada.
  const anunciado = Number(request.headers.get("content-length"));
  if (Number.isFinite(anunciado) && anunciado > LIMITE_JAR_BYTES) {
    return respuestaJson(
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
  if (!comprobacion.ok)
    return respuestaJson(comprobacion.cuerpo, comprobacion.status);

  const resultado = await guardarJar({ nombre, contenido: datos });
  if (!resultado.ok) return respuestaJson(resultado.cuerpo, resultado.status);
  return respuestaJson(resultado.metadatos, 201);
}
