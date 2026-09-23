/**
 * CAPA 5 — tags, facciones, grupos y la barra de stats.
 */
import type { VtuberCard } from '@/lib/types';
import { cardPalette, mixHex, rgba } from '@/lib/color';
import { FONT } from './dimensiones';
import type { CardLayers } from './tipos';
import { createLayer } from './lienzo';
import { roundRect } from './pintura';

/** Capa 5: tags / facciones / grupos + barra de stats. TEXTO PLANO. */
export function drawTagsLayer({ card, width, info }: { card: VtuberCard; width: number; info: CardLayers['info'] }): HTMLCanvasElement {
  const { canvas, ctx, W } = createLayer(width);
  if (!ctx) return canvas;
  const { accent, secondary } = cardPalette(card.themeColor, card.secondaryColor);
  const pad = info.pad;
  const typesList = [...card.factions, ...card.groups].slice(0, 4);

  // Barra de stats.
  const barY = info.barY;
  const barH = 16;
  const segments = card.statsPreview ?? [];
  let bx = pad;
  const barW = W - pad * 2;
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, pad, barY, barW, barH, 8);
  ctx.fill();
  const palette = [accent, secondary, mixHex(accent, '#ffffff', 0.4), mixHex(secondary, '#ffffff', 0.3)];
  const total = segments.reduce((sum, value) => sum + value, 0) || 1;
  segments.forEach((value, index) => {
    const w = (value / total) * barW;
    ctx.fillStyle = palette[index % palette.length];
    roundRect(ctx, bx, barY, Math.max(w - 4, 6), barH, 8);
    ctx.fill();
    bx += w;
  });

  // Chips de tipos.
  if (typesList.length > 0) {
    const chipFont = `700 24px ${FONT}`;
    const rowHeight = 54;
    const chipRows: string[][] = [];
    ctx.save();
    ctx.font = chipFont;
    for (const type of typesList) {
      const label = type.toUpperCase().slice(0, 22);
      const tw = ctx.measureText(label).width + 32;
      const row = chipRows[chipRows.length - 1];
      const used = row ? row.reduce((sum, item) => sum + ctx.measureText(item).width + 32 + 12, 0) : 0;
      if (row && used + tw <= W - pad * 2) row.push(label);
      else chipRows.push([label]);
    }
    ctx.restore();

    let ty = info.typesTop;
    for (const row of chipRows) {
      let tx = pad;
      ctx.font = chipFont;
      ctx.textBaseline = 'middle';
      for (const label of row) {
        const tw = ctx.measureText(label).width + 32;
        const typeGradient = ctx.createLinearGradient(tx, 0, tx + tw, 0);
        typeGradient.addColorStop(0, rgba(accent, 0.92));
        typeGradient.addColorStop(1, rgba(secondary, 0.85));
        ctx.fillStyle = typeGradient;
        roundRect(ctx, tx, ty, tw, 42, 21);
        ctx.fill();
        // El rótulo del chip es texto oscuro sobre placa clara: aquí la sombra negra no
        // ayuda (oscurecería un texto ya oscuro), así que se deja plano y legible.
        ctx.fillStyle = '#080a10';
        ctx.fillText(label, tx + 16, ty + 23);
        tx += tw + 12;
      }
      ty += rowHeight;
    }
  }

  return canvas;
}
