/**
 * CAPA 3 — cabecera: número de dex, nombre, país.
 */
import type { VtuberCard } from '@/lib/types';
import { cardPalette, rgba } from '@/lib/color';
import { TEXT_FINISH } from '../card3d-config';
import { FACTION_SOCKET, FONT, HEADER } from './dimensiones';
import { anchoDeEngarces, iconosDeFaccion } from './facciones';
import { createLayer } from './lienzo';
import { roundRect, fitText, metalFill, metalSheen, metalBevel, drawEngrave } from './pintura';

/** Capa 3: título — cabecera, número de dex, nombre y país. TEXTO PLANO. */
export function drawTitleLayer({ card, width }: { card: VtuberCard; width: number }): HTMLCanvasElement {
  const { canvas, ctx, W } = createLayer(width);
  if (!ctx) return canvas;
  const { pad, top: headerTop, height: headerH } = HEADER;
  const headerW = W - pad * 2;
  const headerRadius = 22;

  /**
   * PLACA METÁLICA de cabecera.
   *
   * Antes era una placa TRANSLÚCIDA del color de marca (acento 0.95 -> secundario 0.75).
   * El cambio NO es solo de color: el perfil de paradas y el bisel son lo que la hacen
   * leer como una lámina con espesor. Ver TEXT_FINISH para la técnica y por qué el metal
   * va teñido del color de marca (por encima de ~0.5 de tinte deja de leerse como acero).
   */
  const { accent } = cardPalette(card.themeColor, card.secondaryColor);
  ctx.fillStyle = metalFill(ctx, pad, headerTop, headerW, headerH, TEXT_FINISH.metalStops, accent, TEXT_FINISH.brandTint);
  roundRect(ctx, pad, headerTop, headerW, headerH, headerRadius);
  ctx.fill();
  metalSheen(ctx, pad, headerTop, headerW, headerH);
  metalBevel(ctx, pad, headerTop, headerW, headerH, headerRadius);

  // Número de dex: placa propia, de acero más oscuro, para que el `#002` se lea como una
  // pieza distinta y no como parte del mismo bloque.
  const badge = `#${String(card.dexNumber).padStart(3, '0')}`;
  const badgeX = pad + 16;
  const badgeY = headerTop + 21;
  const badgeW = 168;
  const badgeH = 74;
  const badgeRadius = 16;
  ctx.fillStyle = metalFill(ctx, badgeX, badgeY, badgeW, badgeH, TEXT_FINISH.badgeStops, accent, TEXT_FINISH.brandTint);
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeRadius);
  ctx.fill();
  metalSheen(ctx, badgeX, badgeY, badgeW, badgeH);
  metalBevel(ctx, badgeX, badgeY, badgeW, badgeH, badgeRadius);

  const badgeFont = `800 44px ${FONT}`;
  /**
   * El número va en BLANCO (petición del usuario).
   *
   * Antes era casi negro (#0a0c11) sobre la placa de acero del badge. Al pasar a blanco, el
   * grabado que llevaba debajo queda inútil: es una sombra blanca al 42% pensada para hundir
   * una letra oscura en el metal, y sobre texto blanco no se ve —o peor, lo engorda. Se
   * conserva pero como un CONTORNO OSCURO, que es lo que hace legible una letra blanca
   * sobre una placa clara: el mismo problema que resolvió `fillShadowedText` en el resto de
   * la carta.
   */
  drawEngrave(ctx, badge, pad + 100, headerTop + 59, badgeFont, 'center');
  ctx.font = badgeFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = TEXT_FINISH.badgeOutlineWidth;
  ctx.strokeStyle = rgba(TEXT_FINISH.badgeOutlineColor, TEXT_FINISH.badgeOutlineAlpha);
  ctx.strokeText(badge, pad + 100, headerTop + 59);
  ctx.fillStyle = TEXT_FINISH.badgeColor;
  ctx.fillText(badge, pad + 100, headerTop + 59);

  /**
   * ENGARCES DE LAS FACCIONES, a la derecha del nombre.
   *
   * Aquí solo se pinta el ENGARCE (acero oscuro con bisel): el emblema es un holograma y lo dibuja
   * el shader encima, en la misma posición (`FACTION.slots`, que sale de esta misma geometría).
   * Con una sola facción el engarce ocupa el sitio de la derecha, igual que el emblema.
   *
   * El engarce es oscuro a propósito. Sobre la placa clara teñida del color de marca, un emblema
   * de luz se perdía —sobre todo en cartas rojas— y sobre una placa ya oscura tampoco destacaba:
   * con el fondo propio, el holograma se lee igual con cualquier color de marca.
   */
  const emblemas = iconosDeFaccion(card).length;
  const socketY = headerTop + (headerH - FACTION_SOCKET.size) / 2;
  const socketRight = W - pad - FACTION_SOCKET.inset;
  for (let i = 0; i < emblemas; i += 1) {
    // El último engarce va pegado a la derecha; los anteriores, a su izquierda.
    const socketX = socketRight - FACTION_SOCKET.size - (emblemas - 1 - i) * (FACTION_SOCKET.size + FACTION_SOCKET.gap);
    ctx.fillStyle = metalFill(ctx, socketX, socketY, FACTION_SOCKET.size, FACTION_SOCKET.size, TEXT_FINISH.emblemSocketStops, accent, TEXT_FINISH.brandTint * 0.4);
    roundRect(ctx, socketX, socketY, FACTION_SOCKET.size, FACTION_SOCKET.size, 18);
    ctx.fill();
    metalBevel(ctx, socketX, socketY, FACTION_SOCKET.size, FACTION_SOCKET.size, 18);
  }
  // Ancho que ocupan los engarces, con el hueco que los separa del país/nombre.
  const emblemsWidth = anchoDeEngarces(emblemas, FACTION_SOCKET.size, FACTION_SOCKET.gap, FACTION_SOCKET.inset + 12);

  // Nombre: reserva el ancho del país Y de los engarces para que nunca se solapen.
  const primary = card.countries[0];
  /**
   * Con emblemas, el país se reduce a su BANDERA: el nombre del país ya va impreso en el pie de la
   * carta (`capa-textos.ts`), y en la cabecera el sitio lo necesitan los emblemas. Con el nombre
   * completo, el del VTuber se encogía hasta la mitad de su tamaño. Sin facciones no cambia nada.
   */
  const countryLabel = primary
    ? emblemas > 0
      ? (primary.flag ?? '').trim()
      : `${primary.flag ?? ''} ${primary.name}`.trim()
    : '';
  ctx.font = `600 34px ${FONT}`;
  const countryWidth = countryLabel ? ctx.measureText(countryLabel).width + 28 : 0;
  const nameMax = W - pad * 2 - 232 - countryWidth - emblemsWidth;
  ctx.textAlign = 'left';
  const nameSize = fitText(ctx, card.name.toUpperCase(), nameMax, 58, '800');
  const nameFont = `800 ${nameSize}px ${FONT}`;
  // Grabado: el nombre va hundido en el metal, no impreso encima.
  drawEngrave(ctx, card.name.toUpperCase(), pad + 212, headerTop + 59, nameFont, 'left');
  ctx.font = nameFont;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#0a0c11';
  ctx.fillText(card.name.toUpperCase(), pad + 212, headerTop + 59);

  // País.
  if (primary) {
    ctx.textAlign = 'right';
    ctx.font = `600 34px ${FONT}`;
    ctx.fillStyle = rgba('#05060a', 0.78);
    // El país se corre a la izquierda de los engarces, no debajo de ellos.
    ctx.fillText(countryLabel, W - pad - 18 - emblemsWidth, headerTop + 59);
  }

  return canvas;
}
