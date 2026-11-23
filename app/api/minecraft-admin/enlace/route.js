// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `/api/minecraft-admin/enlace` — pide el enlace mágico del mantenedor.
 *
 * No dice si el correo tiene permiso: responde lo mismo exista o no, para que la ruta no sirva
 * de listín de quién mantiene el servidor. El enlace va en el fragmento de la URL y caduca.
 */
import {
  enviarEnlaceMantenedor,
  respuestaJson,
} from "../../../../lib/minecraft-admin.mjs";
import { ipDelCliente } from "../../../../lib/likes.mjs";
import { limitePorRed } from "../../../../lib/limite-red.mjs";

/** Pedidos de enlace por red: 5 cada 15 minutos (auditoría 2026-11-19; antes, sin tope). */
const redAgotada = limitePorRed(new Map(), {
  ventanaMs: 15 * 60 * 1000,
  maximo: 5,
});

export const dynamic = "force-dynamic";

export async function POST(request) {
  if (redAgotada(ipDelCliente(request.headers))) {
    return respuestaJson(
      {
        error: "demasiados_intentos",
        detail: "Espera unos minutos antes de pedir otro enlace.",
      },
      429,
    );
  }
  const cuerpo = await request.json().catch(() => null);
  const resultado = await enviarEnlaceMantenedor({ email: cuerpo?.email });
  if (!resultado.ok) {
    return respuestaJson(resultado.cuerpo, resultado.status);
  }
  return respuestaJson({ ok: true });
}
