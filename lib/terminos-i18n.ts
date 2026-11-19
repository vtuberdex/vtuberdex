// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Términos y Condiciones por idioma. El texto en ESPAÑOL (`terminos.ts`) es el autoritativo y el
 * versionado (`TERMINOS_VERSION`); en/ja son traducciones de cortesía que lo siguen cláusula por
 * cláusula (mismos `id`, mismo número de párrafos: `terminos-i18n.test.ts`). Se mantienen aparte de
 * `lib/i18n/es.ts` porque son arrays de párrafos, no textos de interfaz.
 */
import type { Locale } from "./i18n/locales";
import {
  CLAUSULAS,
  FECHA_VIGENCIA,
  PREAMBULO,
  type Clausula,
} from "./terminos";

export interface TextosPagina {
  titulo: string;
  /** `{version}` y `{fecha}` se sustituyen al pintar. */
  versionLinea: string;
  /** Aviso de traducción de cortesía; vacío en español. */
  notaTraduccion: string;
  indice: string;
  indiceEtiqueta: string;
  pieAntes: string;
  pieInscripcion: string;
  pieO: string;
  pieBaja: string;
  pieDespues: string;
}

export interface TerminosTraducidos {
  fechaVigencia: string;
  preambulo: string[];
  clausulas: Clausula[];
  textosPagina: TextosPagina;
}

/**
 * Términos ya cargados. El español va siempre (es el texto vinculante y el HTML del servidor); la
 * traducción de cortesía en inglés o japonés se pide solo si se elige ese idioma (`cargarTerminos`).
 * Antes los tres viajaban en el JS de `/terminos` (~37 KB comprimidos) para mostrar uno.
 */
const TERMINOS: Partial<Record<Locale, TerminosTraducidos>> = {
  es: {
    fechaVigencia: FECHA_VIGENCIA,
    preambulo: PREAMBULO,
    clausulas: CLAUSULAS,
    textosPagina: {
      titulo: "Términos y Condiciones",
      versionLinea: "Versión {version} · vigente desde el {fecha}",
      notaTraduccion: "",
      indice: "Índice",
      indiceEtiqueta: "Índice de cláusulas",
      pieAntes: "Al enviar un formulario de",
      pieInscripcion: "inscripción",
      pieO: "o de",
      pieBaja: "baja",
      pieDespues: "aceptas la totalidad de este documento.",
    },
  },
};

const CARGADORES: Record<
  Exclude<Locale, "es">,
  () => Promise<TerminosTraducidos>
> = {
  en: () => import("./terminos-en").then((m) => m.TERMINOS_EN),
  ja: () => import("./terminos-ja").then((m) => m.TERMINOS_JA),
};

/** Los términos en `locale` si ya están cargados; si no, los vinculantes en español. */
export function terminosDe(locale: Locale): TerminosTraducidos {
  return TERMINOS[locale] ?? (TERMINOS.es as TerminosTraducidos);
}

export function terminosCargados(locale: Locale): boolean {
  return TERMINOS[locale] !== undefined;
}

/** Trae la traducción de `locale` si falta (un fallo se puede reintentar). */
export async function cargarTerminos(locale: Locale): Promise<void> {
  if (terminosCargados(locale) || locale === "es") {
    return;
  }
  TERMINOS[locale] = await CARGADORES[locale]();
}
