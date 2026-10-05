'use client';
/** Ficha personal (cumpleaños, altura, gustos…). */
import { useI18n } from '@/lib/i18n';
import { etiquetaDePerfil } from '@/lib/i18n/nombres';
import type { ProfileField } from '@/lib/types';

export interface ProfileGridProps {
  profile: ProfileField[];
  palette: { accent: string; secondary: string };
}

export function ProfileGrid({ profile, palette }: ProfileGridProps) {
  const { t, locale } = useI18n();
  if (profile.length === 0) {
    return (
      <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">{t('perfil.titulo')}</h2>
        <p className="mt-3 text-sm text-dex-muted">{t('perfil.vacio')}</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5" data-testid="profile-grid">
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">{t('perfil.titulo')}</h2>
      <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {profile.map((field) => (
          <div key={`${field.label}-${field.value}`} className="min-w-0">
            <dt className="text-[11px] uppercase tracking-[0.12em]" style={{ color: palette.accent }}>
              {etiquetaDePerfil(locale, field.label)}
            </dt>
            <dd className="mt-0.5 whitespace-pre-line break-words text-sm text-dex-ink/90">{field.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default ProfileGrid;
