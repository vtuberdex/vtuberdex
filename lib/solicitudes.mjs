/**
 * Solicitudes (inscripciones y bajas): el ejecutor del entorno y el pegamento HTTP público.
 *
 * Las reglas viven en `server/src/solicitudes.mjs`; aquí solo se decide DÓNDE se guarda, con la
 * misma convención que los likes (`lib/likes.mjs`): Turso en producción (tabla `solicitud`) y
 * `data/solicitudes.db` sin él (local, CI). Las solicitudes NO van al diario de cambios: no son
 * ediciones del catálogo sino una cola de entrada que el mantenedor vacía a mano.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { SolicitudError, crearSolicitud, ejecutorSqlite } from '../server/src/solicitudes.mjs';
import { tursoConfigurado, turso } from './ediciones.mjs';
import { ipDelCliente, origenPermitido } from './likes.mjs';

let ejecutorVigente = null;

/** El ejecutor del entorno: Turso si está configurado; si no, `data/solicitudes.db`. */
export async function ejecutorDeSolicitudes() {
  if (ejecutorVigente) return ejecutorVigente;
  if (tursoConfigurado()) {
    const cliente = turso();
    ejecutorVigente = { execute: (sql, args) => cliente.execute({ sql, args }), exec: (sql) => cliente.executeMultiple(sql) };
  } else {
    // La ruta se escribe literal: una dinámica haría que Turbopack trace el proyecto entero.
    const archivo = path.join(process.cwd(), 'data', 'solicitudes.db');
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    ejecutorVigente = ejecutorSqlite(new DatabaseSync(archivo));
  }
  return ejecutorVigente;
}

/** Solo para los tests: olvida el ejecutor del entorno. */
export function reiniciarSolicitudes() {
  ejecutorVigente = null;
}

/**
 * `POST` público de una solicitud. Devuelve la `Response` ya armada.
 * Nunca se cachea y nunca devuelve el contenido guardado: el visitante solo recibe un acuse.
 */
export async function recibirSolicitud(request, tipo, ejecutor) {
  const cabeceras = { 'cache-control': 'no-store' };
  const responder = (cuerpo, status) => Response.json(cuerpo, { status, headers: cabeceras });
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const cuerpo = await request.json().catch(() => null);
  if (!cuerpo || typeof cuerpo !== 'object') return responder({ error: 'payload_invalido', detail: 'el cuerpo debe ser JSON' }, 400);
  try {
    const resultado = await crearSolicitud(ejecutor ?? (await ejecutorDeSolicitudes()), cuerpo, {
      tipo,
      ip: ipDelCliente(request.headers),
    });
    return responder({ ok: true, estado: 'pendiente', id: resultado.id }, 201);
  } catch (error) {
    if (error instanceof SolicitudError) {
      return responder({ error: error.code, detail: error.detail, issues: error.issues }, error.status);
    }
    console.error(`[solicitudes] no se pudo guardar la ${tipo}: ${error.message}`);
    return responder({ error: 'solicitudes_no_disponibles', detail: 'No se pudo registrar el envío. Inténtalo de nuevo más tarde.' }, 503);
  }
}
