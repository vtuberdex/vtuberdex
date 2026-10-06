import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { SocialIcon, redDe } from '@/components/social-icon';

describe('redDe', () => {
  test.each([
    ['Twitch', '', 'twitch'],
    ['X (Twitter)', '', 'x'],
    ['you tube', '', 'youtube'],
    ['TikTok', '', 'tiktok'],
    ['IG', '', 'instagram'],
    ['Bluesky', '', 'bluesky'],
    ['Kick', '', 'kick'],
    ['Mi canal', 'https://www.twitch.tv/luna', 'twitch'],
    ['Perfil', 'https://x.com/luna', 'x'],
  ])('%s (%s) → %s', (platform, url, esperada) => {
    expect(redDe(platform, url)).toBe(esperada);
  });

  test('lo desconocido no se hace pasar por otra red', () => {
    expect(redDe('Mi web', 'https://luna.example')).toBeNull();
    const { container } = render(<SocialIcon platform="Mi web" url="https://luna.example" />);
    expect(container.querySelector('svg')?.getAttribute('data-red')).toBe('enlace');
  });
});
