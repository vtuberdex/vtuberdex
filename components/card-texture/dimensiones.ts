/**
 * Medidas canónicas del lienzo de la carta y la tipografía del front.
 */


export const CARD_TEXTURE_WIDTH = 1008;

export const CARD_TEXTURE_HEIGHT = 1411;

export const CARD_TEXTURE_TILE_WIDTH = 512;

export const CARD_TEXTURE_FULL_WIDTH = CARD_TEXTURE_WIDTH;

export const FONT = '"Chakra Petch", "Rajdhani", system-ui, sans-serif';

/**
 * Geometría de la PLACA DE CABECERA (número, nombre, país, emblemas), en píxeles del lienzo.
 *
 * Vive aquí y no dentro de `capa-titulo.ts` porque la lee también la config del shader: los
 * emblemas de facción se dibujan en el shader (holograma) PERO su sitio lo decide la placa, que
 * es de la textura. Con las medidas en dos archivos, mover la placa dejaba los emblemas flotando
 * fuera de su engarce sin que ningún gate lo dijera.
 */
export const HEADER = { pad: 46, top: 44, height: 116 } as const;

/**
 * Engarces de los emblemas de facción, alineados a la DERECHA de la cabecera (junto al nombre).
 *
 * `size` es el lado del engarce oscuro que pinta la textura y `margin` lo que se resta a cada lado
 * para el emblema que dibuja el shader. `gap` separa los dos engarces y `inset` los separa del
 * borde derecho de la placa. Son medidas en píxeles del lienzo de 1008 de ancho.
 *
 * `size` pasó de 88 a 100 (y `margin` de 7 a 6): el emblema útil de 74 px a 88 px, un 19 % más
 * grande. A 74 px de 1008 un emblema con detalle mide ~15 px en la grilla y ~25 en la ficha, y
 * era justo lo que no dejaba verlo. La placa mide 116, así que sobran 8 px por lado.
 */
export const FACTION_SOCKET = { size: 100, margin: 6, gap: 10, inset: 12 } as const;

/** Máximo de emblemas en la carta: la regla de negocio es «máximo dos facciones por VTuber». */
export const MAX_FACTION_EMBLEMS = 2;
