/**
 * Premium en la interfaz: la escala (reexportada del servidor, que es su única definición) y lo
 * que la carta 3D, la etiqueta y el mantenedor necesitan para mostrarla.
 *
 * La escala NO se repite aquí: `server/src/premium.mjs` es JavaScript puro (sin Node ni DOM), así
 * que el cliente lo importa tal cual y no puede discrepar de lo que valida el servidor.
 */
import {
  GRADOS as GRADOS_SERVIDOR,
  GRADOS_DEGRADADOS as GRADOS_DEGRADADOS_SERVIDOR,
  GRADO_DE_BAJA as GRADO_DE_BAJA_SERVIDOR,
  GRADO_INICIAL as GRADO_INICIAL_SERVIDOR,
  TODOS_LOS_GRADOS as TODOS_LOS_GRADOS_SERVIDOR,
  esGradoDegradado as esGradoDegradadoServidor,
  severidadDeGrado as severidadDeGradoServidor,
  NOMBRE_DE_GRADO,
  DONACION_POR_GRADO as DONACION_POR_GRADO_SERVIDOR,
  GRADOS_RESERVADOS as GRADOS_RESERVADOS_SERVIDOR,
  esBlackLabel as esBlackLabelServidor,
  gradoSiguiente as gradoSiguienteServidor,
  hoy,
  numeroDeCertificado,
  rangoDeGrado,
} from '@/server/src/premium.mjs';

import { esFichaDeteriorada as esFichaDeterioradaServidor } from '@/server/src/ficha-deteriorada.mjs';
import type { PremiumGrade, PremiumInfo } from '@/lib/types';

export { hoy, numeroDeCertificado, rangoDeGrado };

/** La escala completa, de menor a mayor. */
export const GRADOS = GRADOS_SERVIDOR as readonly PremiumGrade[];
export const GRADO_INICIAL = GRADO_INICIAL_SERVIDOR as PremiumGrade;

/** Donación en USD por grado premium (`null` = aún sin definir). Referencia del mantenedor. */
export const DONACION_POR_GRADO = DONACION_POR_GRADO_SERVIDOR as Readonly<Record<string, number | null>>;
/** Grados que no se obtienen donando (Black Label). */
export const GRADOS_RESERVADOS = GRADOS_RESERVADOS_SERVIDOR as readonly PremiumGrade[];

/** La escala de deterioro (`7`…`1`), del menos al más dañado. */
export const GRADOS_DEGRADADOS = GRADOS_DEGRADADOS_SERVIDOR as readonly PremiumGrade[];
/** Todos los grados que el mantenedor puede fijar, de peor a mejor (`1 … 7 · 8 … BL`). */
export const TODOS_LOS_GRADOS = TODOS_LOS_GRADOS_SERVIDOR as readonly PremiumGrade[];
/** El grado de quien se dio de baja. */
export const GRADO_DE_BAJA = GRADO_DE_BAJA_SERVIDOR as PremiumGrade;

export const esGradoDegradado = (grado: string | null | undefined): boolean => esGradoDegradadoServidor(grado);
/** 0 en un grado premium; de 1/7 (grado 7) a 1 (grado 1) en uno degradado. */
export const severidadDeGrado = (grado: string | null | undefined): number => severidadDeGradoServidor(grado);

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
  if (esGradoDegradado(grade)) return `${nombreDeGrado(grade)} ${grade} · DETERIORADA`;
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

/** ¿Es una ficha deteriorada (grado 1, la de las bajas)? El público no ve sus datos ni su logo. */
export const esFichaDeteriorada = (cartaOGrado: { premium?: { grade: string } | null } | string | null | undefined): boolean =>
  esFichaDeterioradaServidor(cartaOGrado);
