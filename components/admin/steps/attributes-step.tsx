'use client';
/** Paso 5: atributos, habilidades y redes sociales. */
import { emptyStat } from '@/components/admin/form-model';
import { SkillsEditor, SocialsEditor, StatsEditor } from '@/components/admin/list-sections';
import { SKILL_CATEGORY_HELP, SOCIAL_SHORTCUTS, STANDARD_STATS } from '@/components/admin/suggestions';
import type { StepProps } from '@/components/admin/steps/types';
import { ghostButton } from '@/components/admin/ui';

export function AttributesStep({ form, set }: StepProps) {
  const have = new Set(form.stats.map((stat) => stat.label.trim().toLowerCase()));
  const addStandard = () =>
    set('stats', [
      ...form.stats,
      ...STANDARD_STATS.filter((label) => !have.has(label.toLowerCase())).map((label) => ({ ...emptyStat(), label })),
    ]);

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-dex-ink">Atributos</h3>
        <p className="text-sm text-dex-muted">Los números que se dibujan como barras en la ficha (vida, ataque…).</p>
        <button type="button" className={ghostButton} onClick={addStandard} disabled={STANDARD_STATS.every((label) => have.has(label.toLowerCase()))}>
          Añadir atributos estándar
        </button>
        <StatsEditor items={form.stats} onChange={(next) => set('stats', next)} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-dex-ink">Habilidades</h3>
        <dl className="grid gap-x-4 gap-y-1 text-xs text-dex-muted sm:grid-cols-2">
          {SKILL_CATEGORY_HELP.map((item) => (
            <div key={item.label}>
              <dt className="inline font-semibold text-dex-ink">{item.label}: </dt>
              <dd className="inline">{item.text}</dd>
            </div>
          ))}
        </dl>
        <SkillsEditor items={form.skills} onChange={(next) => set('skills', next)} />
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-bold text-dex-ink">Redes sociales</h3>
        <p className="text-sm text-dex-muted">Los enlaces deben empezar con https://.</p>
        <ul className="flex flex-wrap gap-2" aria-label="Atajos de redes">
          {SOCIAL_SHORTCUTS.map((shortcut) => (
            <li key={shortcut.platform}>
              <button
                type="button"
                className={ghostButton}
                onClick={() => set('socials', [...form.socials, { platform: shortcut.platform, label: '', url: '', icon: '' }])}
              >
                + {shortcut.label}
              </button>
            </li>
          ))}
        </ul>
        <SocialsEditor items={form.socials} onChange={(next) => set('socials', next)} />
      </section>
    </div>
  );
}
