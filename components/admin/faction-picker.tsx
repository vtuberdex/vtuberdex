'use client';
/**
 * Selector de facciones de una ficha: máximo DOS, elegidas del catálogo cerrado.
 *
 * Son botones conmutables y no dos `<select>` porque así se ve el emblema de cada
 * opción y la regla del máximo se lee sola: con dos elegidas, el resto queda
 * deshabilitado y es imposible llegar a una tercera (el servidor la rechaza con
 * `demasiadas_facciones`, pero la UI no debería dejar ni intentarlo). El orden de
 * elección se conserva: la primera es la que la carta 3D pinta como principal.
 */
import type { FactionRow } from '@/lib/types';
import { MAX_FACTIONS } from '@/components/admin/form-model';
import { Emblem } from '@/components/admin/ui';

export function FactionPicker({
  factions,
  value,
  onChange,
}: {
  factions: FactionRow[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const full = value.length >= MAX_FACTIONS;
  // Facciones de la ficha que ya no existen en el catálogo (se limpiaron): se muestran para poder quitarlas.
  const orphans = value.filter((slug) => !factions.some((faction) => faction.slug === slug));

  const toggle = (slug: string) => {
    if (value.includes(slug)) onChange(value.filter((current) => current !== slug));
    else if (!full) onChange([...value, slug]);
  };

  return (
    <div>
      <p className="mb-2 text-xs text-dex-muted" data-testid="faction-count">
        {value.length} de {MAX_FACTIONS} facciones elegidas{full ? ' · quita una para elegir otra' : ''}
      </p>
      <ul className="flex flex-wrap gap-2">
        {[...orphans.map((slug) => ({ id: -1, slug, label: slug, icon: null }) as unknown as FactionRow), ...factions].map(
          (faction) => {
            const selected = value.includes(faction.slug);
            return (
              <li key={faction.slug}>
                <button
                  type="button"
                  aria-pressed={selected}
                  disabled={!selected && full}
                  onClick={() => toggle(faction.slug)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition disabled:cursor-not-allowed disabled:opacity-35 ${
                    selected ? 'border-dex-accent bg-dex-accent/15 text-dex-ink' : 'border-dex-line text-dex-muted hover:text-dex-ink'
                  }`}
                >
                  <Emblem icon={faction.icon} className="h-4 w-4" />
                  {faction.label}
                </button>
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
}
