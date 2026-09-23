/**
 * CAPA 1 — el personaje, única imagen fuente del VTuber.
 */
import { FONT } from './dimensiones';
import { createLayer } from './lienzo';

/** Capa 1: personaje, transparente, solo el arte con su alfa. */
export function drawCharacterLayer({ art, width }: { art: HTMLImageElement | null; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  if (art) {
    const scaleToHeight = H / art.height;
    const dw = art.width * scaleToHeight;
    const dx = (W - dw) / 2;
    ctx.drawImage(art, dx, 0, dw, H);
  } else {
    ctx.font = `700 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.fillText('SIN IMAGEN', W / 2, H / 2);
  }
  return canvas;
}
