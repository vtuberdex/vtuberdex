// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/archivos` — explorador de archivos del servidor.
 *
 * `GET ?carpeta=` lista UNA carpeta (subcarpetas, archivos editables, comprimidos y si admite
 * escritura); `GET ?ruta=` devuelve el texto; `PUT { ruta, contenido }` valida y guarda con copia
 * `.bak`; `POST` sube un `.zip` dentro de `plugins/` (el nombre va en `?nombre=` y la carpeta en
 * `?carpeta=`).
 * El rol se comprueba en cada método. Las reglas de qué se puede abrir viven en
 * `lib/minecraft-archivos.mjs`; cada guardado se anota en la auditoría.
 */
import {
  LIMITE_JAR_BYTES,
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import {
  borrarArchivo,
  crearCarpeta,
  guardarArchivo,
  guardarArchivoSuelto,
  guardarComprimido,
  leerArchivo,
  listarCarpeta,
} from "../../../../lib/minecraft-archivos.mjs";
import { anotarAuditoria } from "../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async (acceso) => {
    const params = new URL(request.url).searchParams;
    const ruta = params.get("ruta");
    // Sin `ruta` es navegar: `?carpeta=plugins/MythicMobs` abre esa carpeta y sin `carpeta`
    // se abre la raíz (archivos de Paper/Bukkit/Spigot y las carpetas navegables).
    if (!ruta) {
      const listado = await listarCarpeta({
        ruta: params.get("carpeta"),
        rol: acceso.sesion.role,
      });
      if (!listado.ok) {
        return respuestaJson(listado.cuerpo, listado.status);
      }
      return respuestaJson(listado);
    }
    const resultado = await leerArchivo({ ruta, rol: acceso.sesion.role });
    if (!resultado.ok) {
      return respuestaJson(resultado.cuerpo, resultado.status);
    }
    return respuestaJson(resultado);
  });
}

export async function PUT(request) {
  return conMantenedor(request, async (acceso) => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const resultado = await guardarArchivo({
      ruta: cuerpo.ruta,
      contenido: cuerpo.contenido,
      rol: acceso.sesion.role,
    });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: "archivo-guardado",
      detalle: String(cuerpo.ruta ?? ""),
      ok: resultado.ok,
    });
    if (!resultado.ok) {
      return respuestaJson(resultado.cuerpo, resultado.status);
    }
    return respuestaJson({
      ok: true,
      ruta: resultado.ruta,
      bytes: resultado.bytes,
    });
  });
}

/**
 * Sube un archivo a una carpeta de `plugins/`: un `.zip` o uno SUELTO (configuración, modelo de
 * Blockbench, texto). Los bytes van en el cuerpo (el navegador manda el `File` tal cual) y el
 * nombre en `?nombre=`; `?carpeta=` dice el destino y `?sobrescribir=1` confirma que se reemplaza
 * el que ya estaba (el panel pregunta antes).
 *
 * Nada de lo que se sube se ejecuta ni se descomprime: un zip ocupa disco y puede pisar el
 * paquete de recursos de un plugin, y un suelto solo cuenta si su extensión está en la lista
 * cerrada. Mismo tope para los dos (el de un jar).
 */
export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const url = new URL(request.url);
    const carpeta = url.searchParams.get("carpeta");
    const nombre =
      url.searchParams.get("nombre") ??
      request.headers.get("x-nombre-archivo");
    const sobrescribir = url.searchParams.get("sobrescribir") === "1";

    // Si el navegador anuncia el tamaño, se corta aquí: no se leen 50 MB para nada.
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
    // La extensión decide qué se valida; los ejecutables y los scripts los corta la lista cerrada
    // de `lib/minecraft-archivos.mjs`, no el navegador.
    const esZip = /\.zip$/i.test(String(nombre ?? ""));
    const guardar = esZip ? guardarComprimido : guardarArchivoSuelto;
    const resultado = await guardar({
      carpeta,
      nombre,
      contenido: datos,
      sobrescribir,
      rol: acceso.sesion.role,
    });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: esZip ? "comprimido-subido" : "archivo-subido",
      detalle: `${carpeta ?? ""}/${nombre ?? ""}`,
      ok: resultado.ok,
    });
    if (!resultado.ok) {
      return respuestaJson(resultado.cuerpo, resultado.status);
    }
    return respuestaJson(resultado, 201);
  });
}

/**
 * Borra un archivo editable del servidor (`?ruta=`). Admin y mantenedor; el servidor deja una
 * copia `.bak` al lado antes de borrar, así un clic de más se recupera. La ruta se valida igual
 * que al guardar: solo se borra lo que el explorador deja escribir.
 */
export async function DELETE(request) {
  return conMantenedor(request, async (acceso) => {
    const ruta = new URL(request.url).searchParams.get("ruta");
    const resultado = await borrarArchivo({ ruta, rol: acceso.sesion.role });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: "archivo-borrado",
      detalle: String(ruta ?? ""),
      ok: resultado.ok,
    });
    if (!resultado.ok) {
      return respuestaJson(resultado.cuerpo, resultado.status);
    }
    return respuestaJson(resultado);
  });
}
