/**
 * Geometría del libro de cartas: dónde va cada funda, cómo gira la hoja y a qué
 * distancia se pone la cámara. Es matemática pura (sin React ni WebGL) para que
 * `card-binder-layout.test.ts` la fije sin navegador: jsdom no puede ver la escena,
 * pero sí puede comprobar que una carta de la hoja derecha ATERRIZA exactamente en su
 * funda de la izquierda al terminar el giro.
 *
 * Convenciones:
 *   · El lomo es la recta x = 0, z = 0; la hoja izquierda ocupa x < 0 y la derecha x > 0.
 *   · El plano de las hojas fijas es z = 0 y la cámara mira desde +z.
 *   · Los HUECOS (slots) van en orden de lectura: 0..3 la hoja izquierda (fila a fila),
 *     4..7 la derecha. `items[i]` del catálogo cae en el slot `i`.
 */
import { Matrix4, Vector3 } from 'three';

import { BINDER, GEOMETRY } from '@/components/card3d-config';

export type Side = 'left' | 'right';
/** Sentido del paso de página: +1 avanza (la hoja derecha gira a la izquierda), -1 retrocede. */
export type FlipDir = 1 | -1;

export const CARD_W = GEOMETRY.cardWidth;
export const CARD_H = GEOMETRY.cardWidth * GEOMETRY.aspect;
/** Cartas visibles en el libro abierto (las dos hojas). */
export const CARDS_PER_SPREAD = BINDER.cardsPerPage * 2;

export interface BookDimensions {
  pageW: number;
  pageH: number;
  /** Ancho total con las dos hojas y el lomo. */
  spreadW: number;
  /** Centro en x de la hoja derecha (la izquierda es el opuesto). */
  pageCenterX: number;
}

export function bookDimensions(): BookDimensions {
  const rows = BINDER.cardsPerPage / BINDER.columns;
  const pageW = BINDER.columns * CARD_W + (BINDER.columns - 1) * BINDER.gap + 2 * BINDER.padding;
  const pageH = rows * CARD_H + (rows - 1) * BINDER.gap + 2 * BINDER.padding;
  return {
    pageW,
    pageH,
    spreadW: pageW * 2 + BINDER.spine,
    pageCenterX: BINDER.spine / 2 + pageW / 2,
  };
}

export interface SlotPosition {
  x: number;
  y: number;
}

/** Lado al que pertenece un slot (0..3 izquierda, 4..7 derecha). */
export function slotSide(slot: number): Side {
  return slot < BINDER.cardsPerPage ? 'left' : 'right';
}

/**
 * Centro de la funda de un slot en el plano del libro.
 *
 * La hoja izquierda es el REFLEJO de la derecha (misma distancia al lomo), pero el
 * orden de lectura no se refleja: el slot 0 es la funda superior izquierda de la hoja
 * izquierda, por eso se calcula la columna sobre el ancho de la hoja y luego se
 * desplaza al lado que toca en vez de negar la x de la derecha.
 */
export function slotPosition(slot: number): SlotPosition {
  const { pageW, pageCenterX } = bookDimensions();
  const local = slot % BINDER.cardsPerPage;
  const col = local % BINDER.columns;
  const row = Math.floor(local / BINDER.columns);
  const rows = BINDER.cardsPerPage / BINDER.columns;
  // Columna medida desde el borde izquierdo de la hoja, centrada en la funda.
  const xInPage = -pageW / 2 + BINDER.padding + CARD_W / 2 + col * (CARD_W + BINDER.gap);
  const yTop = (rows - 1) * (CARD_H + BINDER.gap) / 2;
  const y = yTop - row * (CARD_H + BINDER.gap);
  const centerX = slotSide(slot) === 'left' ? -pageCenterX : pageCenterX;
  return { x: centerX + xInPage, y };
}

/** Las 8 posiciones, en orden de slot. */
export function allSlotPositions(): SlotPosition[] {
  return Array.from({ length: CARDS_PER_SPREAD }, (_, slot) => slotPosition(slot));
}

/**
 * Curva del giro: arranque y frenada suaves (cúbica), sin rebote. Una hoja de cartón
 * con fundas no vibra al caer, y el rebote haría que las cartas del dorso parecieran
 * «hundirse» en la hoja de destino al final.
 */
export function easeFlip(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
}

/**
 * Ángulo de la hoja (rad) para un progreso y un sentido.
 *
 * El signo importa: con una rotación alrededor de y, la hoja derecha (x > 0) sube hacia
 * la cámara (z > 0) solo si el ángulo es NEGATIVO (z' = -x·sin θ). Con el signo contrario
 * la hoja se hunde en la tapa y el giro se ve «por dentro» del libro. Al retroceder gira
 * la hoja izquierda (x < 0) y el signo se invierte por la misma razón.
 */
export function sheetAngle(dir: FlipDir, progress: number): number {
  return -dir * Math.PI * easeFlip(progress);
}

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
  face: 'front' | 'back',
  target = new Matrix4(),
): Matrix4 {
  const z = BINDER.sheetZ + BINDER.cardLift;
  target.makeTranslation(position.x, position.y, z);
  if (face === 'back') {
    const flip = new Matrix4().makeRotationY(Math.PI);
    target.premultiply(flip);
  }
  return target;
}

/** Matriz de una carta fija en su funda (no participa del giro). */
export function staticCardMatrix(position: SlotPosition, lift = 0, target = new Matrix4()): Matrix4 {
  return target.makeTranslation(position.x, position.y, BINDER.cardLift + lift);
}

/** Posición mundial que resulta de una matriz (para los tests y el ocultamiento). */
export function worldPosition(matrix: Matrix4): { x: number; y: number; z: number } {
  _pos.setFromMatrixPosition(matrix);
  return { x: _pos.x, y: _pos.y, z: _pos.z };
}

/**
 * Qué cartas FIJAS tienen que esconderse mientras la hoja gira.
 *
 *   · `uncover`: la carta estaba tapada por la hoja de origen y aparece cuando la hoja
 *     se ha levantado lo bastante (`revealAngle`).
 *   · `cover`: la carta vive en la hoja de destino y la va a tapar la hoja que cae; se
 *     esconde cuando a la hoja le falta menos de `revealAngle` para aterrizar.
 *
 * Sin esto la cara (~0.16 sobre la hoja) atravesaría una hoja casi plana cerca del lomo.
 */
export type RevealRule = 'none' | 'uncover' | 'cover';

export function isStaticCardVisible(rule: RevealRule, theta: number): boolean {
  const turned = Math.abs(theta);
  if (rule === 'uncover') return turned > BINDER.revealAngle;
  if (rule === 'cover') return Math.PI - turned > BINDER.revealAngle;
  return true;
}

/**
 * Distancia de cámara para que el libro abierto entre COMPLETO en un contenedor de la
 * proporción dada (contain): se calcula la distancia que exige el alto y la que exige
 * el ancho y gana la mayor.
 */
export function fitCameraZ(aspect: number, fovDeg = GEOMETRY.cameraFov, fill = BINDER.cameraFill): number {
  const { spreadW, pageH } = bookDimensions();
  const halfFov = (fovDeg * Math.PI) / 180 / 2;
  const tan = Math.tan(halfFov);
  const safeAspect = Math.max(0.2, aspect || 1);
  const byHeight = pageH / 2 / tan;
  const byWidth = spreadW / 2 / (tan * safeAspect);
  return Math.max(byHeight, byWidth) / fill;
}

/**
 * Avance del giro en un frame. Devuelve el nuevo progreso. Si la página siguiente aún
 * no está (`ready = false`) se detiene en `holdProgress` con la hoja en pie: cuando
 * lleguen los datos sigue desde ahí, sin salto, porque el progreso se integra por
 * tiempo transcurrido y no por marca de inicio.
 */
export function advanceFlip(progress: number, deltaSeconds: number, ready: boolean): number {
  const next = progress + (deltaSeconds * 1000) / BINDER.flipMs;
  const ceiling = ready ? 1 : BINDER.holdProgress;
  return Math.min(ceiling, next);
}

/* ----------------------------------------------------------------------------
 * Reparto de cartas entre hojas durante el giro.
 * ------------------------------------------------------------------------- */

export type CardRole = 'static' | 'sheet-front' | 'sheet-back';

export interface Placement<T> {
  card: T;
  slot: number;
  role: CardRole;
  reveal: RevealRule;
}

interface Identified {
  id: number;
}

/**
 * Qué carta va en qué hoja mientras se pasa de página.
 *
 * Al AVANZAR gira la hoja derecha: su cara lleva las cartas salientes de la derecha y su
 * dorso las entrantes de la izquierda; las salientes de la izquierda se quedan fijas
 * hasta que la hoja cae encima (`cover`) y las entrantes de la derecha esperan debajo
 * de la hoja hasta que se levanta (`uncover`). Al RETROCEDER es el espejo exacto.
 *
 * Las cartas se identifican por `id`, y si una misma carta está en la página saliente
 * y en la entrante (puede pasar al cambiar filtros y página a la vez) gana la entrante:
 * una `key` duplicada en React montaría dos veces la misma carta y sus texturas.
 */
export interface PlacementOptions {
  /**
   * Modo de UNA hoja (celular): las 4 cartas de la página van todas en la hoja DERECHA
   * (slots 4..7) y la izquierda queda vacía. Al avanzar, la hoja derecha gira con las
   * cartas salientes en su cara y deja ver las entrantes debajo; al retroceder, la hoja
   * izquierda (vacía) vuelve con las entrantes en su dorso. Es la misma mecánica del
   * libro de 8 con la mitad izquierda sin cartas.
   */
  singleSheet?: boolean;
}

export function planPlacements<T extends Identified>(
  incoming: readonly T[],
  flip: { dir: FlipDir; outgoing: readonly T[] } | null,
  options: PlacementOptions = {},
): Placement<T>[] {
  const half = BINDER.cardsPerPage;
  const single = options.singleSheet === true;
  const splitLeft = (cards: readonly T[]) => (single ? [] : cards.slice(0, half));
  const splitRight = (cards: readonly T[]) => (single ? cards.slice(0, half) : cards.slice(half, CARDS_PER_SPREAD));
  const incomingLeft = splitLeft(incoming);
  const incomingRight = splitRight(incoming);
  if (!flip) {
    return [
      ...incomingLeft.map((card, i) => ({ card, slot: i, role: 'static' as const, reveal: 'none' as const })),
      ...incomingRight.map((card, i) => ({ card, slot: half + i, role: 'static' as const, reveal: 'none' as const })),
    ];
  }
  const incomingIds = new Set(incoming.map((card) => card.id));
  const outgoing = flip.outgoing.filter((card) => !incomingIds.has(card.id));
  const outgoingLeft = splitLeft(flip.outgoing).filter((card) => outgoing.includes(card));
  const outgoingRight = splitRight(flip.outgoing).filter((card) => outgoing.includes(card));

  const place = <U,>(cards: readonly U[], firstSlot: number, role: CardRole, reveal: RevealRule): Placement<U>[] =>
    cards.map((card, i) => ({ card, slot: firstSlot + i, role, reveal }));

  if (flip.dir === 1) {
    return [
      ...place(outgoingLeft, 0, 'static', 'cover'),
      ...place(outgoingRight, half, 'sheet-front', 'none'),
      ...place(incomingLeft, 0, 'sheet-back', 'none'),
      ...place(incomingRight, half, 'static', 'uncover'),
    ];
  }
  return [
    ...place(outgoingRight, half, 'static', 'cover'),
    ...place(outgoingLeft, 0, 'sheet-front', 'none'),
    ...place(incomingRight, half, 'sheet-back', 'none'),
    ...place(incomingLeft, 0, 'static', 'uncover'),
  ];
}

/** Lado de la hoja que gira para un sentido: avanzar levanta la derecha. */
export function turningSide(dir: FlipDir): Side {
  return dir === 1 ? 'right' : 'left';
}
