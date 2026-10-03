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
 */

/** Puntos de experiencia por like. */
export const XP_POR_LIKE = 10;
/** Experiencia que pide el nivel 1 cuando la ficha no trae una. */
export const BASE_NIVEL = 100;
/** Cuánto más pide cada nivel que el anterior. */
export const PASO_NIVEL = 50;
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
 * @returns {{ level: number, current: number, max: number, likes: number, xpPorLike: number }}
 */
export function experienciaConLikes(base, likes) {
  const totalLikes = Math.max(0, entero(likes, 0));
  let nivel = Math.max(1, entero(base?.level, 1));
  let max = Math.max(1, entero(base?.max, 0) || umbralDeNivel(nivel));
  let actual = Math.max(0, entero(base?.current, 0)) + totalLikes * XP_POR_LIKE;
  for (let vueltas = 0; actual >= max && vueltas < MAX_NIVELES_POR_CALCULO; vueltas += 1) {
    actual -= max;
    nivel += 1;
    max = Math.max(max, umbralDeNivel(nivel));
  }
  return { level: nivel, current: actual, max, likes: totalLikes, xpPorLike: XP_POR_LIKE };
}
