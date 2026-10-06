'use client';
/** Redes sociales del VTuber, con icono por plataforma. */
import { SocialIcon } from '@/components/social-icon';
import { useI18n } from '@/lib/i18n';
import type { SocialRow } from '@/lib/types';

export interface SocialLinksProps {
  socials: SocialRow[];
  palette: { accent: string; secondary: string };
}

export function SocialLinks({ socials, palette }: SocialLinksProps) {
  const { t } = useI18n();
  return (
    <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5" data-testid="social-links">
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">{t('redes.titulo')}</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {socials.map((social) => (
          <li key={`${social.platform}-${social.url}`}>
            <a
              href={social.url}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="inline-flex items-center gap-2 rounded-xl border border-dex-line px-3 py-2 text-sm text-dex-ink/85 transition-colors hover:border-dex-accent/60"
            >
              <SocialIcon platform={social.platform} url={social.url} color={palette.accent} />
              <span className="capitalize">{social.platform}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SocialLinks;
