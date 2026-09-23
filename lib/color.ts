/** Utilidades de color: derivan la paleta holográfica desde el color del dato. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export const FALLBACK_THEME = '#5eead4';

/** '#abc' | 'abc' | '#aabbcc' -> '#aabbcc' (o el fallback si es inválido). */
export function normalizeHex(value: string | null | undefined, fallback = FALLBACK_THEME): string {
  const raw = String(value ?? '').trim().replace('#', '');
  const expanded = raw.length === 3 ? raw.split('').map((char) => char + char).join('') : raw;
  return /^[0-9a-fA-F]{6}$/.test(expanded) ? `#${expanded.toLowerCase()}` : fallback;
}

export function hexToRgb(hex: string): Rgb {
  const value = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(value.slice(0, 2), 16),
    g: Number.parseInt(value.slice(2, 4), 16),
    b: Number.parseInt(value.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: Rgb): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Mezcla lineal hacia otro color (ratio 0..1). */
export function mixHex(hex: string, other: string, ratio: number): string {
  const a = hexToRgb(hex);
  const b = hexToRgb(other);
  return rgbToHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
}

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Luminancia relativa (WCAG) para decidir texto claro u oscuro. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Color de texto legible sobre el fondo dado. */
export function readableInk(hex: string): string {
  return luminance(hex) > 0.55 ? '#0b0d12' : '#f8fafc';
}

/**
 * Paleta holográfica de la carta: acento, secundario y tono de fondo.
 * Si el VTuber no declara color, se usa un cian neutro.
 */
export function cardPalette(themeColor: string | null, secondaryColor: string | null) {
  const accent = normalizeHex(themeColor);
  const secondary = normalizeHex(secondaryColor ?? mixHex(accent, '#a855f7', 0.45));
  return {
    accent,
    secondary,
    /**
     * Tonos oscuros derivados del color PRIMARIO del VTuber.
     *
     * `deep` se mezclaba con negro al 82% y quedaba prácticamente negro: el fondo
     * de la carta perdía la identidad del personaje. Se calibró bajando a 0.68
     * (claro), 0.78 (intermedio) y finalmente 0.86, que es el fondo buscado: oscuro
     * de verdad pero conservando el matiz del primario en vez de un gris neutro.
     * `mid` mantiene la relación entre ambos tonos.
     */
    deep: mixHex(accent, '#05060a', 0.86),
    mid: mixHex(accent, '#05060a', 0.64),
    sheen: mixHex(accent, '#ffffff', 0.55),
    ink: readableInk(mixHex(accent, '#05060a', 0.72)),
  };
}

/** Gradiente CSS reutilizable (cabeceras, chips, bordes). */
export function gradientCss(accent: string, secondary: string, angle = 135): string {
  return `linear-gradient(${angle}deg, ${accent} 0%, ${secondary} 100%)`;
}
