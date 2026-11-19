// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Las poses del libro como matrices de three (giro de la hoja y cartas fijas o montadas en ella).
 *
 * Separadas de `card-binder-layout.ts` A PROPÓSITO: el DOM del libro (`card-binder.tsx`) usa la
 * geometría pura de ahí, y si ese módulo importara three, three entero acabaría en el JS del catálogo
 * en vez de en el chunk de la escena (`card-binder-escena.tsx`, cargado con `next/dynamic`).
 */
import { Matrix4, Vector3 } from "three";

import { BINDER } from "@/components/card3d-config";
import type { SlotPosition } from "@/components/card-binder-layout";

/**
 * Matriz de la hoja que gira: rotación alrededor del lomo. El pivote es el origen, así
 * que basta la rotación; la hoja y sus cartas llevan su posición en coordenadas locales.
 */
export function sheetMatrix(theta: number, target = new Matrix4()): Matrix4 {
  return target.makeRotationY(theta);
}

const _pos = new Vector3();

/**
 * Pose LOCAL (respecto de la hoja que gira) de una carta montada en ella.
 *
 * Cara frontal: la carta va en su funda de origen, por encima de la hoja. Dorso: la
 * carta va en su funda de DESTINO pero girada media vuelta, es decir, al empezar el
 * giro está reflejada detrás de la hoja de origen (x opuesta, z negativa, mirando a
 * -z) y, cuando la hoja completa los 180 grados, las dos medias vueltas se anulan y
 * cae exactamente en su funda de destino mirando a la cámara. Así una carta entrante
 * nunca cambia de sitio en el mundo al terminar: solo deja de depender de la hoja.
 */
export function sheetCardLocalMatrix(
  position: SlotPosition,
  face: "front" | "back",
  target = new Matrix4(),
): Matrix4 {
  const z = BINDER.sheetZ + BINDER.cardLift;
  target.makeTranslation(position.x, position.y, z);
  if (face === "back") {
    const flip = new Matrix4().makeRotationY(Math.PI);
    target.premultiply(flip);
  }
  return target;
}

/** Matriz de una carta fija en su funda (no participa del giro). */
export function staticCardMatrix(
  position: SlotPosition,
  lift = 0,
  target = new Matrix4(),
): Matrix4 {
  return target.makeTranslation(position.x, position.y, BINDER.cardLift + lift);
}

/** Posición mundial que resulta de una matriz (para los tests y el ocultamiento). */
export function worldPosition(matrix: Matrix4): {
  x: number;
  y: number;
  z: number;
} {
  _pos.setFromMatrixPosition(matrix);
  return { x: _pos.x, y: _pos.y, z: _pos.z };
}
