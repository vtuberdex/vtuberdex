/**
 * Geometría de la placa premium: dónde va cada pieza dentro de la placa y a qué escala entra la
 * carta. Matemática pura (sin React ni WebGL) para que `premium-layout.test.ts` la fije sin
 * navegador: jsdom no ve la escena, pero sí puede comprobar que la carta CABE en la ventana y la
 * placa en la funda del libro.
 *
 * Convención: el centro de la placa es el origen, +y arriba, las medidas en unidades de mundo.
 * La placa ocupa exactamente el hueco de la funda (alto = carta + 2 x holgura de funda), así que
 * en el libro no se sale de su casilla y el resto de la maqueta no se entera.
 */
import { PREMIUM } from '@/components/card3d-config';

export interface Rect {
  /** Centro. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SlabLayout {
  /** Medidas exteriores de la placa. */
  width: number;
  height: number;
  /** Zona de la etiqueta (arriba) y ventana de la carta (abajo). */
  label: Rect;
  window: Rect;
  /** Factor que se aplica a la carta para que su ancho iguale al de la ventana. */
  cardScale: number;
  /** Margen lateral, por si el dibujo lo necesita. */
  margin: number;
}

/**
 * @param cardW    ancho de la carta sin escalar
 * @param cardH    alto de la carta sin escalar
 * @param outerPad holgura de la funda a cada lado: el alto de la placa es `cardH + 2 * outerPad`
 */
export function slabLayout(cardW: number, cardH: number, outerPad: number): SlabLayout {
  const { margin, labelHeight, labelGap } = PREMIUM.layout;
  const height = cardH + 2 * outerPad;
  const aspect = cardH / cardW;
  // Alto de la placa en anchos de placa: margen + etiqueta + aire + ventana + margen.
  const heightInWidths = margin + labelHeight + labelGap + aspect * (1 - 2 * margin) + margin;
  const width = height / heightInWidths;
  const windowW = width * (1 - 2 * margin);
  const windowH = windowW * aspect;
  const top = height / 2;
  const labelH = width * labelHeight;
  const label: Rect = { x: 0, y: top - width * margin - labelH / 2, w: windowW, h: labelH };
  const window: Rect = {
    x: 0,
    y: top - width * margin - labelH - width * labelGap - windowH / 2,
    w: windowW,
    h: windowH,
  };
  return { width, height, label, window, cardScale: windowW / cardW, margin: width * margin };
}
