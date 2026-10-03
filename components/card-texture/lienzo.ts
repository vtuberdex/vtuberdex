/**
 * Creación de los canvas de capa: uno por capa, con la escala ya aplicada.
 */
import { CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT } from './dimensiones';

/** Crea un canvas con el tamaño destino y escala canónica. */
export function createLayer(width: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D | null; scale: number; W: number; H: number } {
  const scale = width / CARD_TEXTURE_WIDTH;
  const H = Math.round(width * (CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = H;
  /**
   * `willReadFrequently`: las capas NO se quedan en la GPU. `completar` las copia (`drawImage`)
   * sobre el canvas combinado y de ahí lee píxeles (`getImageData`) para las máscaras; con un
   * canvas ACELERADO cada una de esas lecturas es una espera sincrónica GPU -> CPU en el hilo
   * principal. Medido en el giro de página (perfil de CPU de CDP, mismo flujo, mismas cartas):
   * `getImageData` 2.596 ms con canvas acelerado frente a 205 ms con canvas en CPU, justo mientras
   * las 4 cartas entrantes generan sus texturas = el tirón al pasar de página. Subirlas a WebGL
   * desde un canvas de CPU es una subida normal (`texImage2D`) y el dibujo 2D de texto y
   * degradados cuesta lo medido en AGENTS.md (~14 ms por carta a 512).
   */
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (ctx) {
    ctx.scale(scale, scale);
    ctx.save();
  }
  return { canvas, ctx, scale, W: CARD_TEXTURE_WIDTH, H: CARD_TEXTURE_HEIGHT };
}

/**
 * Capa VACÍA de 1x1, para ocupar un slot de `uLayerN` sin coste.
 *
 * Un canvas transparente del tamaño de la carta ocupa ~5,7 MB de textura en la GPU por
 * carta (1008x1411x4) y el muestreo devuelve lo mismo que el de 1x1: alfa 0 en todo el
 * UV. Se usa cuando una capa se retira pero su índice no puede cambiar, porque
 * renumerar movería las posiciones de PARALLAX_LAYERS y el resto de uniformes.
 */
export function emptyLayer(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}
