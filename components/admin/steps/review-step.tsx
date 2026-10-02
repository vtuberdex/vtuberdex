'use client';
/** Paso 6: revisar y publicar — checklist con saltos directos a lo que falta. */
import Link from 'next/link';

import type { CheckItem, StepId } from '@/components/admin/completeness';
import { percent } from '@/components/admin/completeness';
import type { StepProps } from '@/components/admin/steps/types';
import { ghostButton } from '@/components/admin/ui';

export function ReviewStep({
  form,
  set,
  items,
  slug,
  onJump,
  stepLabel,
}: StepProps & { items: CheckItem[]; slug: string; onJump: (step: StepId) => void; stepLabel: (step: StepId) => string }) {
  const total = percent(items);
  return (
    <div className="space-y-5">
      <p className="text-sm text-dex-muted">Revisa que no falte nada. Lo que falta no impide publicar, pero la carta se verá más pobre.</p>
      <p className="font-mono text-sm text-dex-ink" data-testid="completeness-percent">
        {total}% completa
      </p>
      <ul className="space-y-1" data-testid="checklist">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-2 text-sm">
            <span aria-hidden className={item.ok ? 'text-emerald-300' : 'text-amber-300'}>
              {item.ok ? '✔' : '⚠'}
            </span>
            <span className={item.ok ? 'text-dex-ink' : 'text-amber-100'}>
              {item.label}
              <span className="sr-only">{item.ok ? ' (listo)' : ' (falta)'}</span>
            </span>
            {!item.ok && (
              <button type="button" className={ghostButton} onClick={() => onJump(item.step)}>
                Ir a {stepLabel(item.step)}
              </button>
            )}
          </li>
        ))}
      </ul>

      <fieldset className="space-y-2 rounded-xl border border-dex-line p-3">
        <legend className="px-1 text-xs uppercase tracking-[0.14em] text-dex-muted">Visibilidad</legend>
        <label className="flex items-start gap-2 text-sm text-dex-ink">
          <input type="radio" name="visibilidad" checked={form.status === 'published'} onChange={() => set('status', 'published')} />
          <span>
            Publicar ahora
            <span className="block text-xs text-dex-muted">La carta aparece en el catálogo y su página es pública.</span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm text-dex-ink">
          <input type="radio" name="visibilidad" checked={form.status === 'draft'} onChange={() => set('status', 'draft')} />
          <span>
            Dejar en borrador
            <span className="block text-xs text-dex-muted">Solo la ves tú aquí; puedes publicarla cuando esté lista.</span>
          </span>
        </label>
        {form.status === 'hidden' && (
          <label className="flex items-start gap-2 text-sm text-dex-ink">
            <input type="radio" name="visibilidad" checked readOnly />
            <span>Oculta (se mantiene así)</span>
          </label>
        )}
      </fieldset>

      <p className="text-xs text-dex-muted">
        Vista previa:{' '}
        <Link href={`/v/${slug}`} className="font-mono underline" target="_blank">
          /v/{slug}
        </Link>{' '}
        (si aún es borrador, la página pública no se verá hasta publicarla).
      </p>
    </div>
  );
}
