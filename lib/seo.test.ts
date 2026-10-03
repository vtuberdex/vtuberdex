import { describe, expect, it } from 'vitest';

import {
  descripcionDeFicha,
  jsonLdDeFicha,
  jsonLdDelIndice,
  rutaDeFicha,
  serializarJsonLd,
  siteUrl,
  tituloDeFicha,
  urlAbsoluta,
} from '@/lib/seo';

const ficha = {
  name: 'GKuro Monochrome',
  slug: 'gkuro-monochrome',
  dexNumber: 7,
  phrase: 'Blanco y negro, siempre',
  level: 3,
  birthday: null,
  countries: [{ slug: 'chile', name: 'Chile', flag: null }],
  groups: ['Los Monocromos'],
  factions: ['Netherbane', 'Mythical Legacy'],
  languages: ['es'],
  skills: [{ name: 'Golpe gris' }, { name: null }],
  socials: [{ platform: 'twitch', label: null, url: 'https://twitch.tv/gkuro', icon: null }],
  images: { character: '/images/character/gkuro-monochrome.webp' },
} as never;

describe('siteUrl', () => {
  it('prefiere SITE_URL y quita la barra final', () => {
    expect(siteUrl({ SITE_URL: 'https://dex.example/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' })).toBe(
      'https://dex.example',
    );
  });
  it('usa el dominio de producción de Vercel y, sin nada, localhost', () => {
    expect(siteUrl({ VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' })).toBe('https://x.vercel.app');
    expect(siteUrl({})).toBe('http://localhost:3000');
  });
  it('urlAbsoluta une base y ruta con una sola barra', () => {
    expect(urlAbsoluta('/v/a', 'https://h')).toBe('https://h/v/a');
    expect(urlAbsoluta('v/a', 'https://h')).toBe('https://h/v/a');
  });
});

describe('ficha', () => {
  it('título igual al que pone el cliente (sin sufijo, lo añade la plantilla)', () => {
    expect(tituloDeFicha(ficha)).toBe('GKuro Monochrome');
  });
  it('descripción con país, frase, facciones y habilidades, ≤160 caracteres', () => {
    const d = descripcionDeFicha(ficha);
    expect(d).toContain('GKuro Monochrome');
    expect(d).toContain('Chile');
    expect(d).toContain('#007');
    expect(d).toContain('Golpe gris');
    expect(d.length).toBeLessThanOrEqual(160);
  });
  it('recorta sin partir palabras', () => {
    const larga = { ...(ficha as object), phrase: 'palabra '.repeat(60) } as never;
    const d = descripcionDeFicha(larga);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith('…')).toBe(true);
  });
  it('JSON-LD: URLs absolutas, persona e imagen; omite lo que no existe', () => {
    const ld = jsonLdDeFicha(ficha, 'https://h');
    const persona = ld['@graph'][1] as Record<string, unknown>;
    expect(ld['@graph'][0]).toMatchObject({ '@type': 'ProfilePage', url: 'https://h/v/gkuro-monochrome' });
    expect(persona.image).toBe('https://h/images/character/gkuro-monochrome.webp');
    expect(persona.sameAs).toEqual(['https://twitch.tv/gkuro']);
    const sinNada = jsonLdDeFicha(
      { ...(ficha as object), countries: [], groups: [], socials: [], phrase: null, images: { character: null } } as never,
      'https://h',
    );
    const p = sinNada['@graph'][1] as Record<string, unknown>;
    expect(p).not.toHaveProperty('image');
    expect(p).not.toHaveProperty('sameAs');
    expect(p).not.toHaveProperty('nationality');
  });
  it('rutaDeFicha codifica el slug', () => {
    expect(rutaDeFicha('a b')).toBe('/v/a%20b');
  });
});

describe('índice', () => {
  it('lista las fichas con posición y URL absoluta', () => {
    const ld = jsonLdDelIndice([{ slug: 'a', name: 'A' }], 'https://h');
    expect(ld['@graph'][1]).toMatchObject({
      itemListElement: [{ position: 1, name: 'A', url: 'https://h/v/a' }],
    });
  });
});

describe('serializarJsonLd', () => {
  it('escapa < para que un nombre no cierre el script', () => {
    const s = serializarJsonLd({ name: '</script><b>' });
    expect(s).not.toContain('<');
    expect(JSON.parse(s).name).toBe('</script><b>');
  });
});
