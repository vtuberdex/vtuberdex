/** Atajos del asistente: un clic añade lo que casi toda ficha lleva. */

export const PROFILE_SUGGESTIONS = ['Cumpleaños', 'Altura', 'Hashtag', 'Comida favorita', 'Color favorito', 'Pasatiempo', 'Debut'];

export const STANDARD_STATS = ['HP', 'MP', 'Ataque', 'Defensa', 'Ataque mágico', 'Defensa mágica', 'Velocidad'];

export const SOCIAL_SHORTCUTS: Array<{ platform: string; label: string; placeholder: string }> = [
  { platform: 'twitch', label: 'Twitch', placeholder: 'https://twitch.tv/tu_canal' },
  { platform: 'youtube', label: 'YouTube', placeholder: 'https://youtube.com/@tu_canal' },
  { platform: 'x', label: 'X', placeholder: 'https://x.com/tu_usuario' },
  { platform: 'tiktok', label: 'TikTok', placeholder: 'https://tiktok.com/@tu_usuario' },
  { platform: 'instagram', label: 'Instagram', placeholder: 'https://instagram.com/tu_usuario' },
  { platform: 'discord', label: 'Discord', placeholder: 'https://discord.gg/tu_invitacion' },
];

export function placeholderFor(platform: string): string {
  const key = platform.trim().toLowerCase();
  return SOCIAL_SHORTCUTS.find((shortcut) => shortcut.platform === key)?.placeholder ?? 'https://…';
}

export const BRAND_SWATCHES = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#e5e7eb', '#616161'];

export const SKILL_CATEGORY_HELP: Array<{ label: string; text: string }> = [
  { label: 'Activa', text: 'Se usa a voluntad durante el combate.' },
  { label: 'Pasiva', text: 'Siempre está funcionando, sin activarla.' },
  { label: 'Definitiva', text: 'La habilidad más poderosa, de uso limitado.' },
  { label: 'Otra', text: 'Cualquier cosa que no encaje en las anteriores.' },
];
