/** Redes sociales del VTuber, con icono por plataforma. */
import type { SocialRow } from '@/lib/types';

export interface SocialLinksProps {
  socials: SocialRow[];
  palette: { accent: string; secondary: string };
}

const ICON_PATHS: Record<string, string> = {
  x: 'M3 3l7.2 9.3L3.4 21h2.1l6-7.3 5.4 7.3H21l-7.5-9.8L20.4 3h-2.1l-5.5 6.7L7.9 3H3z',
  twitter: 'M3 3l7.2 9.3L3.4 21h2.1l6-7.3 5.4 7.3H21l-7.5-9.8L20.4 3h-2.1l-5.5 6.7L7.9 3H3z',
  twitch: 'M4 3h16v10.5l-4 4h-4l-3 3H7v-3H4V3zm3 3v7h2v3l3-3h3l2-2V6H7zm4 1h2v4h-2V7zm4 0h2v4h-2V7z',
  youtube: 'M21.6 7.2c-.2-1.1-.9-1.9-2-2.1C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.4c-1.1.2-1.8 1-2 2.1C2 8.9 2 12 2 12s0 3.1.4 4.8c.2 1.1.9 1.9 2 2.1 1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4c1.1-.2 1.8-1 2-2.1.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z',
  tiktok: 'M16 3c.3 2.3 1.7 4 4 4.3v3c-1.6.1-3-.4-4.3-1.3v6.4c0 3.4-2.6 5.9-5.9 5.9A5.8 5.8 0 0 1 4 15.5c0-3.2 2.5-5.8 5.8-5.8.3 0 .6 0 .9.1v3.1a2.7 2.7 0 1 0 1.9 2.6V3H16z',
  instagram:
    'M12 2.2c-2.7 0-3 0-4.1.1-1 0-1.7.2-2.3.4-.6.2-1.1.5-1.6 1-.5.5-.8 1-1 1.6-.2.6-.4 1.3-.4 2.3C2.5 8.7 2.5 9 2.5 12s0 3.3.1 4.4c0 1 .2 1.7.4 2.3.2.6.5 1.1 1 1.6.5.5 1 .8 1.6 1 .6.2 1.3.4 2.3.4 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c1 0 1.7-.2 2.3-.4.6-.2 1.1-.5 1.6-1 .5-.5.8-1 1-1.6.2-.6.4-1.3.4-2.3.1-1.1.1-1.4.1-4.4s0-3.3-.1-4.4c0-1-.2-1.7-.4-2.3-.2-.6-.5-1.1-1-1.6-.5-.5-1-.8-1.6-1-.6-.2-1.3-.4-2.3-.4-1.1-.1-1.4-.1-4.1-.1zm0 5.1a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4zm0 7.7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z',
  discord:
    'M19.3 5.3A16 16 0 0 0 15.5 4l-.2.4c1.3.3 2.4.9 3.5 1.6a13 13 0 0 0-11 0C8.9 5.3 10 4.7 11.3 4.4L11 4a16 16 0 0 0-3.8 1.3C4.6 9 3.9 12.6 4.2 16.2c1.4 1 2.8 1.7 4.2 2.1l.5-.8c-.7-.3-1.4-.6-2-1l.4-.3a11 11 0 0 0 9.4 0l.4.3c-.6.4-1.3.7-2 1l.5.8c1.4-.4 2.8-1.1 4.2-2.1.4-4.2-.7-7.8-2.5-10.9zM9.5 14.2c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.7 1.7-1.5 1.7zm5 0c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.6 1.7-1.5 1.7z',
};

function iconFor(platform: string): string {
  return ICON_PATHS[platform] ?? ICON_PATHS.instagram;
}

export function SocialLinks({ socials, palette }: SocialLinksProps) {
  return (
    <section className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5" data-testid="social-links">
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">Redes</h2>
      <ul className="mt-3 flex flex-wrap gap-2">
        {socials.map((social) => (
          <li key={`${social.platform}-${social.url}`}>
            <a
              href={social.url}
              target="_blank"
              rel="noreferrer noopener nofollow"
              className="inline-flex items-center gap-2 rounded-xl border border-dex-line px-3 py-2 text-sm text-dex-ink/85 transition-colors hover:border-dex-accent/60"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill={palette.accent} aria-hidden>
                <path d={iconFor(social.platform)} />
              </svg>
              <span className="capitalize">{social.platform}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default SocialLinks;
