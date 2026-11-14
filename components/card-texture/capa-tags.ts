// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * CAPA 5 — tags, facciones, grupos y la barra de stats.
 */
import type { VtuberCard } from "@/lib/types";
import { cardPalette, mixHex, rgba } from "@/lib/color";
import { FONT } from "./dimensiones";
import type { CardLayers } from "./tipos";
import { createLayer } from "./lienzo";
import { roundRect } from "./pintura";

type Ctx = CanvasRenderingContext2D;

const CHIP_FONT = `700 24px ${FONT}`;
/** Relleno horizontal del texto dentro del chip (16 a cada lado). */
const CHIP_PAD = 32;
/** Separación entre chips de una misma fila. */
const CHIP_GAP = 12;
export const CHIP_ROW_HEIGHT = 54;

/** La barra de stats: un fondo translúcido y un segmento por stat, con la paleta de la carta. */
function drawStatsBar(
  ctx: Ctx,
  { pad, barY, barW }: { pad: number; barY: number; barW: number },
  segments: number[],
  palette: string[],
) {
  const barH = 16;
  let bx = pad;
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  roundRect(ctx, pad, barY, barW, barH, 8);
  ctx.fill();
  const total = segments.reduce((sum, value) => sum + value, 0) || 1;
  segments.forEach((value, index) => {
    const w = (value / total) * barW;
    ctx.fillStyle = palette[index % palette.length];
    roundRect(ctx, bx, barY, Math.max(w - 4, 6), barH, 8);
    ctx.fill();
    bx += w;
  });
}

/** Reparte los rótulos en filas que quepan en `maxWidth` (mide con la fuente del chip). */
export function chipRowsFor(ctx: Ctx, typesList: string[], maxWidth: number): string[][] {
  const chipRows: string[][] = [];
  ctx.save();
  ctx.font = CHIP_FONT;
  for (const type of typesList) {
    const label = type.toUpperCase().slice(0, 22);
    const tw = ctx.measureText(label).width + CHIP_PAD;
    const row = chipRows.at(-1);
    const used = row
      ? row.reduce(
          (sum, item) => sum + ctx.measureText(item).width + CHIP_PAD + CHIP_GAP,
          0,
        )
      : 0;
    if (row && used + tw <= maxWidth) {
      row.push(label);
    } else {
      chipRows.push([label]);
    }
  }
  ctx.restore();
  return chipRows;
}

/** Pinta las filas de chips desde `top`: placa con el degradado de la carta y el rótulo oscuro encima. */
function drawChipRows(
  ctx: Ctx,
  chipRows: string[][],
  { pad, top, accent, secondary }: { pad: number; top: number; accent: string; secondary: string },
) {
  let ty = top;
  for (const row of chipRows) {
    let tx = pad;
    ctx.font = CHIP_FONT;
    ctx.textBaseline = "middle";
    for (const label of row) {
      const tw = ctx.measureText(label).width + CHIP_PAD;
      const typeGradient = ctx.createLinearGradient(tx, 0, tx + tw, 0);
      typeGradient.addColorStop(0, rgba(accent, 0.92));
      typeGradient.addColorStop(1, rgba(secondary, 0.85));
      ctx.fillStyle = typeGradient;
      roundRect(ctx, tx, ty, tw, 42, 21);
      ctx.fill();
      // El rótulo del chip es texto oscuro sobre placa clara: aquí la sombra negra no
      // ayuda (oscurecería un texto ya oscuro), así que se deja plano y legible.
      ctx.fillStyle = "#080a10";
      ctx.fillText(label, tx + 16, ty + 23);
      tx += tw + CHIP_GAP;
    }
    ty += CHIP_ROW_HEIGHT;
  }
}

/** Capa 5: tags / facciones / grupos + barra de stats. TEXTO PLANO. */
export function drawTagsLayer({
  card,
  width,
  info,
}: {
  card: VtuberCard;
  width: number;
  info: CardLayers["info"];
}): HTMLCanvasElement {
  const { canvas, ctx, W } = createLayer(width);
  if (!ctx) {
    return canvas;
  }
  const { accent, secondary } = cardPalette(
    card.themeColor,
    card.secondaryColor,
  );
  const pad = info.pad;
  const typesList = [...card.factions, ...card.groups].slice(0, 4);

  // Barra de stats.
  const palette = [
    accent,
    secondary,
    mixHex(accent, "#ffffff", 0.4),
    mixHex(secondary, "#ffffff", 0.3),
  ];
  drawStatsBar(
    ctx,
    { pad, barY: info.barY, barW: W - pad * 2 },
    card.statsPreview ?? [],
    palette,
  );

  // Chips de tipos.
  if (typesList.length > 0) {
    const chipRows = chipRowsFor(ctx, typesList, W - pad * 2);
    drawChipRows(ctx, chipRows, { pad, top: info.typesTop, accent, secondary });
  }

  return canvas;
}
