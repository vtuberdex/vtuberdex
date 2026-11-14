// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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

const PALABRAS_ES = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "que",
  "y",
  "en",
  "un",
  "una",
  "es",
  "por",
  "con",
  "para",
  "se",
  "su",
  "al",
  "lo",
  "como",
  "más",
  "pero",
  "mi",
  "soy",
  "estoy",
  "me",
  "te",
  "este",
  "esta",
]);
const PALABRAS_EN = new Set([
  "the",
  "and",
  "is",
  "of",
  "to",
  "in",
  "a",
  "that",
  "it",
  "with",
  "for",
  "as",
  "on",
  "was",
  "are",
  "my",
  "i",
  "am",
  "you",
  "this",
  "from",
  "her",
  "his",
  "be",
  "at",
]);

/** Quita lo que una voz no sabe leer: enlaces, emojis, marcas de formato y espacios de más. */
export function limpiarTexto(texto) {
  // NFKC: las «letras matemáticas» de Unicode (𝑷𝒉𝒊𝒍𝒖𝒇𝒇𝒚, 𝗚𝗜𝗙𝗧𝗦) que usan algunos nombres pasan a letras
  // normales; sin esto la voz las lee como símbolos o las salta.
  return String(texto ?? "")
    .normalize("NFKC")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    // Unión de emojis y selector de variante: sueltos, sin clase de caracteres (eslint la toma por un
    // carácter combinado).
    .replaceAll("\u200d", "")
    .replaceAll("\ufe0f", "")
    .replace(/[*_`~#>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Quita la cortesía de un chatbot que alguien pegó junto con su historia («¡Hola, Paima! Aquí tienes la
 * versión corregida y pulida de tu presentación…:»). La voz lo leía como parte del relato. Solo se toca el
 * INICIO, hasta los primeros dos puntos, y solo si ese tramo promete entregar un texto (aquí tienes / te dejo
 * + versión, texto, presentación…): un «aquí estamos» o «por supuesto» dentro de una historia real no coincide.
 */
export function quitarPreambuloDeIA(texto) {
  // Ni el saludo, ni la entrega, ni lo que promete entregar admiten «:», así que si hay preámbulo acaba
  // SIEMPRE en los primeros dos puntos (más los blancos de detrás). Basta con decidir si el tramo de
  // antes encaja.
  const dosPuntos = texto.indexOf(":");
  if (dosPuntos < 0 || !esPreambuloDeIA(texto.slice(0, dosPuntos))) {
    return texto;
  }
  return texto.slice(dosPuntos + 1).trimStart();
}

// Antes era UN regex (`^saludo? entrega [^:]{0,200}(versión|texto…)[^:]{0,200}:\s*`), con dos tramos
// ambiguos: el relleno del saludo (`[^:.!?]{0,40}[!.,]?\s*`, donde los blancos caben en dos sitios) y lo
// que rodea a la palabra prometida. Sonar lo marcó por retroceso superlineal. Ahora se recorre a mano y
// cada pieza fija es un regex anclado (`y`) sin ambigüedad. `voz-guion.test.ts` lo compara con el original.
/** El saludo opcional, hasta su palabra: «¡Hola», «Claro», «Por supuesto»… */
const SALUDO = /[¡!]?\s*(?:hola|claro|por supuesto|vale|listo)\b/iy;
/** La frase de entrega: «aquí tienes», «aquí está», «te dejo», «te presento»… */
const ENTREGA = /(?:aqu[ií] (?:tienes|est[aá]|va)|te (?:dejo|paso|presento))\b/iy;
/** Lo que promete entregar. */
const LO_ENTREGADO =
  /versi[oó]n|texto|presentaci[oó]n|descripci[oó]n|historia|biograf[ií]a|lore/iy;
/** Caracteres que admite el relleno tras el saludo (` , Paima`), sin contar la puntuación final. */
const RELLENO_MAX = 40;
/** Caracteres que admite cada lado de la palabra prometida. */
const ALREDEDOR_MAX = 200;
const BLANCO = /\s/;
const FIN_DE_FRASE = /[:.!?]/;

/** Largo de lo que `patron` (anclado) encuentra en `pos`, o -1. */
function largoEn(patron, texto, pos) {
  patron.lastIndex = pos;
  const m = patron.exec(texto);
  return m ? m[0].length : -1;
}

/** ¿El tramo antes de los primeros dos puntos es la cortesía de un chatbot? */
function esPreambuloDeIA(tramo) {
  if (entregaQuePromete(tramo, 0)) {
    return true;
  }
  const saludo = largoEn(SALUDO, tramo, 0);
  return saludo >= 0 && entregaTrasSaludo(tramo, saludo);
}

/**
 * Tras el saludo viene un relleno corto (`, Paima!`) y la entrega. Se prueba cada inicio posible de la
 * entrega; el relleno sin sus blancos finales no pasa de `RELLENO_MAX` + 1, así que el recorrido se corta
 * en cuanto lo supera (los blancos se siguen tras el último carácter que no lo es: lineal).
 */
function entregaTrasSaludo(tramo, desde) {
  let finSinBlancos = desde;
  for (let q = desde; q <= tramo.length; q += 1) {
    if (q > desde && !BLANCO.test(tramo[q - 1])) {
      finSinBlancos = q;
    }
    const relleno = tramo.slice(desde, finSinBlancos);
    if (relleno.length > RELLENO_MAX + 1) {
      return false;
    }
    if (rellenoValido(relleno) && entregaQuePromete(tramo, q)) {
      return true;
    }
  }
  return false;
}

/**
 * El relleno ya sin blancos finales: hasta `RELLENO_MAX` caracteres sin fin de frase, más una puntuación
 * final opcional (`!`, `.` o `,`). Quitar siempre esa puntuación es lo más permisivo: la coma también cabría
 * dentro, pero ocuparía un carácter del límite.
 */
function rellenoValido(relleno) {
  const ultimo = relleno.at(-1);
  const sinPuntuacion =
    ultimo !== undefined && "!.,".includes(ultimo)
      ? relleno.slice(0, -1)
      : relleno;
  return (
    sinPuntuacion.length <= RELLENO_MAX && !FIN_DE_FRASE.test(sinPuntuacion)
  );
}

/** ¿Hay una entrega en `pos` seguida, antes del final del tramo, de algo que prometa un texto? */
function entregaQuePromete(tramo, pos) {
  const entrega = largoEn(ENTREGA, tramo, pos);
  return entrega >= 0 && prometeUnTexto(tramo, pos + entrega);
}

/** La palabra prometida, con a lo sumo `ALREDEDOR_MAX` caracteres antes y después (hasta el final del tramo). */
function prometeUnTexto(tramo, desde) {
  const resto = tramo.length - desde;
  for (let i = 0; i <= Math.min(ALREDEDOR_MAX, resto); i += 1) {
    const palabra = largoEn(LO_ENTREGADO, tramo, desde + i);
    if (palabra > 0 && resto - i - palabra <= ALREDEDOR_MAX) {
      return true;
    }
  }
  return false;
}

/** 'es' si el texto parece español (o no se puede saber); 'otro' si es otro idioma/escritura. */
export function idiomaProbable(texto) {
  const t = limpiarTexto(texto);
  const letras = [...t].filter((c) => /\p{L}/u.test(c));
  if (letras.length === 0) {
    return "es";
  }
  const ajenas = letras.filter((c) =>
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}]/u.test(
      c,
    ),
  ).length;
  if (ajenas / letras.length > 0.2) {
    return "otro";
  }
  const palabras = t.toLowerCase().match(/[a-záéíóúüñ']+/g) ?? [];
  let es = 0;
  let en = 0;
  for (const p of palabras) {
    if (PALABRAS_ES.has(p)) {
      es += 1;
    }
    if (PALABRAS_EN.has(p)) {
      en += 1;
    }
  }
  return en > es ? "otro" : "es";
}

/** Corta en el último final de frase que quepa; si no hay, en la última palabra. */
export function recortarHistoria(texto, max = MAX_HISTORIA) {
  if (texto.length <= max) {
    return texto;
  }
  const corte = texto.slice(0, max);
  const fin = Math.max(
    corte.lastIndexOf(". "),
    corte.lastIndexOf("! "),
    corte.lastIndexOf("? "),
  );
  if (fin >= max * 0.4) {
    return corte.slice(0, fin + 1).trim();
  }
  const palabra = corte.lastIndexOf(" ");
  return `${corte
    .slice(0, palabra > 0 ? palabra : max)
    .trim()
    .replace(/[,;:]$/, "")}.`;
}

function conPunto(texto) {
  return /[.!?…]$/.test(texto) ? texto : `${texto}.`;
}

/**
 * @param {{ name?: string, slug?: string, countries?: Array<{ name?: string }>, cardText?: string|null }} ficha
 * @returns {{ texto: string, motivo: null } | { texto: null, motivo: 'deteriorada'|'sin_nombre'|'sin_historia'|'idioma' }}
 */
export function guionDeFicha(ficha) {
  if (!ficha || String(ficha.slug ?? "").startsWith("deteriorada-")) {
    return { texto: null, motivo: "deteriorada" };
  }
  const nombre = limpiarTexto(ficha.name);
  if (!nombre) {
    return { texto: null, motivo: "sin_nombre" };
  }
  const historia = quitarPreambuloDeIA(limpiarTexto(ficha.cardText));
  if (!historia) {
    return { texto: null, motivo: "sin_historia" };
  }
  if (idiomaProbable(historia) !== "es") {
    return { texto: null, motivo: "idioma" };
  }

  const pais = limpiarTexto(ficha.countries?.[0]?.name);
  const partes = [conPunto(nombre)];
  if (pais) {
    partes.push(conPunto(pais));
  }
  partes.push(conPunto(recortarHistoria(historia)));
  return { texto: partes.join(" "), motivo: null };
}
