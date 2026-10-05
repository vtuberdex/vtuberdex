/** Resolución de textos: pura (sin React ni DOM), para poder probarla y usarla desde cualquier lado. */
import { en } from './en';
import { es, type Mensajes } from './es';
import { ja } from './ja';
import { LOCALE_POR_DEFECTO, type Locale } from './locales';

export const DICCIONARIOS: Record<Locale, Mensajes> = { es, en, ja };

type Sufijo = '_one' | '_other';
/** Las claves tal como se PIDEN: `x_one` / `x_other` se piden como `x`. */
export type Clave = { [K in keyof Mensajes]: K extends `${infer B}${Sufijo}` ? B : K }[keyof Mensajes];
export type Variables = Record<string, string | number>;

const plurales = new Map<Locale, Intl.PluralRules>();
function categoriaPlural(locale: Locale, n: number): 'one' | 'other' {
  let reglas = plurales.get(locale);
  if (!reglas) {
    reglas = new Intl.PluralRules(locale);
    plurales.set(locale, reglas);
  }
  return reglas.select(n) === 'one' ? 'one' : 'other';
}

/**
 * Devuelve el texto de `clave` en `locale`, con `{variable}` sustituidas. Si el idioma no lo
 * tiene cae al español, y si tampoco, a la propia clave: un texto sin traducir se nota, pero no
 * rompe la pantalla.
 */
export function traducir(locale: Locale, clave: Clave, variables?: Variables): string {
  const n = variables && typeof variables.n === 'number' ? variables.n : null;
  const buscar = (idioma: Locale): string | undefined => {
    const dic = DICCIONARIOS[idioma] as Record<string, string>;
    if (n !== null) {
      const plural = dic[`${clave}_${categoriaPlural(idioma, n)}`];
      if (plural !== undefined) return plural;
    }
    return dic[clave];
  };
  const plantilla = buscar(locale) ?? buscar(LOCALE_POR_DEFECTO) ?? clave;
  return variables
    ? plantilla.replace(/\{(\w+)\}/g, (_, nombre: string) => (nombre in variables ? String(variables[nombre]) : `{${nombre}}`))
    : plantilla;
}
