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

/** La escala PREMIUM, de menor a mayor. La posición es el rango. Es la que sube con las donaciones. */
export const GRADOS = Object.freeze(['8', '8.5', '9', '9.5', '10', 'BL']);

/**
 * La escala de DETERIORO, del menos al más dañado: `7` apenas desgastada, `1` ilegible. Es la
 * contraparte de la premium: una carta de un VTuber dado de baja no se elimina, se degrada
 * (cláusula de salida de los términos) y se muestra gradeada igual que una premium, pero rota.
 * El grado `1` es el de las bajas. Los asigna a mano el mantenedor; nada los calcula.
 */
export const GRADOS_DEGRADADOS = Object.freeze(['7', '6', '5', '4', '3', '2', '1']);

/** El grado con el que queda la ficha de quien se dio de baja: la carta ya no se entiende. */
export const GRADO_DE_BAJA = '1';

/** Todos los grados que se pueden fijar, de peor a mejor: `1 … 7 · 8 … BL`. */
export const TODOS_LOS_GRADOS = Object.freeze([...[...GRADOS_DEGRADADOS].reverse(), ...GRADOS]);

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
  // Escala de deterioro, con los nombres de las categorías bajas de las certificadoras.
  7: 'NM',
  6: 'EX/NM',
  5: 'EX',
  4: 'VG/EX',
  3: 'VG',
  2: 'GD',
  1: 'POOR',
});

/**
 * Donación (USD) que corresponde a cada grado premium. Es REFERENCIA para el mantenedor: nada la
 * cobra ni la valida (la donación la registra una persona, ver `premium-manager.tsx`).
 *
 * `null` = todavía sin monto definido. El `BL` no tiene monto porque NO se vende: está reservado
 * y lo otorga el mantenedor. Al fijar un monto nuevo, se cambia aquí y la pestaña «Tarifas» lo muestra.
 */
export const DONACION_POR_GRADO = Object.freeze({
  8: null,
  8.5: null,
  9: null,
  9.5: 20,
  10: null,
  BL: null,
});

/** Grados que nadie puede obtener donando: los otorga el mantenedor. */
export const GRADOS_RESERVADOS = Object.freeze(['BL']);

export function esGradoValido(valor) {
  return typeof valor === 'string' && TODOS_LOS_GRADOS.includes(valor);
}

/** ¿Es un grado de la escala PREMIUM (`8`…`BL`)? */
export function esGradoPremium(grado) {
  return typeof grado === 'string' && GRADOS.includes(grado);
}

/** ¿Es un grado de la escala de deterioro (`7`…`1`)? */
export function esGradoDegradado(grado) {
  return typeof grado === 'string' && GRADOS_DEGRADADOS.includes(grado);
}

/**
 * Cuánto está dañada la carta, de 0 (intacta: cualquier grado premium) a 1 (el grado `1`).
 * Lineal en el grado: `7` = 1/7, `4` = 4/7, `1` = 1. Es lo único que el dibujo de la carta necesita
 * saber del grado; las perillas de cada efecto viven en `DETERIORO` (`card3d-config.ts`).
 */
export function severidadDeGrado(grado) {
  if (!esGradoDegradado(grado)) return 0;
  return (8 - Number(grado)) / 7;
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

/** Meses calendario entre dos fechas `AAAA-MM-DD` (por mes, no por día: de enero 31 a febrero 1 hay 1). */
export function mesesCalendario(desde, hasta) {
  const [ay, am] = String(desde).split('-').map(Number);
  const [by, bm] = String(hasta).split('-').map(Number);
  if (![ay, am, by, bm].every(Number.isFinite)) return 0;
  return (by - ay) * 12 + (bm - am);
}

/**
 * Racha: meses SEGUIDOS donando, derivada de `since` y `gradedAt` (sin columna propia).
 *
 * Cada «Subir a…» mensual mueve `gradedAt`, y `aplicarPremium` adelanta `since` al día del ascenso si
 * pasó más de un mes sin subir: así `since` es el inicio de la racha vigente y la cuenta es
 * `meses(since → gradedAt) + 1`. Devuelve 0 si no hay racha que mostrar:
 *   · una racha de un solo mes (aún no es racha) o una carta degradada;
 *   · una racha ROTA: el último ascenso fue hace más de un mes (ese hueco es el «en pausa»);
 *   · EXCEPCIÓN: en el `10` y la `BL` no hay más ascensos que contar, así que la racha no caduca
 *     (se queda en los meses alcanzados) en vez de apagarse sola a quien ya llegó arriba.
 */
export function rachaDe(premium, ahora = hoy()) {
  if (!premium || !GRADOS.includes(premium.grade)) return 0;
  const meses = mesesCalendario(premium.since, premium.gradedAt) + 1;
  if (meses < 2) return 0;
  const enLoAlto = premium.grade === '10' || premium.grade === GRADO_MAXIMO;
  if (!enLoAlto && mesesCalendario(premium.gradedAt, ahora) > 1) return 0;
  return meses;
}
