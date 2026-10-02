/** Tests de las utilidades puras: color, querystring y serialización. */
import { describe, expect, it } from 'vitest';

import {
  cardPalette,
  gradientCss,
  hexToRgb,
  luminance,
  mixHex,
  normalizeHex,
  readableInk,
  rgba,
  rgbToHex,
} from '@/lib/color';
import {
  DEFAULT_PER_PAGE,
  DEFAULT_SEARCH,
  activeFilterCount,
  searchParamsFromUrl,
  searchParamsToQuery,
  searchParamsToUrl,
  toggleValue,
} from '@/lib/query';

describe('color', () => {
  it('normaliza hex de 3 y 6 dígitos', () => {
    expect(normalizeHex('#abc')).toBe('#aabbcc');
    expect(normalizeHex('616161')).toBe('#616161');
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
  });

  it('cae al color por defecto con valores inválidos', () => {
    expect(normalizeHex('azul')).toBe('#5eead4');
    expect(normalizeHex(null)).toBe('#5eead4');
    expect(normalizeHex('', '#123456')).toBe('#123456');
  });

  it('convierte a rgb y de vuelta sin pérdida', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(rgbToHex({ r: 255, g: 136, b: 0 })).toBe('#ff8800');
    // Los canales fuera de rango se recortan.
    expect(rgbToHex({ r: 300, g: -5, b: 12.6 })).toBe('#ff000d');
  });

  it('mezcla colores en los extremos', () => {
    expect(mixHex('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mixHex('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mixHex('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('genera rgba y sombras con el acento', () => {
    expect(rgba('#ff0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(gradientCss('#ff0000', '#00ff00')).toContain('linear-gradient(135deg');
  });

  it('elige tinta legible según la luminancia', () => {
    expect(luminance('#ffffff')).toBeGreaterThan(0.55);
    expect(readableInk('#ffffff')).toBe('#0b0d12');
    expect(readableInk('#05060a')).toBe('#f8fafc');
  });

  it('construye la paleta de la carta con el color del dato', () => {
    const palette = cardPalette('#616161', 'Blanco/Negro');
    expect(palette.accent).toBe('#616161');
    // "Blanco/Negro" no es un hex válido: se mezcla desde el acento.
    expect(palette.secondary).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.deep).toMatch(/^#[0-9a-f]{6}$/);
    expect(palette.ink).toMatch(/^#(0b0d12|f8fafc)$/);
  });
});

describe('query', () => {
  it('serializa solo los filtros activos', () => {
    const query = searchParamsToQuery(DEFAULT_SEARCH);
    expect(query).toContain('sort=dex');
    expect(query).toContain('facet=all');
    expect(query).not.toContain('q=');
    expect(query).not.toContain('countries=');
  });

  it('serializa filtros, orden y paginación', () => {
    const query = searchParamsToQuery({
      ...DEFAULT_SEARCH,
      q: 'gku',
      countries: ['chile', 'mexico'],
      sort: 'power',
      page: 3,
      perPage: 48,
    });
    const parsed = Object.fromEntries(new URLSearchParams(query));
    expect(parsed.q).toBe('gku');
    expect(parsed.countries).toBe('chile,mexico');
    expect(parsed.sort).toBe('power');
    expect(parsed.page).toBe('3');
    expect(parsed.perPage).toBe('48');
  });

  it('parsea la URL y descarta valores inválidos', () => {
    const params = searchParamsFromUrl('?q=pipa&countries=chile,japon&sort=power&page=2&perPage=48&language=es');
    expect(params.q).toBe('pipa');
    expect(params.countries).toEqual(['chile', 'japon']);
    expect(params.sort).toBe('power');
    expect(params.page).toBe(2);
    expect(params.perPage).toBe(48);
    expect(params.language).toBe('es');
  });

  it('usa defaults cuando la URL trae basura', () => {
    expect(searchParamsFromUrl('?sort=inventado&page=abc&perPage=99999')).toEqual(DEFAULT_SEARCH);
    expect(searchParamsFromUrl('')).toEqual(DEFAULT_SEARCH);
  });

  it('la URL omite los valores por defecto (enlaces limpios)', () => {
    expect(searchParamsToUrl(DEFAULT_SEARCH)).toBe('/');
    expect(searchParamsToUrl({ ...DEFAULT_SEARCH, perPage: DEFAULT_PER_PAGE })).toBe('/');
    expect(searchParamsToUrl({ ...DEFAULT_SEARCH, q: 'mizuno' })).toBe('/?q=mizuno');
    expect(searchParamsToUrl({ ...DEFAULT_SEARCH, page: 4, sort: 'name' })).toBe('/?sort=name&page=4');
  });

  it('ida y vuelta URL -> params -> URL es estable', () => {
    const original = '/?q=ark&countries=chile&languages=es&sort=power&page=2';
    const params = searchParamsFromUrl(original.split('?')[1]);
    expect(searchParamsToUrl(params)).toBe(original);
  });

  it('toggleValue agrega y quita sin duplicar', () => {
    expect(toggleValue([], 'chile')).toEqual(['chile']);
    expect(toggleValue(['chile'], 'mexico')).toEqual(['chile', 'mexico']);
    expect(toggleValue(['chile', 'mexico'], 'chile')).toEqual(['mexico']);
    expect(toggleValue(['chile'], 'chile')).toEqual([]);
  });

  it('activeFilterCount cuenta filtros y búsqueda', () => {
    expect(activeFilterCount(DEFAULT_SEARCH)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_SEARCH, q: '  ' })).toBe(0);
    expect(
      activeFilterCount({ ...DEFAULT_SEARCH, q: 'gku', countries: ['chile'], groups: ['moonly', 'celestials'] }),
    ).toBe(4);
  });
});

describe('color secundario escrito como nombre', () => {
  test('un nombre en español se traduce a su color, no al cian de respaldo', async () => {
    const { cardPalette, colorDesdeNombre } = await import('@/lib/color');
    expect(colorDesdeNombre('Rojo')).toBe('#d62839');
    expect(colorDesdeNombre('Negro y Rojo')).toBe('#14161c'); // gana el primero que se menciona
    expect(colorDesdeNombre('Púrpura/Negro')).toBe('#8e44d8');
    expect(colorDesdeNombre('No especificado')).toBeNull();
    const paleta = cardPalette('#c33f00', 'Naranja');
    expect(paleta.secondary).toBe('#f07b1a');
    expect(paleta.secondary).not.toBe('#5eead4');
  });

  test('un texto irreconocible deriva del primario, como si no hubiera secundario', async () => {
    const { cardPalette } = await import('@/lib/color');
    expect(cardPalette('#c33f00', 'No especificado').secondary).toBe(cardPalette('#c33f00', null).secondary);
    expect(cardPalette('#c33f00', '#112233').secondary).toBe('#112233');
  });
});
