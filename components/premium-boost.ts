/**
 * Cuánto se refuerza la holografía de una carta gradeada (ver `PREMIUM.boost`).
 *
 * Función pura: el hook de materiales la aplica a las perillas del shader y los tests la fijan sin
 * WebGL. Una carta normal devuelve todo en 1, así que el camino sin premium no cambia.
 */
import { PREMIUM } from '@/components/card3d-config';
import { esBlackLabel, esGradoDegradado, rangoDeGrado, severidadDeGrado } from '@/lib/premium';
import type { PremiumGrade } from '@/lib/types';

export interface HoloBoost {
  layerWeight: number;
  bgHolo: number;
  bgLayerWeight: number;
  glare: number;
  edge: number;
  faction: number;
  glow: number;
  holo: number;
}

export const SIN_REFUERZO: HoloBoost = Object.freeze({
  layerWeight: 1,
  bgHolo: 1,
  bgLayerWeight: 1,
  glare: 1,
  edge: 1,
  faction: 1,
  glow: 1,
  holo: 1,
});

/** Multiplicador común de un grado: `base + porPaso x rango` (+ extra en la Black Label). */
export function factorDeGrado(grado: PremiumGrade): number {
  const { base, porPaso, extraBlackLabel } = PREMIUM.boost;
  // Los grados van de medio en medio punto: un paso de la escala es un mes, no un punto entero.
  const rango = Math.max(0, rangoDeGrado(grado));
  return base + porPaso * rango + (esBlackLabel(grado) ? extraBlackLabel : 0);
}

export function refuerzoDeGrado(grado: PremiumGrade | null | undefined): HoloBoost {
  if (!grado) return SIN_REFUERZO;
  if (esGradoDegradado(grado)) {
    // Una carta rota brilla MENOS que una normal: el foil se apaga con el deterioro. Nunca a cero,
    // o el grado 1 dejaría de reaccionar al puntero y parecería una imagen congelada.
    const apagado = Math.max(0.35, 1 - 0.55 * severidadDeGrado(grado));
    return { layerWeight: apagado, bgHolo: apagado, bgLayerWeight: apagado, glare: apagado, edge: apagado, faction: apagado, glow: apagado, holo: apagado };
  }
  const factor = factorDeGrado(grado);
  const { techo } = PREMIUM.boost;
  const tope = (clave: keyof HoloBoost, multiplicador: number) => Math.min(techo[clave], multiplicador);
  return {
    layerWeight: tope('layerWeight', factor),
    bgHolo: tope('bgHolo', factor),
    bgLayerWeight: tope('bgLayerWeight', factor),
    glare: tope('glare', factor),
    // La tinta sube menos que el resto: es una de las dos capas que lavan la carta.
    edge: tope('edge', 1 + (factor - 1) * 0.5),
    faction: tope('faction', factor),
    glow: tope('glow', factor),
    holo: tope('holo', factor),
  };
}
