/**
 * Guion de la voz de una ficha: QUÉ se dice y CUÁNDO no se dice nada.
 *
 * Pura (sin Node ni DOM) para probarla sin Piper: la usan el generador del lote
 * (`scripts/voces-generar.mjs`) y sus pruebas. El guion es «Nombre. País. Historia.».
 *
 * Reglas que salieron de mirar las 785 fichas, no de suponerlas:
 *   · La voz es española. Un texto en inglés, japonés o ruso leído con ella sale ininteligible,
 *     así que esas fichas NO tienen voz (y sin clip el botón no se muestra).
 *   · Sin historia no hay nada que contar: tampoco se genera (3 fichas).
 *   · La historia más larga mide ~2.000 caracteres (casi un minuto): se corta en una frase
 *     completa para que el aparato no se alargue ni termine a media palabra.
 *   · Las cartas de baja (grado 1) no tienen página pública y su nombre es secreto: jamás se
 *     lee, ni se genera audio con él.
 */

/** Tope de la historia, en caracteres (~45 s de voz). */
export const MAX_HISTORIA = 700;

const PALABRAS_ES = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'para', 'se', 'su', 'al', 'lo', 'como', 'más', 'pero', 'mi', 'soy', 'estoy', 'me', 'te', 'este', 'esta']);
const PALABRAS_EN = new Set(['the', 'and', 'is', 'of', 'to', 'in', 'a', 'that', 'it', 'with', 'for', 'as', 'on', 'was', 'are', 'my', 'i', 'am', 'you', 'this', 'from', 'her', 'his', 'be', 'at']);

/** Quita lo que una voz no sabe leer: enlaces, emojis, marcas de formato y espacios de más. */
export function limpiarTexto(texto) {
  // NFKC: las «letras matemáticas» de Unicode (𝑷𝒉𝒊𝒍𝒖𝒇𝒇𝒚, 𝗚𝗜𝗙𝗧𝗦) que usan algunos nombres pasan a letras
  // normales; sin esto la voz las lee como símbolos o las salta.
  return String(texto ?? '')
    .normalize('NFKC')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\p{Extended_Pictographic}/gu, ' ')
    .replace(/\u200d|\ufe0f/g, '')
    .replace(/[*_`~#>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 'es' si el texto parece español (o no se puede saber); 'otro' si es otro idioma/escritura. */
export function idiomaProbable(texto) {
  const t = limpiarTexto(texto);
  const letras = [...t].filter((c) => /\p{L}/u.test(c));
  if (letras.length === 0) return 'es';
  const ajenas = letras.filter((c) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(c)).length;
  if (ajenas / letras.length > 0.2) return 'otro';
  const palabras = t.toLowerCase().match(/[a-záéíóúüñ']+/g) ?? [];
  let es = 0;
  let en = 0;
  for (const p of palabras) {
    if (PALABRAS_ES.has(p)) es += 1;
    if (PALABRAS_EN.has(p)) en += 1;
  }
  return en > es ? 'otro' : 'es';
}

/** Corta en el último final de frase que quepa; si no hay, en la última palabra. */
export function recortarHistoria(texto, max = MAX_HISTORIA) {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const fin = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('! '), corte.lastIndexOf('? '));
  if (fin >= max * 0.4) return corte.slice(0, fin + 1).trim();
  const palabra = corte.lastIndexOf(' ');
  return `${corte.slice(0, palabra > 0 ? palabra : max).trim().replace(/[,;:]$/, '')}.`;
}

function conPunto(texto) {
  return /[.!?…]$/.test(texto) ? texto : `${texto}.`;
}

/**
 * @param {{ name?: string, slug?: string, countries?: Array<{ name?: string }>, cardText?: string|null }} ficha
 * @returns {{ texto: string, motivo: null } | { texto: null, motivo: 'deteriorada'|'sin_nombre'|'sin_historia'|'idioma' }}
 */
export function guionDeFicha(ficha) {
  if (!ficha || /^deteriorada-/.test(String(ficha.slug ?? ''))) return { texto: null, motivo: 'deteriorada' };
  const nombre = limpiarTexto(ficha.name);
  if (!nombre) return { texto: null, motivo: 'sin_nombre' };
  const historia = limpiarTexto(ficha.cardText);
  if (!historia) return { texto: null, motivo: 'sin_historia' };
  if (idiomaProbable(historia) !== 'es') return { texto: null, motivo: 'idioma' };

  const pais = limpiarTexto(ficha.countries?.[0]?.name);
  const partes = [conPunto(nombre)];
  if (pais) partes.push(conPunto(pais));
  partes.push(conPunto(recortarHistoria(historia)));
  return { texto: partes.join(' '), motivo: null };
}
