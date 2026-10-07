import { describe, expect, it } from 'vitest';

import { NAVEGADORES, SISTEMAS, clasificarUserAgent } from './user-agent.mjs';

// User-Agents reales (recortados a lo que importa para clasificar).
const UA = {
  chromeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  firefoxLinux: 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  safariIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  chromeIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
  firefoxIphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/130.0 Mobile/15E148 Safari/605.1.15',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  operaWin: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/110.0.0.0',
  chromeOs: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  edgeAndroid: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 EdgA/141.0.0.0',
  googlebot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  headless: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.0.0 Safari/537.36',
};

describe('clasificarUserAgent: navegador y sistema', () => {
  it.each([
    ['chromeWin', 'chrome', 'windows'],
    ['edgeWin', 'edge', 'windows'],
    ['firefoxLinux', 'firefox', 'linux'],
    ['safariMac', 'safari', 'macos'],
    ['safariIphone', 'safari', 'ios'],
    ['chromeIphone', 'chrome', 'ios'],
    ['firefoxIphone', 'firefox', 'ios'],
    ['chromeAndroid', 'chrome', 'android'],
    ['samsung', 'samsung', 'android'],
    ['operaWin', 'opera', 'windows'],
    ['chromeOs', 'chrome', 'chromeos'],
    ['chromeMac', 'chrome', 'macos'],
    ['edgeAndroid', 'edge', 'android'],
    ['headless', 'chrome', 'linux'],
  ] as const)('%s → %s en %s', (clave, navegador, so) => {
    expect(clasificarUserAgent(UA[clave])).toMatchObject({ navegador, so, robot: false });
  });

  it('un iPhone NO es un Mac aunque su UA diga «like Mac OS X», y Edge/Opera/Samsung NO son «Chrome»', () => {
    expect(clasificarUserAgent(UA.safariIphone).so).toBe('ios');
    for (const k of ['edgeWin', 'operaWin', 'samsung', 'edgeAndroid'] as const) expect(clasificarUserAgent(UA[k]).navegador).not.toBe('chrome');
  });

  it('los robots se reconocen y los navegadores reales no se confunden con robots', () => {
    expect(clasificarUserAgent(UA.googlebot).robot).toBe(true);
    for (const k of ['chromeWin', 'safariIphone', 'firefoxLinux', 'samsung', 'headless'] as const) expect(clasificarUserAgent(UA[k]).robot, k).toBe(false);
    for (const bot of ['curl/8.5.0', 'Twitterbot/1.0', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'python-requests/2.31', 'Mozilla/5.0 (compatible; bingbot/2.0)']) {
      expect(clasificarUserAgent(bot).robot, bot).toBe(true);
    }
  });

  it('lo vacío, raro o gigante cae en «otros» sin romperse', () => {
    for (const raro of ['', undefined, null, 42, '???', 'x'.repeat(10_000)]) {
      const r = clasificarUserAgent(raro as never);
      expect(NAVEGADORES).toContain(r.navegador);
      expect(SISTEMAS).toContain(r.so);
    }
    expect(clasificarUserAgent('')).toEqual({ navegador: 'otros', so: 'otros', robot: false });
  });

  it('solo devuelve etiquetas de las listas cerradas: nunca texto del User-Agent', () => {
    for (const ua of Object.values(UA)) {
      const r = clasificarUserAgent(ua);
      expect(NAVEGADORES).toContain(r.navegador);
      expect(SISTEMAS).toContain(r.so);
      expect(JSON.stringify(r)).not.toMatch(/Mozilla|AppleWebKit|\d{3}\./);
    }
  });
});
