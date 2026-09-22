/**
 * Constantes de la banda donde vive el logo dentro de la carta.
 * Viven en su propio módulo para que `extract-logo2.mjs` y `logo-edges.mjs`
 * puedan usarlas sin importarse circularmente.
 */

/**
 * Banda de búsqueda, derivada de la calibración contra las cartas cuyo logo
 * conocemos. x0≈0.48 del ancho y el logo ocupa ~0.38 del ancho; se deja margen
 * por ambos lados y se extiende hacia abajo porque hay logos más altos.
 */
export const BAND = { x0: 0.42, y0: 0.02, x1: 0.99, y1: 0.70 };

/**
 * Zona EXCLUIDA: el número de dex (`#NNN`) va siempre en la esquina superior
 * derecha de la carta y no forma parte del logo.
 */
export const BADGE = { x0: 0.80, y0: 0.0, x1: 1.0, y1: 0.17 };

/** Umbral de saturación por encima del cual un píxel se considera "logo". */
export const MIN_SAT = 45;
/** Umbral de brillo para logos blancos sobre fondo oscuro. */
export const MIN_VAL = 200;
/** Umbral de oscuridad para cartas de fondo claro (logo oscuro). */
export const MAX_DARK = 70;
