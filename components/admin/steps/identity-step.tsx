'use client';
/** Paso 1: identidad — nombre, dirección de la página, país y número en la dex. */
import type { ChipOption } from '@/components/admin/chip-picker';
import { ChipPicker } from '@/components/admin/chip-picker';
import { slugifyUrl, type EditorForm } from '@/components/admin/form-model';
import type { StepProps } from '@/components/admin/steps/types';
import { Field, ghostButton, inputClass } from '@/components/admin/ui';
import type { Dispatch, SetStateAction } from 'react';

export function IdentityStep({
  form,
  set,
  setForm,
  mode,
  nextDex,
  currentDex,
  currentSlug,
  origin,
  countryOptions,
  languageOptions,
  onNameChange,
  onSlugChange,
}: StepProps & {
  setForm: Dispatch<SetStateAction<EditorForm>>;
  mode: 'create' | 'edit';
  nextDex: number | null;
  currentDex: number | null;
  /** Dirección ya guardada (solo al editar): la anterior seguirá redirigiendo. */
  currentSlug: string | null;
  origin: string;
  countryOptions: ChipOption[];
  languageOptions: ChipOption[];
  onNameChange: (name: string) => void;
  onSlugChange: (slug: string) => void;
}) {
  const normalized = slugifyUrl(form.slug);
  const slugChanged = currentSlug !== null && normalized !== '' && normalized !== currentSlug;

  return (
    <div className="space-y-4">
      <p className="text-sm text-dex-muted">Lo básico para crear la carta. Ejemplo: nombre «Gkuro Monochrome», dirección «gkuro-monochrome».</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nombre de la carta" hint={!form.name.trim() ? 'Obligatorio.' : undefined}>
          <input autoFocus={mode === 'create'} value={form.name} onChange={(event) => onNameChange(event.target.value)} className={inputClass} aria-required />
        </Field>

        <div>
          <Field
            label="Dirección de la página"
            hint={currentSlug !== null ? `Si la cambias, la dirección anterior (/v/${currentSlug}) seguirá llevando a la nueva.` : 'Se genera sola desde el nombre; puedes cambiarla. Solo minúsculas, números y guiones.'}
          >
            <span className="mt-1 flex items-stretch">
              <span className="flex items-center rounded-l-lg border border-r-0 border-dex-line bg-dex-void/60 px-3 font-mono text-xs text-dex-muted">/v/</span>
              <input
                aria-label="Dirección de la página"
                value={form.slug}
                onChange={(event) => onSlugChange(event.target.value)}
                className="w-full rounded-r-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-sm text-dex-ink outline-none focus:border-dex-accent"
              />
            </span>
          </Field>
          <p className="mt-1 break-all font-mono text-[11px] text-dex-muted" data-testid="slug-preview">
            {origin}/v/{normalized || '…'}
            {slugChanged && <span className="ml-2 text-amber-200">(cambio pendiente)</span>}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Field
            label="Número en la dex"
            hint="Es su posición en la lista (como en una Pokédex). Un número ocupado no se intercambia: para usarlo, mueve antes a la ficha que lo tiene a un número libre. Al guardar, el número anterior de esta carta queda libre."
          >
            <span className="mt-1 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={1}
                aria-label="Número de dex"
                value={form.dexEnd ? (nextDex ?? '') : form.dexNumber}
                onChange={(event) => setForm((current) => ({ ...current, dexNumber: event.target.value, dexEnd: false }))}
                className="w-32 rounded-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-sm text-dex-ink outline-none focus:border-dex-accent"
              />
              <button
                type="button"
                className={ghostButton}
                aria-pressed={form.dexEnd}
                onClick={() => setForm((current) => ({ ...current, dexEnd: !current.dexEnd, dexNumber: currentDex !== null ? String(currentDex) : '' }))}
              >
                Mandar al final{nextDex !== null ? ` (#${nextDex})` : ''}
              </button>
              {form.dexEnd && <span className="text-[11px] normal-case text-dex-muted">Se asignará el último número libre al guardar.</span>}
            </span>
          </Field>
        </div>

        <div className="sm:col-span-2">
          <ChipPicker label="País (opcional)" options={countryOptions} value={form.countries} onChange={(next) => set('countries', next)} max={6} />
        </div>
      </div>

      <details className="rounded-xl border border-dex-line p-3">
        <summary className="cursor-pointer text-sm font-semibold text-dex-ink">Más datos (opcional)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <ChipPicker label="Idiomas" options={languageOptions} value={form.languages} onChange={(next) => set('languages', next)} max={6} />
          <Field label="Nivel">
            <input inputMode="numeric" value={form.level} onChange={(event) => set('level', event.target.value)} className={inputClass} />
          </Field>
          <Field label="Grupos (separados por coma)">
            <input value={form.groups} onChange={(event) => set('groups', event.target.value)} className={inputClass} />
          </Field>
          <Field label="Artistas (separados por coma)">
            <input value={form.artists} onChange={(event) => set('artists', event.target.value)} className={inputClass} />
          </Field>
          {(
            [
              ['birthday', 'Cumpleaños'],
              ['height', 'Altura'],
              ['hashtag', 'Hashtag'],
              ['favoriteColor', 'Color favorito'],
            ] as const
          ).map(([key, label]) => (
            <Field key={key} label={label}>
              <input value={form[key]} onChange={(event) => set(key, event.target.value)} className={inputClass} />
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}
