/**
 * Distintivo de una carta premium para el DOM: la misma nota que lleva la etiqueta de la placa
 * 3D, para las vistas que no son 3D (ficha, respaldo sin WebGL, mantenedor).
 *
 * Los colores siguen a los de la etiqueta (`PREMIUM.label.bands`): azul para el 8, acero para el
 * 9, dorado para el 10 y negro con filete dorado para la Black Label. Si cambia uno, cambia el
 * otro: el distintivo es lo que el visitante ve cuando la carta aún no ha cargado.
 */
import { useI18n } from '@/lib/i18n';
import type { PremiumInfo } from '@/lib/types';
import { esBlackLabel, esGradoDegradado, leyendaDePremium, nombreDeGrado, rachaDe } from '@/lib/premium';

const ESTILO_POR_GRADO: Record<string, string> = {
  '6': 'border-yellow-700/50 bg-yellow-900/20 text-yellow-200/80',
  '6.5': 'border-yellow-700/50 bg-yellow-900/20 text-yellow-200/80',
  '7': 'border-lime-700/50 bg-lime-900/20 text-lime-200/80',
  '7.5': 'border-lime-700/50 bg-lime-900/20 text-lime-200/80',
  '8': 'border-sky-400/50 bg-sky-500/15 text-sky-200',
  '8.5': 'border-sky-400/50 bg-sky-500/15 text-sky-200',
  '9': 'border-slate-300/50 bg-slate-400/15 text-slate-100',
  '9.5': 'border-slate-300/50 bg-slate-400/15 text-slate-100',
  '10': 'border-amber-300/60 bg-amber-300/15 text-amber-200',
  BL: 'border-amber-400/70 bg-black text-amber-300',
  // Degradadas: del ocre apagado al gris sucio y al rojo óxido del grado 1.
  '5': 'border-orange-700/50 bg-orange-900/20 text-orange-200/80',
  '4': 'border-orange-800/50 bg-orange-950/30 text-orange-300/70',
  '3': 'border-red-900/50 bg-red-950/30 text-red-300/70',
  '2': 'border-stone-600/50 bg-stone-900/40 text-stone-300/70',
  '1': 'border-stone-700/60 bg-stone-950 text-stone-400',
};

/**
 * `compacto`: solo el símbolo y la nota (`★ 9.5`, `◆ BL`) para listas densas del mantenedor. La leyenda
 * completa y la racha siguen disponibles en el `title` (al pasar el ratón) y en el atributo `data-grade`.
 */
export function PremiumBadge({ premium, className = '', compacto = false }: { premium: PremiumInfo; className?: string; compacto?: boolean }) {
  const { t } = useI18n();
  const meses = rachaDe(premium);
  const racha = meses > 0 ? t('premium.racha', { n: meses }) : null;
  const degradada = esGradoDegradado(premium.grade);
  // El nombre del grado (GEM MINT…) es un término de coleccionismo: no se traduce; solo la marca de «deteriorada».
  const leyenda = degradada ? `${nombreDeGrado(premium.grade)} ${premium.grade} · ${t('premium.deteriorada')}` : leyendaDePremium(premium);
  const estilo = ESTILO_POR_GRADO[premium.grade] ?? ESTILO_POR_GRADO['8'];
  return (
    <span
      data-testid="premium-badge"
      data-grade={premium.grade}
      title={`${degradada ? t('premium.cartaDeteriorada') : t('premium.cartaPremium')} · ${leyenda} · ${premium.cert}${racha ? ` · ${racha}` : ''}`}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] ${estilo} ${className}`}
    >
      <span aria-hidden>{esBlackLabel(premium.grade) ? '◆' : esGradoDegradado(premium.grade) ? '✕' : '★'}</span>
      {compacto ? (esBlackLabel(premium.grade) ? 'BL' : premium.grade) : leyenda}
      {!compacto && racha && (
        <span data-testid="premium-streak" className="font-semibold normal-case tracking-normal opacity-80">
          · {racha}
        </span>
      )}
    </span>
  );
}

export default PremiumBadge;
