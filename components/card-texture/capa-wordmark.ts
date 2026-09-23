/**
 * CAPA 6 — wordmark VTUBERDEX.
 */
import type { VtuberCard } from '@/lib/types';
import { cardPalette } from '@/lib/color';
import { FONT } from './dimensiones';
import { createLayer } from './lienzo';
import { drawMetalWordmark } from './pintura';

/**
 * Capa 6: wordmark VTUBERDEX — METÁLICO SOLO EN LAS LETRAS.
 *
 * El metal va en el TEXTO, no en una placa detrás: se pinta la palabra tres veces (copia
 * oscura abajo, copia clara arriba, gradiente encima) para que lea como una pieza
 * recortada. Ver `drawMetalWordmark` y `TEXT_FINISH.wordmark`.
 */
export function drawWordmarkLayer({ card, width }: { card: VtuberCard; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  const pad = 46;
  const { accent } = cardPalette(card.themeColor, card.secondaryColor);
  drawMetalWordmark(ctx, 'VTUBERDEX', W - pad, H - 86, `800 28px ${FONT}`, accent);
  return canvas;
}
