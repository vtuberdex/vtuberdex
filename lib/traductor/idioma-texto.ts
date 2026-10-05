/**
 * ¿En qué idioma está un texto? Solo importa distinguir los tres idiomas de la interfaz, para
 * decidir si ofrecer «Traducir». No es un detector general: lo que no es claramente japonés,
 * inglés o español devuelve `null` y NO se ofrece traducción (mejor callar que traducir mal).
 *
 * Japonés: por escritura (kana/kanji). Inglés vs español: por palabras vacías frecuentes y por
 * signos que solo existen en español (`ñ`, `¿`, `¡`, vocales con tilde).
 */
import type { Locale } from '@/lib/i18n/locales';

const ES = new Set(
  'el la los las un una unos unas de del y o que en es con por para su sus al se lo como más pero sin sobre muy también cuando donde hasta desde entre porque son fue ser tiene tienen está están hay mi me te le les nos soy eres era ya si no'.split(' '),
);
const EN = new Set(
  'the a an and or of to in is are was were be been with for on at by from as it its his her their they he she we you i my your our this that these those but not so very also when where which who what will would can could has have had do does did there than then into about over after'.split(' '),
);

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const LETRA = /\p{L}/gu;

export function idiomaDelTexto(texto: string): Locale | null {
  const t = texto.trim();
  if (t.length < 12) return null;
  const letras = t.match(LETRA)?.length ?? 0;
  if (letras === 0) return null;
  // Kana: ningún otro idioma de la lista lo usa. Con pocos kana el resto es kanji de un texto japonés corto.
  if ((t.match(KANA)?.length ?? 0) / letras > 0.1) return 'ja';

  const palabras = t.toLowerCase().match(/[a-záéíóúüñ']+/g) ?? [];
  if (palabras.length < 3) return null;
  let es = 0;
  let en = 0;
  for (const palabra of palabras) {
    if (ES.has(palabra)) es += 1;
    if (EN.has(palabra)) en += 1;
  }
  const marcasEs = (t.match(/[ñ¿¡áéíóú]/gi)?.length ?? 0) / palabras.length;
  es += marcasEs * palabras.length * 0.5;
  if (es === 0 && en === 0) return null;
  // Margen mínimo: un texto en portugués o francés comparte «de», «la»… con el español y no debe pasar por español.
  if (es > en * 1.3) return 'es';
  if (en > es * 1.3) return 'en';
  return null;
}
