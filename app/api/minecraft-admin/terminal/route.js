// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/terminal` — terminales bash sobre la carpeta del servidor.
 *
 * - `GET`  las terminales abiertas por quien llama (para volver a engancharse tras recargar).
 * - `POST { filas, columnas, titulo? }` abre una (máximo 4 por persona).
 *
 * La shell corre en el agente `vtuberdex-mc-agente` como `minecraft`, dentro de bubblewrap: solo
 * ve `/srv/minecraft`, `/usr` y lo mínimo de `/etc`. Ver `minecraft-agente/agente.mjs`.
 * La salida y la entrada van por `terminal/[id]`.
 */
import {
  conMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import {
  rechazoSinCabeceraDelPanel,
  respuestaDelAgente,
} from "../../../../lib/minecraft-agente.mjs";
import { anotarAuditoria } from "../../../../lib/minecraft-consola.mjs";

export const dynamic = "force-dynamic";

export async function GET(request) {
  return conMantenedor(request, async (acceso) => {
    const r = await respuestaDelAgente({ ruta: "/term", quien: acceso.sesion.email });
    return respuestaJson(r.cuerpo, r.status);
  });
}

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const sinCabecera = rechazoSinCabeceraDelPanel(request);
    if (sinCabecera) {return sinCabecera;}
    const cuerpo = await request.json().catch(() => ({}));
    const r = await respuestaDelAgente({
      metodo: "POST",
      ruta: "/term",
      cuerpo: JSON.stringify({
        filas: cuerpo?.filas,
        columnas: cuerpo?.columnas,
        titulo: cuerpo?.titulo,
      }),
      cabeceras: { "content-type": "application/json" },
      quien: acceso.sesion.email,
    });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: "terminal-abierta",
      detalle: r.cuerpo?.id ?? r.cuerpo?.error ?? "",
      ok: r.status === 201,
    });
    return respuestaJson(r.cuerpo, r.status);
  });
}
