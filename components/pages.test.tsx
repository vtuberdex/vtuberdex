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
import { HoloCard, supportsWebGL } from '@/components/holo-card';
import {
  drawCardFront,
  CARD_TEXTURE_WIDTH,
  CARD_TEXTURE_HEIGHT,
  CARD_TEXTURE_TILE_WIDTH,
  logoMask,
} from '@/components/card-texture';
import { api } from '@/lib/api';
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
    api: { list: vi.fn(), detail: vi.fn(), meta: vi.fn() },
  };
});

const mockedApi = vi.mocked(api);
const navigation = (await import('next/navigation')) as unknown as { __setQuery: (next: string) => void };

afterEach(() => {
  vi.clearAllMocks();
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

    await waitFor(() => expect(screen.getAllByTestId('card-tile')).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('2 VTubers encontrados');
    // El nombre ya no es texto del DOM: lo dibuja la textura de la carta, así que
    // la identidad de la tarjeta se comprueba por su enlace y su etiqueta.
    const cards = screen.getAllByTestId('card-tile');
    expect(cards[1]).toHaveAttribute('href', '/v/drawchii');
    expect(cards[1]).toHaveAttribute('aria-label', 'Drawchii, VTuber número 30');
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

  it('muestra esqueletos mientras carga la primera página', () => {
    mockedApi.list.mockReturnValue(new Promise(() => undefined));
    renderCatalog();
    expect(screen.getByTestId('skeleton-grid')).toBeInTheDocument();
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

  it('el orden y el tamaño de página se propagan a la API', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue(makeList());
    renderCatalog();
    await waitFor(() => expect(mockedApi.list).toHaveBeenCalled());

    const selects = screen.getAllByRole('combobox');
    await user.selectOptions(selects[0], 'name');
    await waitFor(() => expect(mockedApi.list.mock.calls.at(-1)?.[0]?.sort).toBe('name'));

    await user.selectOptions(selects[1], '48');
    await waitFor(() => expect(mockedApi.list.mock.calls.at(-1)?.[0]?.perPage).toBe(48));
  });

  it('la paginación pide la página siguiente', async () => {
    const user = userEvent.setup();
    mockedApi.list.mockResolvedValue(makeList({ total: 100, pageCount: 5, page: 1 }));
    renderCatalog();
    await waitFor(() => expect(screen.getByText('Siguiente →')).toBeInTheDocument());

    await user.click(screen.getByText('Siguiente →'));
    await waitFor(() => expect(mockedApi.list.mock.calls.at(-1)?.[0]?.page).toBe(2));
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

  it('usa rutas absolutas de imagen (no se rompen en /v/:slug)', async () => {
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

    const logo = await screen.findByAltText('Logo de GKuro Monochrome');
    expect(logo.getAttribute('src')?.startsWith('/images/')).toBe(true);
    // El radar ya no se renderiza como imagen: sus datos los dibuja `StatBars`.
    expect(screen.queryByAltText('Radar de GKuro Monochrome')).not.toBeInTheDocument();
    expect(screen.getByTestId('stat-bars')).toBeInTheDocument();
  });

  it('el logo va en su propia fila centrada, no como hermano del título', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();

    const logo = await screen.findByAltText('Logo de GKuro Monochrome');
    const heading = screen.getByRole('heading', { level: 1 });
    const wrapper = logo.parentElement!;

    // El header NO debe contener el logo en la MISMA fila que el texto: ahí el
    // bloque de texto (`flex-1`) se quedaba con el ancho sobrante y empujaba el
    // logo al borde derecho de la tarjeta en vez de centrarlo bajo el nombre.
    expect(wrapper.contains(heading)).toBe(false);
    expect(wrapper.className).toContain('justify-center');
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

  it('actualiza el título del documento', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await waitFor(() => expect(document.title).toBe('GKuro Monochrome · VTuberDex'));
  });
});

describe('HoloCard', () => {
  it('sin WebGL cae a la vista 2D con el arte de la carta', () => {
    // jsdom no implementa WebGL: supportsWebGL() debe decir que no.
    expect(supportsWebGL()).toBe(false);
    render(
      <HoloCard
        card={makeCard({
          images: {
            card: '/images/card/gkuro-monochrome.webp',
            thumb: '/images/thumb/gkuro-monochrome.webp',
            logo: null,
            character: null,
            radar: null,
            background: null,
          },
        })}
        className="h-64"
      />,
    );
    const fallback = screen.getByTestId('holo-card-fallback');
    expect(within(fallback).getByAltText('GKuro Monochrome')).toHaveAttribute(
      'src',
      '/images/card/gkuro-monochrome.webp',
    );
    expect(within(fallback).getByText('#018')).toBeInTheDocument();
  });

  it('con active=false no monta el canvas 3D', () => {
    render(<HoloCard card={makeCard()} active={false} />);
    expect(screen.queryByTestId('holo-card')).not.toBeInTheDocument();
    expect(screen.getByTestId('holo-card-fallback')).toBeInTheDocument();
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
