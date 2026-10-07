/**
 * Icono de una red social. UNA sola definición: la ficha, la cola del mantenedor, el editor y los
 * formularios públicos lo usan, así una plataforma nueva se añade aquí y aparece en todas partes.
 *
 * La plataforma es TEXTO LIBRE («Twitch», «X (Twitter)», «you tube», «twitch.tv»), así que se
 * reconoce por el nombre y, si no basta, por el dominio del enlace. Si no se reconoce sale un icono
 * de enlace genérico: antes caía al de Instagram, que mentía sobre dónde llevaba el enlace.
 */
export type RedConocida = 'x' | 'twitch' | 'youtube' | 'tiktok' | 'instagram' | 'discord' | 'facebook' | 'bluesky' | 'kick';

const TRAZOS: Record<RedConocida | 'enlace', string> = {
  x: 'M3 3l7.2 9.3L3.4 21h2.1l6-7.3 5.4 7.3H21l-7.5-9.8L20.4 3h-2.1l-5.5 6.7L7.9 3H3z',
  twitch: 'M4 3h16v10.5l-4 4h-4l-3 3H7v-3H4V3zm3 3v7h2v3l3-3h3l2-2V6H7zm4 1h2v4h-2V7zm4 0h2v4h-2V7z',
  youtube:
    'M21.6 7.2c-.2-1.1-.9-1.9-2-2.1C17.9 4.7 12 4.7 12 4.7s-5.9 0-7.6.4c-1.1.2-1.8 1-2 2.1C2 8.9 2 12 2 12s0 3.1.4 4.8c.2 1.1.9 1.9 2 2.1 1.7.4 7.6.4 7.6.4s5.9 0 7.6-.4c1.1-.2 1.8-1 2-2.1.4-1.7.4-4.8.4-4.8s0-3.1-.4-4.8zM10 15.5v-7l6 3.5-6 3.5z',
  tiktok:
    'M16 3c.3 2.3 1.7 4 4 4.3v3c-1.6.1-3-.4-4.3-1.3v6.4c0 3.4-2.6 5.9-5.9 5.9A5.8 5.8 0 0 1 4 15.5c0-3.2 2.5-5.8 5.8-5.8.3 0 .6 0 .9.1v3.1a2.7 2.7 0 1 0 1.9 2.6V3H16z',
  instagram:
    'M12 2.2c-2.7 0-3 0-4.1.1-1 0-1.7.2-2.3.4-.6.2-1.1.5-1.6 1-.5.5-.8 1-1 1.6-.2.6-.4 1.3-.4 2.3C2.5 8.7 2.5 9 2.5 12s0 3.3.1 4.4c0 1 .2 1.7.4 2.3.2.6.5 1.1 1 1.6.5.5 1 .8 1.6 1 .6.2 1.3.4 2.3.4 1.1.1 1.4.1 4.1.1s3 0 4.1-.1c1 0 1.7-.2 2.3-.4.6-.2 1.1-.5 1.6-1 .5-.5.8-1 1-1.6.2-.6.4-1.3.4-2.3.1-1.1.1-1.4.1-4.4s0-3.3-.1-4.4c0-1-.2-1.7-.4-2.3-.2-.6-.5-1.1-1-1.6-.5-.5-1-.8-1.6-1-.6-.2-1.3-.4-2.3-.4-1.1-.1-1.4-.1-4.1-.1zm0 5.1a4.7 4.7 0 1 1 0 9.4 4.7 4.7 0 0 1 0-9.4zm0 7.7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm6-7.9a1.1 1.1 0 1 1-2.2 0 1.1 1.1 0 0 1 2.2 0z',
  discord:
    'M19.3 5.3A16 16 0 0 0 15.5 4l-.2.4c1.3.3 2.4.9 3.5 1.6a13 13 0 0 0-11 0C8.9 5.3 10 4.7 11.3 4.4L11 4a16 16 0 0 0-3.8 1.3C4.6 9 3.9 12.6 4.2 16.2c1.4 1 2.8 1.7 4.2 2.1l.5-.8c-.7-.3-1.4-.6-2-1l.4-.3a11 11 0 0 0 9.4 0l.4.3c-.6.4-1.3.7-2 1l.5.8c1.4-.4 2.8-1.1 4.2-2.1.4-4.2-.7-7.8-2.5-10.9zM9.5 14.2c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.7 1.7-1.5 1.7zm5 0c-.8 0-1.5-.8-1.5-1.7 0-1 .7-1.7 1.5-1.7s1.5.8 1.5 1.7c0 1-.6 1.7-1.5 1.7z',
  facebook: 'M14 8V6.5c0-.7.2-1 1.1-1H17V2h-2.6C11.5 2 10 3.7 10 6.2V8H8v3.5h2V22h4V11.5h2.7l.3-3.5H14z',
  bluesky:
    'M12 10.8c-1.1-2.1-4-6-6.8-8C2.6.9 1.6 1.3.9 1.6.1 1.9 0 3.1 0 3.8c0 .7.4 5.6.6 6.5.8 2.7 3.7 3.7 6.4 3.4-3.9.6-7.4 2-2.8 7.1 5 5.2 6.9-1.1 7.8-4.3.9 3.2 2 9.3 7.7 4.3 4.3-4.3 1.2-6.5-2.7-7.1 2.7.3 5.6-.7 6.4-3.4.2-.9.6-5.8.6-6.5 0-.7-.1-1.9-.9-2.2-.7-.3-1.7-.7-4.3 1.2-2.8 2-5.7 5.9-6.8 8z',
  kick: 'M4 3h5v6l5-6h6l-6.5 7.5L20 21h-6l-5-6v6H4V3z',
  enlace:
    'M10.6 13.4a1 1 0 0 0 1.4 1.4l3.8-3.8a3 3 0 0 0-4.2-4.2l-1.5 1.5a1 1 0 1 0 1.4 1.4l1.5-1.5a1 1 0 0 1 1.4 1.4l-3.8 3.8zM13.4 10.6a1 1 0 0 0-1.4-1.4l-3.8 3.8a3 3 0 0 0 4.2 4.2l1.5-1.5a1 1 0 1 0-1.4-1.4l-1.5 1.5a1 1 0 0 1-1.4-1.4l3.8-3.8z',
};

/** Fragmentos que identifican cada red, en el nombre escrito o en el dominio del enlace. */
const PISTAS: Array<[RedConocida, RegExp]> = [
  ['x', /(^|[^a-z])(x|twitter)([^a-z]|$)|x\.com|twitter\.com/],
  ['twitch', /twitch/],
  ['youtube', /you\s?tu|(^|[^a-z])yt([^a-z]|$)/],
  ['tiktok', /tik\s?tok/],
  ['instagram', /insta|(^|[^a-z])ig([^a-z]|$)/],
  ['discord', /discord/],
  ['facebook', /face\s?book|fb\.com|(^|[^a-z])fb([^a-z]|$)/],
  ['bluesky', /blue\s?sky|bsky/],
  ['kick', /(^|[^a-z])kick([^a-z]|$)|kick\.com/],
];

/** Qué red es, o `null` si no se reconoce. Mira primero el nombre y luego el enlace. */
export function redDe(platform: string, url = ''): RedConocida | null {
  const nombre = platform.toLowerCase().trim();
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();
  for (const fuente of [nombre, host]) {
    if (!fuente) continue;
    const hallada = PISTAS.find(([, patron]) => patron.test(fuente));
    if (hallada) return hallada[0];
  }
  return null;
}

export interface SocialIconProps {
  platform: string;
  url?: string;
  className?: string;
  /** Color de relleno; por defecto el del texto que lo rodea. */
  color?: string;
}

export function SocialIcon({ platform, url = '', className = 'h-4 w-4', color }: SocialIconProps) {
  const red = redDe(platform, url);
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} fill={color ?? 'currentColor'} aria-hidden data-red={red ?? 'enlace'}>
      <path d={TRAZOS[red ?? 'enlace']} />
    </svg>
  );
}

export default SocialIcon;
