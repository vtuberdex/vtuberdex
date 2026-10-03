/**
 * Cartas PREMIUM: la escala de grados y sus reglas. UNA sola definición.
 *
 * QUÉ ES
 * ------
 * Un VTuber que dona al proyecto recibe su carta «gradeada», como las que certifica CGC: la carta
 * se muestra dentro de una placa de acrílico con su etiqueta y su nota. Parte del grado 8 y sube
 * 0,5 por cada mes que sigue donando, hasta el 10 y, por encima de él, la Black Label (`BL`).
 *
 *   8 → 8,5 → 9 → 9,5 → 10 → BL
 *
 * POR QUÉ ES UN MÓDULO APARTE
 * ---------------------------
 * La escala la necesitan cuatro sitios que no pueden discrepar: la validación del mantenedor
 * (`validation.mjs`), la regla que la guarda (`mutations.mjs`), el buscador que la devuelve
 * (`search.mjs`) y la interfaz (`lib/premium.ts` la reexporta para la carta 3D y el mantenedor).
 * Es JavaScript puro, sin Node ni DOM, para que el cliente pueda importarlo igual que el servidor.
 *
 * LOS GRADOS SON TEXTO, NO NÚMEROS
 * --------------------------------
 * `'BL'` no es un número y `8.5` como `REAL` se guarda como `8.5` pero se lee como `8.5` o `8.50`
 * según quién lo formatee: con texto la clave es siempre la misma en la base, en la API y en el
 * formulario, y el orden lo da la POSICIÓN en `GRADOS`, no una comparación numérica.
 */

/** La escala completa, de menor a mayor. La posición es el rango. */
export const GRADOS = Object.freeze(['8', '8.5', '9', '9.5', '10', 'BL']);

/** Grado con el que entra una carta nueva: el mínimo de la escala. */
export const GRADO_INICIAL = GRADOS[0];

/** Grado máximo: la Black Label. Por encima de él no hay nada. */
export const GRADO_MAXIMO = GRADOS[GRADOS.length - 1];

/**
 * Nombre de cada grado, como el de las etiquetas de CGC. El `10` es «Gem Mint» y la `BL` es la
 * Black Label: un 10 «pristine» al que se le imprime la etiqueta negra.
 */
export const NOMBRE_DE_GRADO = Object.freeze({
  8: 'NM/MT',
  8.5: 'NM/MT+',
  9: 'MINT',
  9.5: 'MINT+',
  10: 'GEM MINT',
  BL: 'PRISTINE',
});

export function esGradoValido(valor) {
  return typeof valor === 'string' && GRADOS.includes(valor);
}

/** Posición del grado en la escala (0 = el más bajo), o -1 si no es un grado. */
export function rangoDeGrado(grado) {
  return GRADOS.indexOf(grado);
}

/**
 * El grado al que se asciende un mes más tarde, o `null` si ya es el máximo.
 * El mantenedor lo usa para el botón «Subir medio punto».
 */
export function gradoSiguiente(grado) {
  const rango = rangoDeGrado(grado);
  if (rango < 0 || rango >= GRADOS.length - 1) return null;
  return GRADOS[rango + 1];
}

/** `true` en el grado máximo: es lo que activa la etiqueta negra. */
export function esBlackLabel(grado) {
  return grado === GRADO_MAXIMO;
}

/**
 * Número de certificado: derivado del id de la ficha, no guardado. Un dato que se puede
 * recalcular no puede quedar desincronizado, y así la placa de una misma carta lleva siempre
 * el mismo número en local, en producción y en cada instancia que reproduce el diario.
 */
export function numeroDeCertificado(id) {
  return `VTD-${String(Math.max(0, Number(id) || 0)).padStart(6, '0')}`;
}

/** Fecha de hoy (`AAAA-MM-DD`, UTC). Aislada para que los tests y el diario puedan fijarla. */
export function hoy(ahora = new Date()) {
  return ahora.toISOString().slice(0, 10);
}
