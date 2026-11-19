// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import type { CSSProperties } from "react";

/**
 * Estilo de la caja que `<Canvas>` de R3F pone alrededor del `<canvas>` (se fusiona con su
 * `position: relative; width: 100%; height: 100%; overflow: hidden`).
 *
 * POR QUÉ: el canvas tiene que quedar FUERA DEL FLUJO (ver la trampa del `min-content` en
 * `holo-card.tsx`: el ancho inline que escribe three.js hacía de suelo y el contenedor no podía
 * encoger al rotar el móvil). Antes eso se conseguía con un `<div className="absolute inset-0">`
 * PROPIO alrededor del `<Canvas>`, y el DOM quedaba con cuatro cajas apiladas que ocupaban el mismo
 * rectángulo (raíz → nuestra caja → caja de R3F → div de R3F → canvas), con estilos repetidos en
 * cadena. Ahora la caja de R3F es la que se posiciona: una capa menos y el mismo resultado de layout.
 * NO le pongas ancho ni alto: la medida la fija la raíz `relative` (`holo-card-layout.test.ts`).
 */
export const CANVAS_FUERA_DE_FLUJO: CSSProperties = {
  position: "absolute",
  inset: 0,
};
