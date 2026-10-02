'use client';
/** Paso 3: color de marca y facciones (hasta 2, con emblema). */
import type { FactionRow } from '@/lib/types';
import { FactionPicker } from '@/components/admin/faction-picker';
import { BRAND_SWATCHES } from '@/components/admin/suggestions';
import type { StepProps } from '@/components/admin/steps/types';
import { Field, ghostButton, inputClass } from '@/components/admin/ui';

export function ColorsStep({ form, set, factions, onCreateFaction }: StepProps & { factions: FactionRow[]; onCreateFaction: () => void }) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(form.themeColor);
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <p className="text-sm text-dex-muted">El color de marca tiñe la carta, los chips y los bordes. Elige una muestra o uno propio.</p>
        <ul className="flex flex-wrap gap-2" aria-label="Muestras de color">
          {BRAND_SWATCHES.map((color) => (
            <li key={color}>
              <button
                type="button"
                aria-label={`Color ${color}`}
                aria-pressed={form.themeColor.toLowerCase() === color}
                onClick={() => set('themeColor', color)}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-dex-void ${form.themeColor.toLowerCase() === color ? 'ring-white' : 'ring-transparent'}`}
                style={{ background: color }}
              />
            </li>
          ))}
        </ul>
        <Field label="Color de marca" hint={valid ? undefined : 'Debe ser un color #rrggbb, por ejemplo #3b82f6.'}>
          <span className="mt-1 flex items-center gap-2">
            <input
              type="color"
              aria-label="Selector de color"
              value={valid ? form.themeColor : '#5eead4'}
              onChange={(event) => set('themeColor', event.target.value)}
              className="h-9 w-12 rounded border border-dex-line bg-dex-void"
            />
            <input
              value={form.themeColor}
              onChange={(event) => set('themeColor', event.target.value)}
              className="w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-xs text-dex-ink outline-none focus:border-dex-accent"
            />
          </span>
        </Field>
        <Field label="Color secundario (nombre, opcional)">
          <input value={form.secondaryColor} onChange={(event) => set('secondaryColor', event.target.value)} className={inputClass} placeholder="Blanco/Negro" />
        </Field>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-dex-ink">Facciones</h3>
        <p className="text-sm text-dex-muted">Elige hasta 2. Su emblema aparece en la cabecera de la carta.</p>
        <FactionPicker factions={factions} value={form.factions} onChange={(next) => set('factions', next)} />
        <button type="button" className={ghostButton} onClick={onCreateFaction}>
          ¿No está? Crea una facción
        </button>
      </section>
    </div>
  );
}
