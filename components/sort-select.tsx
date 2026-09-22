'use client';
/** Selector de orden (dex, nombre, poder). */
import type { SortKey } from '@/lib/types';

const OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'dex', label: 'Número (asc.)' },
  { value: 'dex-desc', label: 'Número (desc.)' },
  { value: 'name', label: 'Nombre (A-Z)' },
  { value: 'power', label: 'Poder (mayor)' },
];

export function SortSelect({ value, onChange }: { value: SortKey; onChange: (value: SortKey) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-dex-muted">
      <span className="uppercase tracking-[0.14em]">Orden</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SortKey)}
        className="rounded-lg border border-dex-line bg-dex-panel px-2 py-1.5 text-xs text-dex-ink outline-none focus:border-dex-accent"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export default SortSelect;
