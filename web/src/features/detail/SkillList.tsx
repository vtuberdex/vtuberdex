/** Habilidades agrupadas por categoría (activas, pasivas, ultimate). */
import { useState } from 'react';

import type { SkillRow } from '../../lib/types';

const CATEGORY_LABEL: Record<SkillRow['category'], string> = {
  active: 'Habilidades activas',
  passive: 'Habilidades pasivas',
  ultimate: 'Habilidad ultimate',
  other: 'Otras habilidades',
};

const ORDER: Array<SkillRow['category']> = ['active', 'passive', 'ultimate', 'other'];

export interface SkillListProps {
  skills: SkillRow[];
  palette: { accent: string; secondary: string };
}

export function SkillList({ skills, palette }: SkillListProps) {
  const [open, setOpen] = useState<string | null>(skills[0]?.name ?? null);

  if (skills.length === 0) {
    return (
      <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">Habilidades</h2>
        <p className="mt-3 text-sm text-dex-muted">Sin habilidades registradas.</p>
      </section>
    );
  }

  const grouped = ORDER.map((category) => ({
    category,
    items: skills.filter((skill) => skill.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <section className="space-y-5" data-testid="skill-list">
      {grouped.map((group) => (
        <div key={group.category} className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em]" style={{ color: palette.accent }}>
            {CATEGORY_LABEL[group.category]}
          </h2>
          <ul className="mt-3 space-y-2">
            {group.items.map((skill) => {
              const key = `${group.category}-${skill.name}-${skill.position}`;
              const expanded = open === key;
              return (
                <li key={key} className="rounded-xl border border-dex-line/80 bg-black/25">
                  <button
                    type="button"
                    onClick={() => setOpen(expanded ? null : key)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-dex-ink">{skill.name ?? 'Sin nombre'}</span>
                      {skill.type && (
                        <span className="mt-0.5 block text-[11px] uppercase tracking-[0.12em] text-dex-muted">
                          {skill.type}
                        </span>
                      )}
                    </span>
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: palette.accent }}
                      aria-hidden
                    />
                    <svg
                      className={`h-4 w-4 shrink-0 text-dex-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  {expanded && skill.effect && (
                    <div className="border-t border-dex-line/70 px-4 py-3 text-sm leading-relaxed text-dex-ink/85">
                      {/* El efecto viene con <span style="color:…"> del origen: se conserva el color
                          de cada estado alterado porque es información semántica del juego. */}
                      <div dangerouslySetInnerHTML={{ __html: skill.effectHtml ?? skill.effect }} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

export default SkillList;
