// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * CAPA 4 — textos: chips de estado, frase y pie.
 */
import { chipDeNivel } from "./chip-nivel";
import type { VtuberCard } from "@/lib/types";
import { FONT } from "./dimensiones";
import type { CardLayers } from "./tipos";
import { createLayer } from "./lienzo";
import { fillShadowedText } from "./pintura";

type Ctx = CanvasRenderingContext2D;

/** Interlineado de la frase. */
const PHRASE_LINE_HEIGHT = 42;

/** Los chips de estado de la carta: nivel, poder (si lo hay) y si la ficha es completa. */
export function stateChipsFor(card: VtuberCard): string[] {
  return [
    chipDeNivel(card.level),
    card.powerScore ? `PODER ${card.powerScore}` : null,
    card.hasDetail ? "FICHA COMPLETA" : "SOLO FICHA BÁSICA",
  ].filter(Boolean) as string[];
}

/**
 * Chips de estado. SIN placa opaca: el texto lee por la SOMBRA NEGRA, y así el fondo
 * subido se ve a través de la cabecera en vez de quedar tapado por un rectángulo.
 */
function drawStateChips(ctx: Ctx, chips: string[], pad: number, stateY: number) {
  let stateX = pad;
  ctx.font = `700 24px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  for (const chip of chips) {
    const chipW = ctx.measureText(chip).width + 30;
    fillShadowedText(ctx, chip, stateX + 15, stateY + 22, "#e8ecf5", 0.85);
    stateX += chipW + 10;
  }
}

/**
 * Corta la frase en líneas que quepan en `textWidth` (con la fuente ya puesta en `ctx`) y se queda
 * con las primeras `maxLines`; si sobra texto, la última lleva «…».
 */
function wrapPhrase(ctx: Ctx, phrase: string, textWidth: number, maxLines: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const word of phrase.split(" ")) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > textWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) {
    lines.push(current);
  }
  const visible = lines.slice(0, Math.max(1, maxLines));
  if (lines.length > visible.length) {
    visible.push(`${visible.pop()}…`);
  }
  return visible;
}

/**
 * La frase, alineada por abajo en `bottom`. Es el texto blanco más largo de la carta y es el que más se
 * pierde sobre un fondo claro: sombra negra, misma dirección de luz que el pie y el bisel del metal.
 */
function drawPhrase(
  ctx: Ctx,
  card: VtuberCard,
  { pad, textWidth, info }: { pad: number; textWidth: number; info: CardLayers["info"] },
) {
  const phrase = (card.phrase ?? "").replace(/\s+/g, " ").trim();
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 32px ${FONT}`;
  const maxPhraseLines = Math.max(
    1,
    Math.floor((info.phraseBottom - info.typesTop + 22) / PHRASE_LINE_HEIGHT),
  );
  const phraseBottomLimit = info.phraseBottom;
  if (!phrase) {
    fillShadowedText(
      ctx,
      "Sin presentación registrada",
      pad,
      phraseBottomLimit,
      "#e8ecf5",
      0.5,
    );
    return;
  }
  const visible = wrapPhrase(ctx, phrase, textWidth, maxPhraseLines);
  let y = phraseBottomLimit - (visible.length - 1) * PHRASE_LINE_HEIGHT;
  for (const line of visible) {
    fillShadowedText(ctx, line, pad, y, "#e8ecf5", 0.94);
    y += PHRASE_LINE_HEIGHT;
  }
}

/** Pie: cuántas redes (izquierda) y el país (derecha). */
function drawFooter(ctx: Ctx, card: VtuberCard, { pad, W, H }: { pad: number; W: number; H: number }) {
  ctx.font = `600 26px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const socialCount = card.socialCount ?? 0;
  fillShadowedText(
    ctx,
    socialCount > 0 ? `${socialCount} redes enlazadas` : "Sin redes enlazadas",
    pad,
    H - 86,
    "#e8ecf5",
    0.68,
  );

  // País en pie.
  ctx.textAlign = "right";
  ctx.font = `500 22px ${FONT}`;
  fillShadowedText(
    ctx,
    card.countries[0] ? card.countries[0].name : "Sin país",
    W - pad,
    H - 54,
    "#e8ecf5",
    0.5,
  );
}

/** Capa 4: textos — chips de estado, frase, pie. TEXTO PLANO. */
export function drawTextsLayer({
  card,
  width,
  info,
}: {
  card: VtuberCard;
  width: number;
  info: CardLayers["info"];
}): HTMLCanvasElement {
  const { canvas, ctx, W, H } = createLayer(width);
  // Sin contexto 2D la capa queda vacía (transparente): se devuelve igual, el compositor la tolera.
  if (ctx) {
    const pad = info.pad;
    const stateY = info.headerTop + info.headerH + 34;

    ctx.textBaseline = "middle";
    drawStateChips(ctx, stateChipsFor(card), pad, stateY);
    drawPhrase(ctx, card, { pad, textWidth: W - pad * 2, info });
    drawFooter(ctx, card, { pad, W, H });
  }
  return canvas;
}
