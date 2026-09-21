/**
 * Tests de las páginas: catálogo (búsqueda + facetas + URL) y detalle (carta 3D).
 * La API se mockea; el foco es el contrato de la UI y el manejo de la URL.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { CatalogPage } from './catalog/CatalogPage';
import { DetailPage, GLOSS_INTENSITY, HOLO_INTENSITY } from './detail/DetailPage';
import { HoloCard, supportsWebGL } from './card3d/HoloCard';
import { drawCardFront, CARD_TEXTURE_WIDTH, CARD_TEXTURE_HEIGHT } from './card3d/cardTexture';
import { api } from '../lib/api';
import { makeCard, makeDetail, makeList } from '../test/fixtures';

vi.mock('../lib/api', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/api')>();
  return {
    ...original,
    api: { list: vi.fn(), detail: vi.fn(), meta: vi.fn() },
  };
});

const mockedApi = vi.mocked(api);

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
});

const renderCatalog = (initial = '/') =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/" element={<CatalogPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('CatalogPage', () => {
  it('muestra las cartas devueltas por la API con su contador', async () => {
    mockedApi.list.mockResolvedValue(makeList({ items: [makeCard(), makeCard({ id: 30, slug: 'drawchii', name: 'Drawchii', dexNumber: 30 })] , total: 2 }));
    renderCatalog();

    await waitFor(() => expect(screen.getAllByTestId('card-tile')).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent('2 VTubers encontrados');
    expect(screen.getByText('Drawchii')).toBeInTheDocument();
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
  const renderDetail = (slug = 'gkuro-monochrome') =>
    render(
      <MemoryRouter initialEntries={[`/v/${slug}`]}>
        <Routes>
          <Route path="/v/:slug" element={<DetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

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
          radar: '/images/radar/gkuro-monochrome.webp',
        },
      }),
      neighbors: { prev: null, next: null },
    });
    renderDetail();

    const logo = await screen.findByAltText('Logo de GKuro Monochrome');
    expect(logo.getAttribute('src')?.startsWith('/images/')).toBe(true);
    expect(screen.getByAltText('Radar de GKuro Monochrome')).toHaveAttribute('src', '/images/radar/gkuro-monochrome.webp');
  });

  it('usa las intensidades fijas (sin sliders en la UI)', async () => {
    mockedApi.detail.mockResolvedValue({ ...makeDetail(), neighbors: { prev: null, next: null } });
    renderDetail();
    await screen.findByRole('heading', { level: 1 });

    // Las capas son fijas: no debe existir ningún control para ajustarlas.
    expect(screen.queryByLabelText(/holográf/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/reflejo/i)).not.toBeInTheDocument();
    expect(GLOSS_INTENSITY).toBeGreaterThan(0);
    expect(HOLO_INTENSITY).toBeGreaterThan(0);
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
          },
        })}
        className="h-64"
      />,
    );
    const fallback = screen.getByTestId('holo-card-fallback');
    expect(within(fallback).getByAltText('GKuro Monochrome')).toHaveAttribute('src', '/images/card/gkuro-monochrome.webp');
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
    const canvas = drawCardFront({ card, art: null, logo: null });
    // Se valida la PROPORCIÓN, no números mágicos: el lienzo debe ser el de una
    // carta coleccionable (1.4), el mismo que el CSS `aspect-[5/7]` y el asset.
    expect(canvas.width).toBe(CARD_TEXTURE_WIDTH);
    expect(canvas.height).toBe(CARD_TEXTURE_HEIGHT);
    expect(canvas.height / canvas.width).toBeCloseTo(1.4, 2);
  });
});
