/**
 * Términos y Condiciones por idioma. El texto en ESPAÑOL (`terminos.ts`) es el autoritativo y el
 * versionado (`TERMINOS_VERSION`); en/ja son traducciones de cortesía que lo siguen cláusula por
 * cláusula (mismos `id`, mismo número de párrafos: `terminos-i18n.test.ts`). Se mantienen aparte de
 * `lib/i18n/es.ts` porque son arrays de párrafos, no textos de interfaz.
 */
import type { Locale } from './i18n/locales';
import { CLAUSULAS_EN, PREAMBULO_EN } from './terminos-en';
import { CLAUSULAS_JA, PREAMBULO_JA } from './terminos-ja';
import { CLAUSULAS, FECHA_VIGENCIA, PREAMBULO, type Clausula } from './terminos';

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

const TERMINOS: Record<Locale, TerminosTraducidos> = {
  es: {
    fechaVigencia: FECHA_VIGENCIA,
    preambulo: PREAMBULO,
    clausulas: CLAUSULAS,
    textosPagina: {
      titulo: 'Términos y Condiciones',
      versionLinea: 'Versión {version} · vigente desde el {fecha}',
      notaTraduccion: '',
      indice: 'Índice',
      indiceEtiqueta: 'Índice de cláusulas',
      pieAntes: 'Al enviar un formulario de',
      pieInscripcion: 'inscripción',
      pieO: 'o de',
      pieBaja: 'baja',
      pieDespues: 'aceptas la totalidad de este documento.',
    },
  },
  en: {
    fechaVigencia: 'October 6, 2026',
    preambulo: PREAMBULO_EN,
    clausulas: CLAUSULAS_EN,
    textosPagina: {
      titulo: 'Terms and Conditions',
      versionLinea: 'Version {version} · in force since {fecha}',
      notaTraduccion:
        'Courtesy translation. The Spanish version is the only legally binding text and prevails in case of any discrepancy.',
      indice: 'Contents',
      indiceEtiqueta: 'Table of clauses',
      pieAntes: 'By submitting a',
      pieInscripcion: 'registration',
      pieO: 'or a',
      pieBaja: 'removal',
      pieDespues: 'form you accept this entire document.',
    },
  },
  ja: {
    fechaVigencia: '2026年10月6日',
    preambulo: PREAMBULO_JA,
    clausulas: CLAUSULAS_JA,
    textosPagina: {
      titulo: '利用規約',
      versionLinea: 'バージョン {version} · {fecha}より有効',
      notaTraduccion: 'これは参考訳です。法的に有効なのはスペイン語版のみで、内容に食い違いがある場合はスペイン語版が優先します。',
      indice: '目次',
      indiceEtiqueta: '条項の目次',
      pieAntes: '',
      pieInscripcion: '登録',
      pieO: 'または',
      pieBaja: '退会',
      pieDespues: 'フォームを送信することで、この文書の全体に同意したものとみなされます。',
    },
  },
};

export function terminosDe(locale: Locale): TerminosTraducidos {
  return TERMINOS[locale] ?? TERMINOS.es;
}
