'use client';
/** Selector de orden (dex, nombre, poder). */
import { useI18n } from '@/lib/i18n';
import type { Clave } from '@/lib/i18n/mensajes';
import type { SortKey } from '@/lib/types';

const OPTIONS: Array<{ value: SortKey; label: Clave }> = [
  { value: 'dex', label: 'orden.dex' },
  { value: 'dex-desc', label: 'orden.dexDesc' },
  { value: 'name', label: 'orden.nombre' },
  { value: 'power', label: 'orden.poder' },
];

export function SortSelect({ value, onChange }: { value: SortKey; onChange: (value: SortKey) => void }) {
  const { t } = useI18n();
  return (
    <label className="inline-flex items-center gap-2 text-xs text-dex-muted">
      <span className="uppercase tracking-[0.14em]">{t('orden.etiqueta')}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as SortKey)}
        className="rounded-lg border border-dex-line bg-dex-panel px-2 py-1.5 text-xs text-dex-ink outline-none focus:border-dex-accent"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {t(option.label)}
          </option>
        ))}
      </select>
    </label>
  );
}

export default SortSelect;
