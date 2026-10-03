/**
 * Premium en la interfaz: la escala (reexportada del servidor, que es su única definición) y lo
 * que la carta 3D, la etiqueta y el mantenedor necesitan para mostrarla.
 *
 * La escala NO se repite aquí: `server/src/premium.mjs` es JavaScript puro (sin Node ni DOM), así
 * que el cliente lo importa tal cual y no puede discrepar de lo que valida el servidor.
 */
import {
  GRADOS as GRADOS_SERVIDOR,
  GRADO_INICIAL as GRADO_INICIAL_SERVIDOR,
  NOMBRE_DE_GRADO,
  esBlackLabel as esBlackLabelServidor,
  gradoSiguiente as gradoSiguienteServidor,
  hoy,
  numeroDeCertificado,
  rangoDeGrado,
} from '@/server/src/premium.mjs';

import type { PremiumGrade, PremiumInfo } from '@/lib/types';

export { hoy, numeroDeCertificado, rangoDeGrado };

/** La escala completa, de menor a mayor. */
export const GRADOS = GRADOS_SERVIDOR as readonly PremiumGrade[];
export const GRADO_INICIAL = GRADO_INICIAL_SERVIDOR as PremiumGrade;

export const gradoSiguiente = (grado: PremiumGrade): PremiumGrade | null =>
  gradoSiguienteServidor(grado) as PremiumGrade | null;

export const esBlackLabel = (grado: PremiumGrade): boolean => esBlackLabelServidor(grado);

/** Nombre del grado en la etiqueta (`GEM MINT`, `PRISTINE`…). */
export const nombreDeGrado = (grado: PremiumGrade): string =>
  (NOMBRE_DE_GRADO as Record<string, string>)[grado] ?? '';

/**
 * Cómo se lee el grado en grande: el `10` sale como `10`, el `8.5` como `8.5` y la Black Label
 * como `10` con su leyenda aparte (la etiqueta CGC de una Black Label lleva el 10 pristino).
 */
export const notaVisible = (grado: PremiumGrade): string => (esBlackLabel(grado) ? '10' : grado);

/** Leyenda corta para chips: `GEM MINT 10`, `NM/MT 8`, `PRISTINE 10 · BLACK LABEL`. */
export function leyendaDePremium(premium: Pick<PremiumInfo, 'grade'>): string {
  const { grade } = premium;
  return esBlackLabel(grade) ? 'PRISTINE 10 · BLACK LABEL' : `${nombreDeGrado(grade)} ${grade}`;
}

/**
 * Meses completos entre dos fechas `AAAA-MM-DD` (`hasta` por defecto, hoy). Lo usa el mantenedor
 * para decir «lleva N meses» y avisar si ya se subió el grado este mes.
 */
export function mesesEntre(desde: string, hasta: string = hoy()): number {
  const [ay, am, ad] = desde.split('-').map(Number);
  const [by, bm, bd] = hasta.split('-').map(Number);
  if (![ay, am, ad, by, bm, bd].every(Number.isFinite)) return 0;
  const meses = (by - ay) * 12 + (bm - am) - (bd < ad ? 1 : 0);
  return Math.max(0, meses);
}

/** ¿Es el mismo mes calendario? (`AAAA-MM`). */
export const mismoMes = (a: string, b: string = hoy()): boolean => a.slice(0, 7) === b.slice(0, 7);
