/**
 * Experiencia de un VTuber: cómo los likes la hacen subir.
 *
 * REGLA DE NEGOCIO
 * ----------------
 * Cada like que recibe la ficha suma `XP_POR_LIKE` puntos de experiencia sobre lo que la ficha ya
 * traía (la experiencia del scrape o la que escribió el mantenedor). Al llenar la barra
 * (`max`) la ficha sube de nivel, la barra se vacía y el siguiente nivel pide más.
 *
 * ES UNA FUNCIÓN DE LOS DATOS, NO UN CONTADOR GUARDADO. La experiencia y el nivel que ve el
 * visitante se CALCULAN con el número de likes en el momento de leer: no hay una segunda cifra
 * que pueda quedar desincronizada de los likes, y cambiar `XP_POR_LIKE` o la curva reescribe
 * toda la historia sin migrar nada. Es JavaScript puro (sin Node ni DOM) para que el servidor y
 * las pruebas la compartan.
 *
 * LA CURVA
 * --------
 * El primer nivel pide lo que ya dice la ficha (`max`, o 100 si no tiene); desde ahí cada nivel
 * pide `BASE_NIVEL + PASO_NIVEL x (nivel - 1)`, y nunca MENOS que el anterior: una ficha del
 * scrape con `max = 500` no puede bajar a 250 al subir de nivel.
 *
 * EL CONTADOR TOTAL NO SE BORRA (como en Ragnarok Online)
 * -------------------------------------------------------
 * La barra se vacía al subir de nivel (`current`), pero `total` es la experiencia ACUMULADA de toda
 * la vida de la ficha: lo que ya valían los niveles anteriores según la curva, más lo de la barra,
 * más los likes. Nunca baja y no se reinicia: es lo que la persona ve crecer aunque la barra vuelva
 * a cero. Es otra función de los mismos datos, no un segundo contador guardado.
 *
 * PUNTOS DE HABILIDAD
 * -------------------
 * Cada nivel que la ficha GANA con likes da `PUNTOS_POR_NIVEL` puntos para subir sus habilidades
 * (`nivelesGanados`). Se cuentan desde el nivel que traía la ficha (el del scrape o el del
 * mantenedor): las 785 fichas no nacen con cientos de puntos por un nivel que no ganaron aquí.
 * Cuántos se gastaron y en qué vive en `server/src/mi-ficha.mjs`.
 */

/** Puntos de experiencia por like. */
export const XP_POR_LIKE = 10;
/** Experiencia que pide el nivel 1 cuando la ficha no trae una. */
export const BASE_NIVEL = 100;
/** Cuánto más pide cada nivel que el anterior. */
export const PASO_NIVEL = 50;
/** Puntos de habilidad que da cada nivel ganado. */
export const PUNTOS_POR_NIVEL = 3;
/** Rango máximo de una habilidad: con 3 puntos por nivel, 5 rangos se alcanzan sin que sea eterno ni trivial. */
export const RANGO_MAXIMO = 5;
/** Tope de niveles por cálculo: corta cualquier entrada absurda (`max` ínfimo, likes enormes). */
const MAX_NIVELES_POR_CALCULO = 100_000;

/** Experiencia que pide un nivel (sin tener en cuenta el `max` propio de la ficha). */
export function umbralDeNivel(nivel) {
  return BASE_NIVEL + PASO_NIVEL * (Math.max(1, nivel) - 1);
}

const entero = (valor, porDefecto) => (Number.isFinite(Number(valor)) && valor !== null ? Math.trunc(Number(valor)) : porDefecto);

/**
 * Nivel y barra de experiencia resultantes de sumar `likes` a la base de la ficha.
 *
 * @param {{ level?: number|null, current?: number|null, max?: number|null }} base
 * @param {number} likes
 * @returns {{ level: number, current: number, max: number, total: number, nivelesGanados: number, likes: number, xpPorLike: number }}
 */
export function experienciaConLikes(base, likes) {
  const totalLikes = Math.max(0, entero(likes, 0));
  let nivel = Math.max(1, entero(base?.level, 1));
  const nivelBase = nivel;
  let max = Math.max(1, entero(base?.max, 0) || umbralDeNivel(nivel));
  const actualBase = Math.max(0, entero(base?.current, 0));
  let actual = actualBase + totalLikes * XP_POR_LIKE;
  // Lo que valieron los niveles que la ficha ya traía + su barra + los likes: no se reinicia nunca.
  let total = actualBase + totalLikes * XP_POR_LIKE;
  for (let n = 1; n < nivelBase; n += 1) total += umbralDeNivel(n);
  for (let vueltas = 0; actual >= max && vueltas < MAX_NIVELES_POR_CALCULO; vueltas += 1) {
    actual -= max;
    nivel += 1;
    max = Math.max(max, umbralDeNivel(nivel));
  }
  return { level: nivel, current: actual, max, total, nivelesGanados: nivel - nivelBase, likes: totalLikes, xpPorLike: XP_POR_LIKE };
}
