/**
 * Idiomas de la interfaz y cómo se elige uno.
 *
 * Reglas (el orden importa):
 *   1. La elección guardada del visitante (el selector de la cabecera) manda siempre.
 *   2. Si nunca eligió, el primer idioma de `navigator.languages` que soportemos
 *      (`en-GB` → `en`, `ja-JP` → `ja`).
 *   3. Si ninguno se soporta (francés, alemán…), español: es el idioma del proyecto.
 *
 * No hay prefijo de idioma en la URL: la URL es el estado de la BÚSQUEDA (regla 6 del repo) y
 * los enlaces compartidos no deben cambiar de catálogo según quién los abra. El HTML que sale
 * del servidor es siempre español (lo que indexan los buscadores); el idioma se aplica al
 * hidratar. Por eso no se lee `Accept-Language` en el servidor: obligaría a que la home deje
 * de ser estática.
 */
export const LOCALES = ['es', 'en', 'ja'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_POR_DEFECTO: Locale = 'es';

/** Clave de `localStorage` con la elección explícita del visitante. */
export const CLAVE_IDIOMA = 'vtuberdex:idioma';

/** Cómo se llama cada idioma EN SÍ MISMO: quien lo busca no lee el idioma actual. */
export const NOMBRE_PROPIO: Record<Locale, string> = { es: 'Español', en: 'English', ja: '日本語' };

/** Código BCP 47 para `Intl` y para `<html lang>`. */
export const BCP47: Record<Locale, string> = { es: 'es', en: 'en', ja: 'ja' };

export function esLocale(valor: unknown): valor is Locale {
  return typeof valor === 'string' && (LOCALES as readonly string[]).includes(valor);
}

/** `en-GB` → `en`; `ja_JP` → `ja`; lo que no es un idioma soportado → `null`. */
export function localeDeEtiqueta(etiqueta: string): Locale | null {
  const base = etiqueta.trim().toLowerCase().split(/[-_]/)[0];
  return esLocale(base) ? base : null;
}

/** Aplica las tres reglas de arriba. Pura: recibe lo guardado y las preferencias del navegador. */
export function elegirLocale(guardado: string | null | undefined, preferidos: readonly string[] = []): Locale {
  if (esLocale(guardado)) return guardado;
  for (const etiqueta of preferidos) {
    const locale = localeDeEtiqueta(etiqueta);
    if (locale) return locale;
  }
  return LOCALE_POR_DEFECTO;
}
