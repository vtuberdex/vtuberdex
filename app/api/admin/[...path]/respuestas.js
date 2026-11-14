// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Piezas que comparten `route.js` y `solicitudes-rutas.js` del mantenedor de producción.
 *
 * Viven aparte para que las rutas de la cola de solicitudes puedan estar en su propio archivo sin
 * importar `route.js` (un módulo de ruta de Next solo debería exportar los métodos HTTP).
 */
import { NextResponse } from "next/server";

import { MutationError } from "../../../../server/src/mutations.mjs";

/** Operación del diario que edita una ficha existente (`lib/diario.mjs`). */
export const OP_EDITAR = "vtuber.editar";

/** El único formato de imagen que se guarda: el contenedor de las carpetas publicadas. */
export const MIME_WEBP = "image/webp";

/**
 * Respuesta de error de una mutación: el estado y el código que decidieron las reglas
 * compartidas (`server/src/mutations.mjs`), idénticos a los del Express local.
 */
export function responderError(error) {
  if (error instanceof MutationError) {
    return NextResponse.json(
      { error: error.code, detail: error.detail },
      { status: error.status },
    );
  }
  console.error("[admin] error al guardar", error);
  return NextResponse.json(
    { error: "error_al_guardar", detail: error.message },
    { status: 500 },
  );
}
