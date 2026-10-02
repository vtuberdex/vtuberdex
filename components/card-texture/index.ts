'use client';
/**
 * Generación de texturas en 7 capas separadas con paralaje propio.
 *
 * El usuario pidió un refactor de capas: 0=fondo 10% más grande, 1=personaje,
 * 2=logo, 3=título, 4=textos, 5=tags, 6=wordmark VTUBERDEX.
 * La estrategia es generar un canvas INDEPENDIENTE por capa, y el shader
 * las mezcla. Así cada capa tiene su propio factor de paralaje.
 *
 * En este paso se deja TODO el texto PLANO (sin metal, sin sombras, sin
 * agujeros en el fondo). Después se añadirán efectos capa por capa de forma
 * limpia.
 */

export { CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT, CARD_TEXTURE_TILE_WIDTH, CARD_TEXTURE_FULL_WIDTH } from './dimensiones';
export type { CardDrawInfo, CardLayers } from './tipos';
export { drawSurfaceLayer } from './capa-superficie';
export { drawCharacterLayer } from './capa-personaje';
export { drawTitleLayer } from './capa-titulo';
export { drawTextsLayer } from './capa-textos';
export { drawTagsLayer } from './capa-tags';
export { drawWordmarkLayer } from './capa-wordmark';
export { drawCardLayers, drawCardFront } from './componer';
export { loadImage } from './imagen';
export { inkAndSkinMask, inkAndSkinMaskAsync, logoMask, logoMaskAsync, logoSticker } from './mascaras';
