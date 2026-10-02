'use client';
/** Selección múltiple compacta (países, idiomas): chips quitables más un desplegable para agregar. */
import { inputClass, labelClass } from '@/components/admin/ui';

export interface ChipOption {
  value: string;
  label: string;
}

export function ChipPicker({
  label,
  options,
  value,
  onChange,
  max,
}: {
  label: string;
  options: ChipOption[];
  value: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const labelOf = (slug: string) => options.find((option) => option.value === slug)?.label ?? slug;
  const available = options.filter((option) => !value.includes(option.value));
  const full = max !== undefined && value.length >= max;

  return (
    <div>
      <label className={labelClass}>
        {label}
        <select
          value=""
          disabled={full}
          onChange={(event) => event.target.value && onChange([...value, event.target.value])}
          className={inputClass}
        >
          <option value="">{full ? `Máximo ${max}` : 'Agregar…'}</option>
          {available.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {value.map((slug) => (
          <li key={slug}>
            <button
              type="button"
              aria-label={`Quitar ${labelOf(slug)}`}
              onClick={() => onChange(value.filter((current) => current !== slug))}
              className="rounded-full border border-dex-line px-2.5 py-0.5 text-xs text-dex-ink hover:border-red-400 hover:text-red-300"
            >
              {labelOf(slug)} ×
            </button>
          </li>
        ))}
        {value.length === 0 && <li className="text-xs text-dex-muted">Ninguno</li>}
      </ul>
    </div>
  );
}
