/**
 * RANGOS por nivel: el título que lleva una ficha según el nivel al que llegó (likes, juego, entregas, directos…).
 * UNA sola tabla: la ficha pública, «Mi ficha» y el plugin de Minecraft (`GET /api/minecraft/reglas`) la leen de aquí.
 *
 * Los umbrales salen de la curva real (`umbralDeNivel`: 100 + 50 por nivel): el nivel 10 son ~2.700 XP (unos días de
 * juego), el 20 ~11.000, el 35 ~40.000 y el 50 ~80.000. Un nivel nuevo es raro y el último rango es de verdad difícil.
 * Para ajustar la escalera se toca SOLO `RANGOS`; los textos viven en `lib/i18n` bajo `rango.<id>`.
 *
 * JS puro, sin Node ni DOM: lo importa también el cliente.
 */

/** De menor a mayor. `desde` es el primer nivel que lleva ese rango. `nombre` (español) es para el plugin; la web traduce `rango.<id>`. */
export const RANGOS = Object.freeze([
  Object.freeze({ id: 'novato', nombre: 'Novato', desde: 1 }),
  Object.freeze({ id: 'aprendiz', nombre: 'Aprendiz', desde: 5 }),
  Object.freeze({ id: 'veterano', nombre: 'Veterano', desde: 10 }),
  Object.freeze({ id: 'elite', nombre: 'Élite', desde: 20 }),
  Object.freeze({ id: 'maestro', nombre: 'Maestro', desde: 35 }),
  Object.freeze({ id: 'leyenda', nombre: 'Leyenda', desde: 50 }),
]);

/**
 * El rango de un nivel y lo que falta para el siguiente.
 * @param {number} nivel cualquier valor; lo inválido cuenta como nivel 1
 * @returns {{ id: string, indice: number, desde: number, siguiente: { id: string, desde: number, faltan: number } | null }}
 */
export function rangoDeNivel(nivel) {
  const n = Number.isFinite(Number(nivel)) ? Math.max(1, Math.trunc(Number(nivel))) : 1;
  let indice = 0;
  for (let i = 0; i < RANGOS.length; i += 1) if (n >= RANGOS[i].desde) indice = i;
  const siguiente = RANGOS[indice + 1] ?? null;
  return {
    id: RANGOS[indice].id,
    indice,
    desde: RANGOS[indice].desde,
    siguiente: siguiente ? { id: siguiente.id, desde: siguiente.desde, faltan: siguiente.desde - n } : null,
  };
}
