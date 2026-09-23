/**
 * CAPA 4 — textos: chips de estado, frase y pie.
 */
import type { VtuberCard } from '@/lib/types';
import { FONT } from './dimensiones';
import type { CardLayers } from './tipos';
import { createLayer } from './lienzo';
import { fillShadowedText } from './pintura';

/** Capa 4: textos — chips de estado, frase, pie. TEXTO PLANO. */
export function drawTextsLayer({ card, width, info }: { card: VtuberCard; width: number; info: CardLayers['info'] }): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  if (!ctx) return canvas;
  const pad = info.pad;
  const stateY = info.headerTop + info.headerH + 34;

  ctx.textBaseline = 'middle';

  // Chips de estado. SIN placa opaca: el texto lee por la SOMBRA NEGRA, y así el fondo
  // subido se ve a través de la cabecera en vez de quedar tapado por un rectángulo.
  const stateChips = [
    card.level !== null ? `NIV ${card.level}` : null,
    card.powerScore ? `PODER ${card.powerScore}` : null,
    card.hasDetail ? 'FICHA COMPLETA' : 'SOLO FICHA BÁSICA',
  ].filter(Boolean) as string[];
  let stateX = pad;
  ctx.font = `700 24px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const chip of stateChips) {
    const chipW = ctx.measureText(chip).width + 30;
    fillShadowedText(ctx, chip, stateX + 15, stateY + 22, '#e8ecf5', 0.85);
    stateX += chipW + 10;
  }

  // Frase.
  const textWidth = W - pad * 2;
  const phrase = (card.phrase ?? '').replace(/\s+/g, ' ').trim();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 32px ${FONT}`;
  const lineHeight = 42;
  const maxPhraseLines = Math.max(1, Math.floor((info.phraseBottom - info.typesTop + 22) / lineHeight));
  const phraseBottomLimit = info.phraseBottom;
  // La frase es el texto blanco más largo de la carta y es el que más se pierde sobre un
  // fondo claro: sombra negra, misma dirección de luz que el pie y el bisel del metal.
  if (phrase) {
    const words = phrase.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > textWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    const visible = lines.slice(0, Math.max(1, maxPhraseLines));
    if (lines.length > visible.length) visible[visible.length - 1] = `${visible[visible.length - 1]}…`;
    const total = visible.length;
    let y = phraseBottomLimit - (total - 1) * lineHeight;
    for (const line of visible) {
      fillShadowedText(ctx, line, pad, y, '#e8ecf5', 0.94);
      y += lineHeight;
    }
  } else {
    fillShadowedText(ctx, 'Sin presentación registrada', pad, phraseBottomLimit, '#e8ecf5', 0.5);
  }

  // Pie: redes.
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const socialCount = card.socialCount ?? 0;
  fillShadowedText(
    ctx,
    socialCount > 0 ? `${socialCount} redes enlazadas` : 'Sin redes enlazadas',
    pad,
    H - 86,
    '#e8ecf5',
    0.68,
  );

  // País en pie.
  ctx.textAlign = 'right';
  ctx.font = `500 22px ${FONT}`;
  fillShadowedText(ctx, card.countries[0] ? card.countries[0].name : 'Sin país', W - pad, H - 54, '#e8ecf5', 0.5);

  return canvas;
}
