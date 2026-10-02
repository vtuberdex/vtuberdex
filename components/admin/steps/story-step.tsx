'use client';
/** Paso 4: historia — frase, lore y datos de perfil con atajos. */
import { ProfileEditor } from '@/components/admin/list-sections';
import { PROFILE_SUGGESTIONS } from '@/components/admin/suggestions';
import type { StepProps } from '@/components/admin/steps/types';
import { Field, ghostButton, inputClass } from '@/components/admin/ui';

const LORE_MAX = 4000;

export function StoryStep({ form, set }: StepProps) {
  const present = new Set(form.profile.map((field) => field.label.trim().toLowerCase()));
  const missing = PROFILE_SUGGESTIONS.filter((label) => !present.has(label.toLowerCase()));
  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <Field label="Frase de presentación" hint="Una línea corta. Ejemplo: «Pixelartista y developer».">
          <textarea value={form.phrase} onChange={(event) => set('phrase', event.target.value)} rows={2} className={inputClass} />
        </Field>
        <Field label="Historia (lore)" hint={`${form.cardText.length} / ${LORE_MAX} caracteres · Cuenta quién es, de dónde viene y qué hace. 3 o 4 frases bastan.`}>
          <textarea value={form.cardText} onChange={(event) => set('cardText', event.target.value)} rows={8} maxLength={LORE_MAX} className={inputClass} />
        </Field>
      </section>
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-dex-ink">Datos de perfil</h3>
        <p className="text-sm text-dex-muted">Un clic añade un campo sugerido; después escribe su valor.</p>
        {missing.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Campos sugeridos">
            {missing.map((label) => (
              <li key={label}>
                <button type="button" className={ghostButton} onClick={() => set('profile', [...form.profile, { label, value: '' }])}>
                  + {label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <ProfileEditor items={form.profile} onChange={(next) => set('profile', next)} />
      </section>
    </div>
  );
}
