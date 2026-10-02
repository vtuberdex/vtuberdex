/**
 * Qué emblemas de facción lleva una carta. Lo comparten la textura (que pinta los engarces y
 * reserva el ancho en la cabecera) y el componente 3D (que carga los emblemas para el shader):
 * si cada uno filtrara por su cuenta, un emblema con ruta vacía dejaría un engarce sin emblema.
 */
import type { VtuberCard } from '@/lib/types';
import { MAX_FACTION_EMBLEMS } from './dimensiones';

/** Rutas de los emblemas de la carta, en el orden de sus facciones y con tope de dos. */
export function iconosDeFaccion(card: Pick<VtuberCard, 'factionIcons'>): string[] {
  return (card.factionIcons ?? [])
    .map((faction) => faction.icon)
    .filter((icon): icon is string => Boolean(icon))
    .slice(0, MAX_FACTION_EMBLEMS);
}

/**
 * Ancho que ocupan `cantidad` engarces juntos (incluido el hueco que los separa del nombre).
 * 0 si no hay emblemas: la cabecera queda exactamente como antes.
 */
export function anchoDeEngarces(cantidad: number, size: number, gap: number, separacion: number): number {
  if (cantidad <= 0) return 0;
  return cantidad * size + (cantidad - 1) * gap + separacion;
}
