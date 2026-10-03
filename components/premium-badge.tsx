/**
 * Distintivo de una carta premium para el DOM: la misma nota que lleva la etiqueta de la placa
 * 3D, para las vistas que no son 3D (ficha, respaldo sin WebGL, mantenedor).
 *
 * Los colores siguen a los de la etiqueta (`PREMIUM.label.bands`): azul para el 8, acero para el
 * 9, dorado para el 10 y negro con filete dorado para la Black Label. Si cambia uno, cambia el
 * otro: el distintivo es lo que el visitante ve cuando la carta aún no ha cargado.
 */
import type { PremiumInfo } from '@/lib/types';
import { esBlackLabel, leyendaDePremium } from '@/lib/premium';

const ESTILO_POR_GRADO: Record<string, string> = {
  '8': 'border-sky-400/50 bg-sky-500/15 text-sky-200',
  '8.5': 'border-sky-400/50 bg-sky-500/15 text-sky-200',
  '9': 'border-slate-300/50 bg-slate-400/15 text-slate-100',
  '9.5': 'border-slate-300/50 bg-slate-400/15 text-slate-100',
  '10': 'border-amber-300/60 bg-amber-300/15 text-amber-200',
  BL: 'border-amber-400/70 bg-black text-amber-300',
};

export function PremiumBadge({ premium, className = '' }: { premium: PremiumInfo; className?: string }) {
  const estilo = ESTILO_POR_GRADO[premium.grade] ?? ESTILO_POR_GRADO['8'];
  return (
    <span
      data-testid="premium-badge"
      data-grade={premium.grade}
      title={`Carta premium · ${leyendaDePremium(premium)} · ${premium.cert}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${estilo} ${className}`}
    >
      <span aria-hidden>{esBlackLabel(premium.grade) ? '◆' : '★'}</span>
      {leyendaDePremium(premium)}
    </span>
  );
}

export default PremiumBadge;
