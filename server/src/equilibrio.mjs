/**
 * Equilibrio de los stats base: UNA regla para todas las fichas, sin retoques a mano.
 *
 * Los stats del scrape son parejos (p90 de ataque 236, de HP 1860…) salvo fichas con valores de nivel
 * 100 puestos a mano (Ritcher: ataque 950, HP 12440, 5-8 veces el resto). La regla: ningún stat BASE pasa
 * de `FACTOR_TOPE` veces el percentil 90 del catálogo. Los topes están medidos sobre las 211 fichas con
 * stats; si el catálogo cambia mucho, se vuelven a medir y se cambian AQUÍ, en un solo sitio.
 *
 * Nivel y EXP no son stats: salen de `experiencia.mjs` y se quitan de la lista pública.
 * Los puntos que reparte la persona y el bono por niveles se suman DESPUÉS (`mi-ficha.mjs`), sobre el base ya
 * limitado: crecer sigue siendo posible, partir de 8x ya no.
 */
export const FACTOR_TOPE = 1.5;

/** Percentil 90 del catálogo por stat (medido). */
const P90 = Object.freeze({
  hp: 1860,
  mp: 1200,
  attack: 236,
  defense: 158,
  magicAttack: 233,
  magicDefense: 181,
  speed: 162,
  evasion: 85,
  accuracy: 126,
  critic: 56,
  luck: 10,
});

/** Tope del stat base, o `null` si no tiene (stats desconocidos pasan tal cual). */
export function topeDeStatBase(slug) {
  return P90[slug] === undefined ? null : Math.round(P90[slug] * FACTOR_TOPE);
}

const NO_SON_STATS = new Set(["level", "exp"]);

/** La lista de stats sin nivel/EXP y con cada valor base limitado; el máximo de HP/MP baja con él. No muta. */
export function equilibrarStats(stats) {
  if (!Array.isArray(stats)) return stats;
  return stats
    .filter((s) => !NO_SON_STATS.has(s.slug))
    .map((s) => {
      const tope = topeDeStatBase(s.slug);
      if (tope === null || typeof s.value !== "number" || s.value <= tope)
        return s;
      const baja = s.value - tope;
      return {
        ...s,
        value: tope,
        max: typeof s.max === "number" ? Math.max(tope, s.max - baja) : s.max,
      };
    });
}

/** Valor base limitado, para el puntaje de poder. */
export function valorEquilibrado(slug, valor) {
  const tope = topeDeStatBase(slug);
  const n = Number(valor) || 0;
  return tope === null ? n : Math.min(n, tope);
}
