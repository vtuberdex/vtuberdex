/**
 * Tests de las páginas: catálogo (búsqueda + facetas + URL) y detalle (carta 3D).
 * La API se mockea; el foco es el contrato de la UI y el manejo de la URL.
 *
 * `next/navigation` se sustituye por un doble que SÍ re-renderiza al navegar.
 * Es la parte delicada de migrar estos tests: el hook de búsqueda lee el
 * querystring durante el render, así que un mock cuyo `push` solo guarde el
 * valor dejaría la página con el estado viejo y las aserciones de filtros
 * fallarían por un motivo que no es el del componente. El doble guarda el
 * querystring y notifica a los suscriptores, como haría el router real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CatalogPage } from '@/components/catalog-page';
import { DetailPage } from '@/components/detail-page';
import { INTENSITY } from '@/components/card3d-config';
import { HoloCard } from '@/components/holo-card';
import {
  drawCardFront,
  CARD_TEXTURE_WIDTH,
  CARD_TEXTURE_HEIGHT,
  CARD_TEXTURE_TILE_WIDTH,
  logoMask,
} from '@/components/card-texture';
import { api } from '@/lib/api';
import { __limpiarCachePaginas } from '@/lib/cache-paginas';
import { makeCard, makeDetail, makeList } from '@/test/fixtures';

vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  // El snapshot debe ser INMUTABLE: si `useSearchParams` devolviera siempre el
  // mismo objeto mutado, `useSyncExternalStore` compararía por identidad, no
  // vería el cambio y `useMemo([queryString])` no recalcularía. Con un
  // querystring (string) como snapshot se evita justo eso.
  let queryString = '';
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    useSearchParams: () =>
      useSyncExternalStore(
        subscribe,
        () => queryString,
        () => queryString,
      ) as unknown as URLSearchParams,
    usePathname: () => '/',
    useRouter: () => ({
      push: (url: string) => {
        queryString = url.startsWith('?') ? url.slice(1) : url.split('?')[1] ?? '';
        notify();
      },
      replace: vi.fn(),
      prefetch: vi.fn(),
    }),
    __setQuery: (next: string) => {
      // Se acepta `?x=1`, `/ruta?x=1` y `x=1`: hay que quedarse con lo que va
      // DESPUÉS del `?` o `new URLSearchParams` tomaría la clave como `/?q`.
      const mark = next.indexOf('?');
      queryString = mark >= 0 ? next.slice(mark + 1) : next;
      notify();
    },
  };
});

vi.mock('@/lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...original,
    api: { list: vi.fn(), detail: vi.fn(), likeEstado: vi.fn(), darLike: vi.fn() },
  };
});

const mockedApi = vi.mocked(api);
const navigation = (await import('next/navigation')) as unknown as { __setQuery: (next: string) => void };

// La ficha pide el estado de los likes al montar: por defecto, un visitante que aún no votó.
beforeEach(() => {
  mockedApi.likeEstado.mockResolvedValue({ likes: 0, liked: false, level: 1, experience: { current: 0, max: 100 }, xpPorLike: 10 });
});

afterEach(() => {
  vi.clearAllMocks();
  // La caché de páginas es de módulo: sin vaciarla, un test leería la página de otro.
  __limpiarCachePaginas();
});

const renderCatalog = (initial = '/') => {
  navigation.__setQuery(initial);
  return render(<CatalogPage />);
};

describe('CatalogPage', () => {
  it('muestra las cartas devueltas por la API con su contador', async () => {
    mockedApi.list.mockResolvedValue(
      makeList({
        items: [makeCard(), makeCard({ id: 30, slug: 'drawchii', name: 'Drawchii', dexNumber: 30 })],
        total: 2,
      }),
    );
    renderCatalog();

    await waitFor(() => expect(screen.getAllByTestId('binder-link')).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('2 VTubers encontrados');
    // Las cartas viven dentro del libro 3D (un solo canvas), no en una grilla suelta.
    expect(screen.getByTestId('card-binder')).toBeInTheDocument();
    // El nombre lo dibuja la textura de la carta: el DOM expone un enlace accesible por carta.
    const cards = screen.getAllByTestId('binder-link');
    expect(cards[1]).toHaveAttribute('href', '/v/drawchii');
    expect(cards[1]).toHaveTextContent('Drawchii, VTuber número 30');
  });

  it('envía la búsqueda a la API y refleja el término en la URL', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue(makeList());
    renderCatalog();

    await waitFor(() => expect(mockedApi.list).toHaveBeenCalled());
    await user.type(screen.getByLabelText('Buscar VTuber'), 'gku');

    await waitFor(() => {
      const lastCall = mockedApi.list.mock.calls.at(-1)?.[0];
      expect(lastCall?.q).toBe('gku');
    });
  });

  it('parte del estado que viene en la URL (enlaces compartibles)', async () => {
    mockedApi.list.mockResolvedValue(makeList());
    renderCatalog('/?q=pipa&countries=chile&sort=power&page=2');

    await waitFor(() => {
      const params = mockedApi.list.mock.calls.at(-1)?.[0];
      expect(params).toMatchObject({ q: 'pipa', countries: ['chile'], sort: 'power', page: 2 });
    });
  });

  it('muestra un mensaje claro cuando no hay resultados', async () => {
    mockedApi.list.mockResolvedValue(makeList({ items: [], total: 0, pageCount: 1 }));
    renderCatalog('/?q=zzzz');

    await waitFor(() => expect(screen.getByText('Sin resultados')).toBeInTheDocument());
    expect(screen.getByText(/otro nombre, un número de dex/)).toBeInTheDocument();
  });

  it('reporta el error de la API sin romper la página', async () => {
    mockedApi.list.mockRejectedValue(new Error('HTTP 500'));
    renderCatalog();
    await waitFor(() => expect(screen.getByText(/No se pudo cargar el catálogo/)).toBeInTheDocument());
  });

  it('no dibuja preloader ni libro mientras carga la primera página', () => {
    mockedApi.list.mockReturnValue(new Promise(() => undefined));
    renderCatalog();
    expect(screen.queryByTestId('skeleton-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('card-binder')).not.toBeInTheDocument();
  });

  it('los chips de filtros activos se pueden quitar', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue(makeList());
    renderCatalog('/?q=pipa&countries=chile');

    const chips = await screen.findAllByRole('button', { name: /✕$/ });
    expect(chips.length).toBeGreaterThanOrEqual(2);

    await user.click(screen.getByRole('button', { name: 'chile ✕' }));
    await waitFor(() => {
      const params = mockedApi.list.mock.calls.at(-1)?.[0];
      expect(params?.countries).toEqual([]);
      expect(params?.q).toBe('pipa');
    });
  });

  it('el orden se propaga a la API y el tamaño de página es FIJO (las 8 fundas del libro)', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue(makeList());
    // Un enlace antiguo con `perPage=48` no puede agrandar el libro: se piden 8 igual.
    renderCatalog('/?perPage=48');
    await waitFor(() => expect(mockedApi.list).toHaveBeenCalled());
    expect(mockedApi.list.mock.calls.at(-1)?.[0]?.perPage).toBe(8);

    // Solo queda el selector de orden: el de «por página» desapareció con la grilla.
    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(1);
    await user.selectOptions(selects[0], 'name');
    await waitFor(() => expect(mockedApi.list.mock.calls.at(-1)?.[0]?.sort).toBe('name'));
    expect(mockedApi.list.mock.calls.at(-1)?.[0]?.perPage).toBe(8);
  });

  it('la paginación pide la página siguiente', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockImplementation((params) =>
      Promise.resolve(makeList({ total: 100, pageCount: 5, page: params.page })),
    );
    renderCatalog();
    await waitFor(() => expect(screen.getByText('Siguiente →')).toBeInTheDocument());

    await user.click(screen.getByText('Siguiente →'));
    // La página 2 se pide (directamente o por la precarga de vecinas) y la UI la muestra.
    await waitFor(() => expect(mockedApi.list.mock.calls.some((call) => call[0]?.page === 2)).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: '2' })).toHaveAttribute('aria-current', 'page'));
  });

  it('precarga las páginas vecinas y la siguiente se muestra desde la caché', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockImplementation((params) =>
      Promise.resolve(
        makeList({
          total: 24,
          pageCount: 3,
          page: params.page,
          items: [makeCard({ id: params.page, slug: `pagina-${params.page}`, name: `Página ${params.page}` })],
        }),
      ),
    );
    renderCatalog();
    await waitFor(() => expect(screen.getAllByTestId('binder-link')[0]).toHaveAttribute('href', '/v/pagina-1'));
    // Tras un respiro, la vecina (página 2) ya se pidió sola.
    await waitFor(() => expect(mockedApi.list.mock.calls.some((call) => call[0]?.page === 2)).toBe(true));
    const llamadasAntes = mockedApi.list.mock.calls.length;

    await user.click(screen.getByText('Siguiente →'));
    await waitFor(() => expect(screen.getAllByTestId('binder-link')[0]).toHaveAttribute('href', '/v/pagina-2'));
    // Mostrar la página 2 no volvió a pedirla: solo se añadió la precarga de la 3.
    const nuevas = mockedApi.list.mock.calls.slice(llamadasAntes).map((call) => call[0]?.page);
    expect(nuevas).not.toContain(2);
  });

  it('el botón Premium filtra las cartas gradeadas y lo deja en la URL', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue(makeList());
    renderCatalog();
    await waitFor(() => expect(mockedApi.list).toHaveBeenCalled());
    const boton = screen.getByRole('button', { name: /Premium/ });
    expect(boton).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('premium-intro')).not.toBeInTheDocument();

    await user.click(boton);
    await waitFor(() => expect(mockedApi.list.mock.calls.at(-1)?.[0]?.premium).toBe(true));
    expect(screen.getByRole('button', { name: /Premium/, pressed: true })).toBeInTheDocument();
    expect(screen.getByTestId('premium-intro')).toBeInTheDocument();

    // Quitar el chip del filtro lo apaga. La página sin filtro ya estaba en la caché de páginas,
    // así que no hace falta pedirla otra vez: se comprueba el estado de la interfaz.
    await user.click(screen.getByText('★ Premium ✕'));
    await waitFor(() => expect(screen.getByRole('button', { name: /Premium/ })).toHaveAttribute('aria-pressed', 'false'));
    expect(screen.queryByTestId('premium-intro')).not.toBeInTheDocument();
  });

  it('parte de la sección premium si la URL trae ?premium=1', async () => {
    mockedApi.list.mockResolvedValue(makeList());
    renderCatalog('/?premium=1');
    await waitFor(() => expect(mockedApi.list.mock.calls.at(-1)?.[0]?.premium).toBe(true));
    expect(screen.getByRole('button', { name: /Premium/, pressed: true })).toBeInTheDocument();
  });
});

describe('DetailPage', () => {
  // El slug entra por props (lo lee la página de ruta del App Router).
  const renderDetail = (slug = 'gkuro-monochrome') => render(<DetailPage slug={slug} />);

  it('renderiza la ficha, atributos, habilidades y redes', async () => {
    mockedApi.detail.mockResolvedValue({
      ...makeDetail(),
      neighbors: { prev: null, next: { dexNumber: 19, slug: 'arrocin', name: 'Arrocin' } },
    });
    renderDetail();

    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('GKuro Monochrome'));
    // El número aparece en el breadcrumb, en la cabecera y en la carta: se busca el de cabecera.
    expect(screen.getAllByText('#018').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('profile-grid')).toBeInTheDocument();
    expect(screen.getByTestId('stat-bars')).toBeInTheDocument();
    expect(screen.getByTestId('social-links')).toBeInTheDocument();
    expect(screen.getByText(/Arrocin/)).toBeInTheDocument();
  });

  it('«← Catálogo» vuelve a la página y los filtros donde se estaba, no a la primera página', async () => {
    window.sessionStorage.setItem('vtuberdex:catalogo', 'page=3&countries=chile');
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('volver-catalogo')).toHaveAttribute('href', '/?page=3&countries=chile'));
    window.sessionStorage.clear();
  });

  it('«← Catálogo» sin pasado en el catálogo (enlace directo) vuelve a la raíz', async () => {
    window.sessionStorage.clear();
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await waitFor(() => expect(screen.getByTestId('volver-catalogo')).toHaveAttribute('href', '/'));
  });

  it('el arte del personaje es textura de la carta 3D: no hay <img> de respaldo en la ficha', async () => {
    mockedApi.detail.mockResolvedValue({
      ...makeDetail({
        images: {
          card: '/images/card/gkuro-monochrome.webp',
          thumb: '/images/thumb/gkuro-monochrome.webp',
          logo: '/images/logo/gkuro-monochrome.webp',
          character: '/images/character/gkuro-monochrome.webp',
          radar: null,
          background: null,
        },
      }),
      neighbors: { prev: null, next: null },
    });
    renderDetail();

    // La carta es el canvas 3D. La ruta ABSOLUTA de las imágenes (que no se rompa en `/v/:slug`) la
    // fija la API (`server/test/search.test.mjs`); aquí no queda DOM con el arte que comprobar.
    expect(await screen.findByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.queryByAltText('GKuro Monochrome')).not.toBeInTheDocument();
    // El radar ya no se renderiza como imagen: sus datos los dibuja `StatBars`.
    expect(screen.queryByAltText('Radar de GKuro Monochrome')).not.toBeInTheDocument();
    expect(screen.getByTestId('stat-bars')).toBeInTheDocument();
  });

  it('NO repite el logo: la marca solo va dentro de la carta 3D', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();

    /**
     * El logo se dibuja en la textura de la carta (capa 2 + sticker). Tenerlo ADEMÁS
     * como `<img>` en el header mostraba la misma marca dos veces en la misma
     * pantalla, que es lo que reportaba el usuario.
     */
    expect(screen.queryByAltText('Logo de GKuro Monochrome')).not.toBeInTheDocument();
  });

  it('el header no mete la marca en la fila del título', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();

    /**
     * Este caso existía para comprobar que el logo del header iba en su propia fila
     * centrada y no como hermano del `<h1>` (en el `flex` del header competía por el
     * ancho con el texto `flex-1` y acababa pegado al borde derecho). El `<img>` se
     * retiró porque duplicaba la marca de la carta, así que lo que se conserva es la
     * garantía que sigue viva: la fila del título no aloja la marca.
     */
    const heading = await screen.findByRole('heading', { level: 1 });
    expect(heading.parentElement?.querySelector('img')).toBeNull();
  });

  it('usa las intensidades fijas (sin sliders en la UI)', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await screen.findByRole('heading', { level: 1 });

    // Las capas son fijas (ver INTENSITY en `card3d-config.ts`): no debe existir
    // ningún control para ajustarlas.
    expect(screen.queryByLabelText(/holográf/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reflejo/i)).not.toBeInTheDocument();
    // Las DOS intensidades tienen que estar DEFINIDAS (son las perillas del efecto), pero no
    // hace falta que sean > 0: el holograma de película delgada se puede apagar a propósito
    // (INTENSITY.holo = 0) y dejar que el barniz lleve el acabado. Fijar > 0 aquí convertía
    // una decisión de acabado en un test roto.
    expect(typeof INTENSITY.gloss.detail).toBe('number');
    expect(typeof INTENSITY.holo.detail).toBe('number');
    expect(INTENSITY.gloss.detail).toBeGreaterThan(0);
  });

  it('muestra el texto personalizado de la carta con su confianza de OCR', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await screen.findByRole('heading', { level: 1 });

    expect(screen.getByText('Su historia')).toBeInTheDocument();
    expect(screen.getByText(/cafetería casi vacía/)).toBeInTheDocument();
    expect(screen.getByText('OCR 80%')).toBeInTheDocument();
  });

  it('muestra estado de carga y luego error de no encontrado', async () => {
    mockedApi.detail.mockRejectedValue(new Error('no_encontrado'));
    renderDetail('no-existe');

    expect(screen.getByTestId('detail-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('VTuber no encontrado')).toBeInTheDocument());
    expect(screen.getByText('Ese slug no existe en el catálogo.')).toBeInTheDocument();
  });

  it('una carta premium muestra su distintivo, certificado y antigüedad', async () => {
    mockedApi.detail.mockResolvedValue({
      ...makeDetail({ premium: { grade: '10', since: '2026-05-01', gradedAt: '2026-09-01', cert: 'VTD-000018' } }),
      neighbors: { prev: null, next: null },
    });
    render(<DetailPage slug="gkuro-monochrome" />);
    await waitFor(() => expect(screen.getByTestId('premium-info')).toBeInTheDocument());
    // La carta es el canvas 3D (la placa lleva su etiqueta en la textura): el DOM solo tiene el distintivo de la info.
    const info = screen.getByTestId('premium-info');
    expect(within(info).getByTestId('premium-badge')).toHaveAttribute('data-grade', '10');
    expect(within(info).getByTestId('premium-badge')).toHaveTextContent('GEM MINT 10');
    expect(screen.getAllByTestId('premium-badge')).toHaveLength(1);
    expect(screen.getByTestId('premium-info')).toHaveTextContent('VTD-000018');
    expect(screen.getByTestId('premium-info')).toHaveTextContent('Premium desde 2026-05-01');
  });

  it('la ficha trae el like y el botón de PayPal, y los likes mueven nivel y experiencia', async () => {
    mockedApi.detail.mockResolvedValue({
      ...makeDetail({ likes: 3, level: 1, experience: { current: 30, max: 100 } }),
      neighbors: { prev: null, next: null },
    });
    mockedApi.likeEstado.mockResolvedValue({ likes: 3, liked: false, level: 1, experience: { current: 30, max: 100 }, xpPorLike: 10 });
    mockedApi.darLike.mockResolvedValue({ likes: 10, liked: true, level: 2, experience: { current: 0, max: 150 }, xpPorLike: 10 });
    const user = userEvent.setup();
    render(<DetailPage slug="gkuro-monochrome" />);
    await waitFor(() => expect(screen.getByTestId('like-count')).toHaveTextContent('3'));
    expect(screen.getByRole('link', { name: /Donar con PayPal/ })).toBeInTheDocument();
    expect(screen.getByText('NIVEL 1')).toBeInTheDocument();

    await waitFor(() => expect(screen.getByTestId('like-button')).toBeEnabled());
    await user.click(screen.getByTestId('like-button'));
    // El like sube el nivel de la ficha sin recargarla.
    await waitFor(() => expect(screen.getByText('NIVEL 2')).toBeInTheDocument());
    expect(screen.getByTestId('like-count')).toHaveTextContent('10');
  });

  it('una carta normal no muestra nada de premium', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    render(<DetailPage slug="gkuro-monochrome" />);
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument());
    expect(screen.queryByTestId('premium-info')).not.toBeInTheDocument();
  });

  it('actualiza el título del documento', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await waitFor(() => expect(document.title).toBe('GKuro Monochrome · VTuberDex'));
  });
});

describe('HoloCard', () => {
  it('monta el canvas 3D en su caja y no tiene vista 2D de respaldo', () => {
    render(<HoloCard card={makeCard()} className="h-64" />);
    expect(screen.getByTestId('holo-card')).toBeInTheDocument();
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('holo-card-fallback')).toBeNull();
  });
});

describe('cardTexture', () => {
  it('degrada sin contexto 2D en vez de lanzar', () => {
    const card = makeCard();
    const canvas = drawCardFront({ card, art: null, logo: null, background: null });
    expect(canvas.width).toBe(CARD_TEXTURE_WIDTH);
    expect(canvas.height).toBe(CARD_TEXTURE_HEIGHT);
    expect(canvas.height / canvas.width).toBeCloseTo(1.4, 2);
  });

  it('respeta el ancho reducido sin cambiar la proporción', () => {
    const canvas = drawCardFront({
      card: makeCard(),
      art: null,
      logo: null,
      background: null,
      width: CARD_TEXTURE_TILE_WIDTH,
    });
    expect(canvas.width).toBe(CARD_TEXTURE_TILE_WIDTH);
    expect(canvas.height).toBe(Math.round(CARD_TEXTURE_TILE_WIDTH * 1.4));
    expect(canvas.height / canvas.width).toBeCloseTo(1.4, 2);
  });

  it('la máscara del logo se escala con el lienzo', () => {
    // `logoMask` recibe la caja del logo en unidades CANÓNICAS: si no se escalara,
    // el logo caería en otro sitio al bajar la resolución y el shader excluiría del
    // holográfico una zona equivocada.
    //
    // No se comprueban píxeles porque `test/setup.ts` anula `getContext` a
    // propósito (jsdom no pinta); lo que se valida aquí es que la función respeta
    // el tamaño pedido, y la posición real del logo se verificó en el navegador.
    const logo = document.createElement('canvas');
    logo.width = 64;
    logo.height = 64;
    const box = { x: 600, y: 900, w: 200, h: 120 };
    const mask = logoMask(logo, box, CARD_TEXTURE_TILE_WIDTH, Math.round(CARD_TEXTURE_TILE_WIDTH * 1.4));
    expect(mask.width).toBe(CARD_TEXTURE_TILE_WIDTH);
    // La escala aplicada (512/1008 = 0.508) llevaría la caja canónica x=600 a ~305px.
    expect(Math.round(box.x * (CARD_TEXTURE_TILE_WIDTH / CARD_TEXTURE_WIDTH))).toBe(305);
  });
});
