// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `POST /api/minecraft-admin/reinicio-forzoso` — mata el proceso del servidor (SIGKILL) para que
 * systemd lo levante de nuevo (`Restart=always`).
 *
 * POR QUÉ EXISTE: el reinicio normal manda `stop` por RCON, y eso no sirve cuando el servidor está
 * colgado. El 2026-11-28 el watchdog de Paper detuvo el hilo principal pero la JVM no salió (el
 * cierre quedó bloqueado por el profiler de spark): RCON contestaba «Cannot perform command async»
 * y el panel no tenía cómo recuperarlo.
 *
 * No guarda el mundo: se pierde lo jugado desde el último autoguardado. La web no puede matar el
 * proceso (corre como `vtuberdex`); lo hace el agente, que corre como `minecraft`, y solo mata el
 * proceso del servidor (ver `matarServidor` en `minecraft-agente/agente.mjs`). No acepta datos del
 * cliente, exige `X-Panel: 1` (CSRF) y queda en la auditoría.
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

export async function POST(request) {
  return conMantenedor(request, async (acceso) => {
    const sinCabecera = rechazoSinCabeceraDelPanel(request);
    if (sinCabecera) {return sinCabecera;}
    const r = await respuestaDelAgente({
      metodo: "POST",
      ruta: "/servidor/matar",
      quien: acceso.sesion.email,
    });
    await anotarAuditoria({
      quien: acceso.sesion.email,
      rol: acceso.sesion.role,
      tipo: "reinicio-forzoso",
      detalle: r.status === 200 ? `pid ${(r.cuerpo?.pids ?? []).join(", ")}` : String(r.cuerpo?.error ?? ""),
      ok: r.status === 200,
    });
    if (r.status !== 200) {
      return respuestaJson(r.cuerpo, r.status);
    }
    return respuestaJson({ ok: true });
  });
}
