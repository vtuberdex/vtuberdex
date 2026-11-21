// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `POST /api/minecraft-admin/plugins/estado { archivo, habilitado }`: renombra `X.jar` ↔
 * `X.jar.disabled` (surte efecto al reiniciar). Con el agente configurado lo hace él, como
 * `minecraft`: así la web no necesita escribir en `plugins/` y un chmod de esa carpeta desde el
 * explorador no rompe el botón. Sin agente (desarrollo) renombra la web, como antes.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../../lib/minecraft-admin.mjs";
import {
  configDelAgente,
  respuestaDelAgente,
} from "../../../../../lib/minecraft-agente.mjs";
import { anotarAuditoria } from "../../../../../lib/minecraft-consola.mjs";
import {
  cambiarEstadoPlugin,
  validarCambioDePlugin,
} from "../../../../../lib/minecraft-plugins.mjs";

export const dynamic = "force-dynamic";

/** Renombra por el agente. Si el origen no está pero el destino sí, ya estaba así. */
async function cambiarPorElAgente(cambio, quien) {
  const mover = await respuestaDelAgente({
    metodo: "POST",
    ruta: "/fs/accion",
    cabeceras: { "content-type": "application/json" },
    cuerpo: JSON.stringify({
      accion: "mover",
      de: `plugins/${cambio.origen}`,
      a: `plugins/${cambio.destino}`,
    }),
    quien,
  });
  if (mover.status === 200) {
    return { ok: true, archivo: cambio.destino };
  }
  if (mover.status === 404) {
    const info = await respuestaDelAgente({
      metodo: "POST",
      ruta: "/fs/accion",
      cabeceras: { "content-type": "application/json" },
      cuerpo: JSON.stringify({ accion: "info", ruta: `plugins/${cambio.destino}` }),
      quien,
    });
    return info.status === 200
      ? { ok: true, archivo: cambio.destino, sinCambios: true }
      : { ok: false, status: 404, cuerpo: { error: "no_existe" } };
  }
  return { ok: false, status: mover.status, cuerpo: mover.cuerpo };
}

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const cuerpo = await request.json().catch(() => null);
    if (!cuerpo || typeof cuerpo !== "object") {
      return respuestaJson({ error: "cuerpo_invalido" }, 400);
    }
    const cambio = validarCambioDePlugin({
      archivo: cuerpo.archivo,
      habilitado: cuerpo.habilitado,
    });
    let r;
    if (!cambio.ok) {
      r = cambio;
    } else if (configDelAgente()) {
      r = await cambiarPorElAgente(cambio, acceso.sesion.email);
    } else {
      r = await cambiarEstadoPlugin({
        archivo: cuerpo.archivo,
        habilitado: cuerpo.habilitado,
      });
    }
    // Habilitar un jar es instalar código: queda en la auditoría como la subida.
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: cuerpo.habilitado ? "plugin-habilitado" : "plugin-deshabilitado",
      detalle: String(cuerpo.archivo ?? ""),
      ok: r.ok,
    });
    if (!r.ok) {
      return respuestaJson(r.cuerpo, r.status);
    }
    return respuestaJson({
      ok: true,
      archivo: r.archivo,
      requiereReinicio: true,
    });
  });
}
