/**
 * Caché de páginas y precarga de vecinas: lo que hace que pasar de página no espere
 * a la red. Se prueba con un `pedir` falso que cuenta llamadas.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LIMITE_PAGINAS,
  __limpiarCachePaginas,
  __tamanoCachePaginas,
  clavePagina,
  guardarPagina,
  imagenesDeCartas,
  leerPagina,
  paginasVecinas,
  precargarVecinas,
} from '@/lib/cache-paginas';
import { DEFAULT_SEARCH } from '@/lib/query';
import { makeCard, makeList } from '@/test/fixtures';

afterEach(() => __limpiarCachePaginas());

describe('clave y LRU', () => {
  it('la clave distingue filtros, página y tamaño de página (8 escritorio, 4 celular)', () => {
    expect(clavePagina({ ...DEFAULT_SEARCH, perPage: 4 })).not.toBe(clavePagina({ ...DEFAULT_SEARCH, perPage: 8 }));
    expect(clavePagina({ ...DEFAULT_SEARCH, page: 2 })).not.toBe(clavePagina(DEFAULT_SEARCH));
    expect(clavePagina({ ...DEFAULT_SEARCH, q: 'gku' })).not.toBe(clavePagina(DEFAULT_SEARCH));
  });

  it('guarda, lee y acota el tamaño descartando lo más viejo', () => {
    for (let page = 1; page <= LIMITE_PAGINAS + 3; page += 1) {
      guardarPagina({ ...DEFAULT_SEARCH, page }, makeList({ page }));
    }
    expect(__tamanoCachePaginas()).toBe(LIMITE_PAGINAS);
    expect(leerPagina({ ...DEFAULT_SEARCH, page: 1 })).toBeUndefined();
    expect(leerPagina({ ...DEFAULT_SEARCH, page: LIMITE_PAGINAS + 3 })?.page).toBe(LIMITE_PAGINAS + 3);
  });

  it('leer una página la rejuvenece: no es la siguiente en caer', () => {
    for (let page = 1; page <= LIMITE_PAGINAS; page += 1) {
      guardarPagina({ ...DEFAULT_SEARCH, page }, makeList({ page }));
    }
    leerPagina({ ...DEFAULT_SEARCH, page: 1 });
    guardarPagina({ ...DEFAULT_SEARCH, page: LIMITE_PAGINAS + 1 }, makeList({ page: LIMITE_PAGINAS + 1 }));
    expect(leerPagina({ ...DEFAULT_SEARCH, page: 1 })).toBeDefined();
    expect(leerPagina({ ...DEFAULT_SEARCH, page: 2 })).toBeUndefined();
  });
});

describe('vecinas', () => {
  it('son la anterior y la siguiente, dentro del rango', () => {
    expect(paginasVecinas({ ...DEFAULT_SEARCH, page: 1 }, 5).map((p) => p.page)).toEqual([2]);
    expect(paginasVecinas({ ...DEFAULT_SEARCH, page: 3 }, 5).map((p) => p.page)).toEqual([2, 4]);
    expect(paginasVecinas({ ...DEFAULT_SEARCH, page: 5 }, 5).map((p) => p.page)).toEqual([4]);
    expect(paginasVecinas({ ...DEFAULT_SEARCH, page: 1 }, 1)).toEqual([]);
  });

  it('conservan los filtros de la página actual', () => {
    const [vecina] = paginasVecinas({ ...DEFAULT_SEARCH, q: 'pipa', countries: ['chile'], page: 1 }, 3);
    expect(vecina).toMatchObject({ q: 'pipa', countries: ['chile'], page: 2 });
  });
});

describe('precarga', () => {
  it('pide solo las vecinas que faltan, las guarda y calienta sus imágenes', async () => {
    const pedir = vi.fn((p: { page: number }) => Promise.resolve(makeList({ page: p.page, pageCount: 5 })));
    const calentar = vi.fn();
    guardarPagina({ ...DEFAULT_SEARCH, page: 2 }, makeList({ page: 2 }));
    await precargarVecinas({ ...DEFAULT_SEARCH, page: 3 }, 5, pedir, calentar);
    expect(pedir).toHaveBeenCalledTimes(1);
    expect(pedir.mock.calls[0][0].page).toBe(4);
    expect(leerPagina({ ...DEFAULT_SEARCH, page: 4 })?.page).toBe(4);
    // La vecina ya cacheada también se calienta: sus imágenes pueden haberse olvidado.
    expect(calentar).toHaveBeenCalledTimes(2);
  });

  it('no repite una petición que ya está en vuelo', async () => {
    let resolver: (value: ReturnType<typeof makeList>) => void = () => undefined;
    const pedir = vi.fn(() => new Promise<ReturnType<typeof makeList>>((resolve) => { resolver = resolve; }));
    const primera = precargarVecinas({ ...DEFAULT_SEARCH, page: 1 }, 2, pedir);
    const segunda = precargarVecinas({ ...DEFAULT_SEARCH, page: 1 }, 2, pedir);
    expect(pedir).toHaveBeenCalledTimes(1);
    resolver(makeList({ page: 2 }));
    await Promise.all([primera, segunda]);
    expect(leerPagina({ ...DEFAULT_SEARCH, page: 2 })).toBeDefined();
  });

  it('un fallo de red no rompe nada ni queda cacheado', async () => {
    const pedir = vi.fn(() => Promise.reject(new Error('HTTP 500')));
    await expect(precargarVecinas({ ...DEFAULT_SEARCH, page: 1 }, 2, pedir)).resolves.toBeUndefined();
    expect(leerPagina({ ...DEFAULT_SEARCH, page: 2 })).toBeUndefined();
    // Y al volver a intentar se pide otra vez (no quedó marcada en vuelo).
    await precargarVecinas({ ...DEFAULT_SEARCH, page: 1 }, 2, pedir);
    expect(pedir).toHaveBeenCalledTimes(2);
  });
});

describe('imágenes de una página', () => {
  it('reúne personaje, logo, fondo y emblemas sin duplicados ni vacíos', () => {
    const items = [
      makeCard({ id: 1, images: { ...makeCard().images, background: 'images/background/a.webp' } }),
      makeCard({ id: 2, slug: 'b', images: { ...makeCard().images, character: null, logo: null } }),
    ];
    const urls = imagenesDeCartas(items);
    expect(urls).toContain('images/character/gkuro-monochrome.webp');
    expect(urls).toContain('images/logo/gkuro-monochrome.webp');
    expect(urls).toContain('images/background/a.webp');
    expect(urls).toContain('images/faction/mythical-legacy.png');
    // La segunda carta sin personaje cae a `card`; el emblema repetido cuenta una vez.
    expect(urls).toContain('images/card/gkuro-monochrome.webp');
    expect(urls.filter((u) => u.includes('mythical-legacy'))).toHaveLength(1);
    expect(urls.every(Boolean)).toBe(true);
  });
});
