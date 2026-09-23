/**
 * CAPA 0 — fondo subido, escalado por encima del lienzo para el paralaje.
 */
import { BACKGROUND } from '../card3d-config';
import { createLayer } from './lienzo';

/** Capa 0: background/fondo. Si no existe background, se deja transparente. */
export function drawBackgroundLayer({ background, width }: { background: HTMLImageElement | null; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  if (background) {
    /**
     * ESCALA del fondo dentro de la carta.
     *
     * 1.10 daba el margen justo para el paralaje, y el usuario pidió el fondo un 10% MÁS
     * GRANDE: 1.10 * 1.10 = 1.21. Como el encuadre ya venía escalado al lado más pequeño que
     * cubre el canvas, ese 10% extra se come margen del arte y deja ver menos borde de la
     * imagen — que es exactamente el efecto buscado (el fondo llena más la carta).
     */
    const cover = BACKGROUND.cover;
    const scaleToWidth = (W * cover) / background.width;
    const scaleToHeight = (H * cover) / background.height;
    const s = Math.max(scaleToWidth, scaleToHeight);
    const dw = background.width * s;
    const dh = background.height * s;
    const dx = (W - dw) / 2;
    const dy = (H - dh) / 2;
    ctx.drawImage(background, dx, dy, dw, dh);
  }
  // Si no hay background, el canvas queda transparente y el shader mostrará
  // el degradado/fondo que tenga por debajo de esta capa.
  return canvas;
}
