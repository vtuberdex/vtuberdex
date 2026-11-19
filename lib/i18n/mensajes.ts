// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/** Resolución de textos: pura (sin React ni DOM), para poder probarla y usarla desde cualquier lado. */
import { es, type Mensajes } from "./es";
import { LOCALE_POR_DEFECTO, type Locale } from "./locales";

/**
 * Diccionarios YA cargados. El español va siempre (es el HTML del servidor y el idioma por defecto);
 * inglés y japonés se piden la primera vez que se eligen (`cargarDiccionario`).
 *
 * POR QUÉ: los tres idiomas viajaban en el JS de TODAS las páginas (~41 KB comprimidos, medido con
 * `next analyze` el 2026-11-19) y la gran mayoría de las visitas no cambia nunca del español. Mientras
 * llega el elegido se sigue viendo el idioma anterior (ver `I18nProvider`), nunca una mezcla.
 */
const DICCIONARIOS: Partial<Record<Locale, Mensajes>> = { es };

const CARGADORES: Record<Exclude<Locale, "es">, () => Promise<Mensajes>> = {
  en: () => import("./en").then((m) => m.en),
  ja: () => import("./ja").then((m) => m.ja),
};
const enVuelo = new Map<Locale, Promise<void>>();

export function diccionarioCargado(locale: Locale): boolean {
  return DICCIONARIOS[locale] !== undefined;
}

/** Deja un diccionario disponible sin pedirlo (las pruebas precargan los tres en `test/setup.ts`). */
export function registrarDiccionario(locale: Locale, mensajes: Mensajes): void {
  DICCIONARIOS[locale] = mensajes;
}

/** Trae el diccionario de `locale` si falta. Las peticiones en vuelo se comparten; un fallo se puede reintentar. */
export function cargarDiccionario(locale: Locale): Promise<void> {
  if (diccionarioCargado(locale) || locale === "es") {
    return Promise.resolve();
  }
  let pendiente = enVuelo.get(locale);
  if (!pendiente) {
    pendiente = CARGADORES[locale]()
      .then((mensajes) => registrarDiccionario(locale, mensajes))
      .finally(() => enVuelo.delete(locale));
    enVuelo.set(locale, pendiente);
  }
  return pendiente;
}

type Sufijo = "_one" | "_other";
/** Las claves tal como se PIDEN: `x_one` / `x_other` se piden como `x`. */
export type Clave = {
  [K in keyof Mensajes]: K extends `${infer B}${Sufijo}` ? B : K;
}[keyof Mensajes];
export type Variables = Record<string, string | number>;

const plurales = new Map<Locale, Intl.PluralRules>();
function categoriaPlural(locale: Locale, n: number): "one" | "other" {
  let reglas = plurales.get(locale);
  if (!reglas) {
    reglas = new Intl.PluralRules(locale);
    plurales.set(locale, reglas);
  }
  return reglas.select(n) === "one" ? "one" : "other";
}

/**
 * Devuelve el texto de `clave` en `locale`, con `{variable}` sustituidas. Si el idioma no lo
 * tiene cae al español, y si tampoco, a la propia clave: un texto sin traducir se nota, pero no
 * rompe la pantalla.
 */
export function traducir(
  locale: Locale,
  clave: Clave,
  variables?: Variables,
): string {
  const n = variables && typeof variables.n === "number" ? variables.n : null;
  const buscar = (idioma: Locale): string | undefined => {
    const dic = DICCIONARIOS[idioma] as Record<string, string> | undefined;
    if (!dic) {
      return undefined;
    }
    if (n !== null) {
      const plural = dic[`${clave}_${categoriaPlural(idioma, n)}`];
      if (plural !== undefined) {
        return plural;
      }
    }
    return dic[clave];
  };
  const plantilla = buscar(locale) ?? buscar(LOCALE_POR_DEFECTO) ?? clave;
  return variables
    ? plantilla.replace(/\{(\w+)\}/g, (_, nombre: string) =>
        nombre in variables ? String(variables[nombre]) : `{${nombre}}`,
      )
    : plantilla;
}
