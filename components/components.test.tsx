/** Tests de componentes: barra de búsqueda, facetas, tiles y paginación. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardTile } from '@/components/card-tile';
import { FilterPanel } from '@/components/filter-panel';
import { Pagination } from '@/components/pagination';
import { SearchBar } from '@/components/search-bar';
import { SortSelect } from '@/components/sort-select';
import { CountryBadge } from '@/components/country-badge';
import { ProfileGrid } from '@/components/profile-grid';
import { StatBars } from '@/components/stat-bars';
import { SkillList } from '@/components/skill-list';
import { SocialLinks } from '@/components/social-links';
import { DEFAULT_SEARCH } from '@/lib/query';
import { makeCard, makeFacets } from '@/test/fixtures';
import { pickCardQuality, __resetCardQuality } from '@/components/card-quality';

/**
 * Ya no hay router que envolver: los `Link` de Next no necesitan contexto y las
 * páginas reciben sus datos por props. Se mantiene el helper para no tocar las
 * llamadas de cada test (el nombre documenta la intención: render "navegable").
 */
const renderWithRouter = (ui: React.ReactElement) => render(ui);

describe('CountryBadge', () => {
  it('muestra la bandera del país y el nombre accesible', () => {
    render(<CountryBadge country={{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }} />);
    expect(screen.getByTitle('Chile')).toBeInTheDocument();
    expect(screen.getByText('Chile')).toBeInTheDocument();
  });

  it('cae a bandera neutra si el dato no la trae', () => {
    render(<CountryBadge country={{ slug: 'atlantida', name: 'Atlántida', flag: null }} />);
    expect(screen.getByTitle('Atlántida').textContent).toContain('🏳️');
  });
});

describe('SearchBar', () => {
  it('aplica debounce y comunica un único cambio', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} total={785} />);

    await user.type(screen.getByLabelText('Buscar VTuber'), 'gku');
    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange).toHaveBeenCalledWith('gku');
  });

  it('informa el total con plural correcto', () => {
    const { rerender } = render(<SearchBar value="" onChange={vi.fn()} total={785} />);
    expect(screen.getByRole('status')).toHaveTextContent('785 VTubers encontrados');
    rerender(<SearchBar value="" onChange={vi.fn()} total={1} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 VTuber encontrado');
  });

  it('el botón limpiar vacía la búsqueda', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar value="gku" onChange={onChange} total={1} />);
    await user.click(screen.getByLabelText('Limpiar búsqueda'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(''));
  });

  it('muestra el estado de carga', () => {
    render(<SearchBar value="" onChange={vi.fn()} total={0} loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Buscando…');
  });
});

describe('FilterPanel', () => {
  it('muestra los contadores reales de cada faceta', () => {
    render(
      <FilterPanel
        facets={makeFacets()}
        params={DEFAULT_SEARCH}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(screen.getByText('Chile')).toBeInTheDocument();
    expect(screen.getByText('137')).toBeInTheDocument();
    expect(screen.getByText('232')).toBeInTheDocument();
  });

  it('emite el país marcado y reinicia la página', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterPanel facets={makeFacets()} params={{ ...DEFAULT_SEARCH, page: 3 }} onChange={onChange} onReset={vi.fn()} />,
    );
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    expect(onChange).toHaveBeenCalledWith({ countries: ['chile'], page: 1 });
  });

  it('desmarca un país ya seleccionado', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterPanel
        facets={makeFacets()}
        params={{ ...DEFAULT_SEARCH, countries: ['chile', 'mexico'] }}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getAllByRole('checkbox')[0]);
    expect(onChange).toHaveBeenCalledWith({ countries: ['mexico'], page: 1 });
  });

  it('filtra por idiomas usando su código (la faceta trae `code`, no `slug`)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // Regresión: las facetas de idioma exponen `code`; si el componente usa
    // `bucket.slug` a secas, el valor es undefined, React avisa por la key y el
    // checkbox no filtra nada.
    render(
      <FilterPanel
        facets={makeFacets({
          languages: [
            { code: 'es', name: 'Español', count: 777 },
            { code: 'ja', name: '日本語', count: 3 },
          ],
        })}
        params={{ ...DEFAULT_SEARCH, languages: ['ja'] }}
        onChange={onChange}
        onReset={vi.fn()}
      />,
    );

    const japanese = screen.getByRole('checkbox', { name: /日本語/ });
    expect(japanese).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: /Español/ }));
    expect(onChange).toHaveBeenCalledWith({ languages: ['ja', 'es'], page: 1 });
  });

  it('el botón limpiar aparece solo con filtros activos', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    const { rerender } = render(
      <FilterPanel facets={makeFacets()} params={DEFAULT_SEARCH} onChange={vi.fn()} onReset={onReset} />,
    );
    expect(screen.queryByText(/Limpiar/)).not.toBeInTheDocument();

    rerender(
      <FilterPanel
        facets={makeFacets()}
        params={{ ...DEFAULT_SEARCH, countries: ['chile'], groups: ['moonly'] }}
        onChange={vi.fn()}
        onReset={onReset}
      />,
    );
    await user.click(screen.getByText('Limpiar (2)'));
    expect(onReset).toHaveBeenCalled();
  });
});

describe('SortSelect', () => {
  it('emite el orden elegido', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SortSelect value="dex" onChange={onChange} />);
    await user.selectOptions(screen.getByRole('combobox'), 'power');
    expect(onChange).toHaveBeenCalledWith('power');
  });
});

describe('CardTile', () => {
  it('enlaza al detalle y se identifica por accesibilidad', () => {
    renderWithRouter(<CardTile card={makeCard()} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/v/gkuro-monochrome');
    /**
     * El número, el nombre y el país ya NO viven en el DOM: los dibuja la textura
     * de la carta (`drawCardFront`), que es la única fuente de esos datos desde que
     * se quitó el marco exterior que los duplicaba. Lo que la tarjeta sí expone es
     * el `aria-label`, que es lo que leen los lectores de pantalla.
     */
    expect(link).toHaveAttribute('aria-label', 'GKuro Monochrome, VTuber número 18');
    expect(link).toHaveAttribute('data-dex', '18');
  });

  it('monta la vista 2D de la carta y no un marco con los mismos datos', () => {
    renderWithRouter(<CardTile card={makeCard()} />);
    const link = screen.getByRole('link');
    // La tarjeta es la vista 2D de la carta (la 3D vive en el libro, `CardBinder`);
    // lo importante es que NO añada cabecera ni pie propios: el marco exterior que
    // repetía número/nombre/país/LV ya no existe.
    expect(link.querySelector('[data-testid="holo-card-fallback"]')).not.toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('muestra el ART del personaje (la misma imagen que la carta 3D usa como textura)', () => {
    // La tarjeta 2D lleva el personaje en un `<img>`: es el respaldo del libro y lo
    // que lee un lector de pantalla; en 3D ese mismo arte es la capa 1 de la textura.
    renderWithRouter(<CardTile card={makeCard()} />);
    const art = screen.getByAltText('GKuro Monochrome');
    expect(art).toHaveAttribute('src', 'images/character/gkuro-monochrome.webp');
  });

  it('tolera cartas sin imagen', () => {
    renderWithRouter(
      <CardTile card={makeCard({ images: { card: null, thumb: null, logo: null, character: null, radar: null, background: null } })} />,
    );
    expect(screen.getByText('Sin imagen')).toBeInTheDocument();
  });
});

describe('Pagination', () => {
  it('no se renderiza con una sola página', () => {
    const { container } = render(<Pagination page={1} pageCount={1} onPage={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('navega a la página siguiente y anterior', async () => {
    const user = userEvent.setup();
    const onPage = vi.fn();
    render(<Pagination page={2} pageCount={5} onPage={onPage} />);
    await user.click(screen.getByText('Siguiente →'));
    expect(onPage).toHaveBeenCalledWith(3);
    await user.click(screen.getByText('← Anterior'));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('deshabilita los extremos y marca la página actual', () => {
    render(<Pagination page={1} pageCount={3} onPage={vi.fn()} />);
    expect(screen.getByText('← Anterior')).toBeDisabled();
    expect(screen.getByRole('button', { name: '1' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('ProfileGrid', () => {
  it('lista los campos de la ficha', () => {
    render(<ProfileGrid profile={[{ label: 'Cumpleaños', value: '23 de Mayo' }]} palette={{ accent: '#616161', secondary: '#888888' }} />);
    expect(screen.getByText('Cumpleaños')).toBeInTheDocument();
    expect(screen.getByText('23 de Mayo')).toBeInTheDocument();
  });

  it('avisa cuando no hay ficha', () => {
    render(<ProfileGrid profile={[]} palette={{ accent: '#616161', secondary: '#888888' }} />);
    expect(screen.getByText(/no tiene ficha personal publicada/)).toBeInTheDocument();
  });
});

describe('StatBars', () => {
  it('normaliza las barras contra el máximo declarado', () => {
    render(
      <StatBars
        stats={[{ label: 'HP', slug: 'hp', value: 1710, valueText: null, max: 1710, position: 0 }]}
        palette={{ accent: '#616161', secondary: '#888888' }}
        level={3}
        experience={{ current: 65, max: 500 }}
      />,
    );
    expect(screen.getByText('NIVEL 3')).toBeInTheDocument();
    expect(screen.getByText('65 / 500')).toBeInTheDocument();
    expect(screen.getByText('1710', { exact: false })).toBeInTheDocument();
  });

  it('avisa cuando no hay atributos', () => {
    render(
      <StatBars stats={[]} palette={{ accent: '#616161', secondary: '#888888' }} level={null} experience={null} />,
    );
    expect(screen.getByText(/Sin stats publicados/)).toBeInTheDocument();
  });
});

describe('SkillList', () => {
  it('agrupa por categoría y expande el efecto al hacer clic', async () => {
    const user = userEvent.setup();
    render(
      <SkillList
        skills={[
          {
            category: 'ultimate',
            section: 'Ultimate Skill',
            type: 'Ultimate',
            name: 'When Colors Fell Silent',
            effect: 'Lanzas 1d5.',
            effectHtml: 'Lanzas 1d5.',
            factions: [],
            position: 0,
          },
        ]}
        palette={{ accent: '#616161', secondary: '#888888' }}
      />,
    );
    expect(screen.getByText('Habilidad ultimate')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { expanded: false });
    await user.click(toggle);
    expect(screen.getByText('Lanzas 1d5.')).toBeInTheDocument();
  });

  it('avisa cuando no hay habilidades', () => {
    render(<SkillList skills={[]} palette={{ accent: '#616161', secondary: '#888888' }} />);
    expect(screen.getByText('Sin habilidades registradas.')).toBeInTheDocument();
  });
});

describe('SocialLinks', () => {
  it('abre las redes en pestaña nueva con rel seguro', () => {
    render(
      <SocialLinks
        socials={[{ platform: 'twitch', label: 'Twitch', url: 'https://twitch.tv/gkuro_monochrome', icon: null }]}
        palette={{ accent: '#616161', secondary: '#888888' }}
      />,
    );
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://twitch.tv/gkuro_monochrome');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
});

/**
 * Plan de calidad por dispositivo.
 *
 * Se simulan las señales del navegador porque son justo lo que decide el plan: en
 * jsdom no existen, y sin simularlas el test solo comprobaría la rama por defecto.
 * Lo que se valida en cada caso es lo que importa de verdad — que un equipo corto
 * NO reciba el mismo trabajo que uno amplio, y que ninguno se quede sin carta.
 */
describe('pickCardQuality', () => {
  /** Sustituye las señales del dispositivo y devuelve el plan resultante. */
  function planPara(señales: {
    cores?: number;
    memory?: number;
    coarse?: boolean;
    saveData?: boolean;
    reducedMotion?: boolean;
  }) {
    const original = {
      cores: Object.getOwnPropertyDescriptor(Navigator.prototype, 'hardwareConcurrency'),
      mem: Object.getOwnPropertyDescriptor(Navigator.prototype, 'deviceMemory'),
      match: window.matchMedia,
    };
    Object.defineProperty(navigator, 'hardwareConcurrency', { value: señales.cores, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', { value: señales.memory, configurable: true });
    (navigator as { connection?: unknown }).connection = { saveData: señales.saveData ?? false };
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduced-motion')
        ? Boolean(señales.reducedMotion)
        : query.includes('coarse')
          ? Boolean(señales.coarse)
          : false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;

    __resetCardQuality();
    const plan = pickCardQuality();

    Object.defineProperty(navigator, 'hardwareConcurrency', original.cores ?? { value: 4, configurable: true });
    Object.defineProperty(navigator, 'deviceMemory', original.mem ?? { value: undefined, configurable: true });
    window.matchMedia = original.match;
    __resetCardQuality();
    return plan;
  }

  it('en un equipo modesto baja textura y contextos', () => {
    const plan = planPara({ cores: 2, memory: 2 });
    expect(plan.tier).toBe('lite');
    expect(plan.textureWidth).toBe(256);
    expect(plan.maxContexts).toBeLessThanOrEqual(4);
  });

  it('en un móvil usa la textura de grilla y pocos contextos', () => {
    const plan = planPara({ cores: 8, memory: 8, coarse: true });
    expect(plan.tier).toBe('tile');
    expect(plan.dpr).toBe(1);
    // Menos que un escritorio: el techo de contextos del navegador es menor en móvil.
    expect(plan.maxContexts).toBeLessThan(planPara({ cores: 8, memory: 8 }).maxContexts);
  });

  it('en un equipo amplio sí usa la textura completa', () => {
    const plan = planPara({ cores: 16, memory: 16 });
    expect(plan.tier).toBe('full');
    expect(plan.textureWidth).toBe(1008);
  });

  it('respeta prefers-reduced-motion aunque el equipo sea potente', () => {
    // La carta se inclina siguiendo el puntero en cada frame: quien pide menos
    // movimiento no debe recibirlo, por mucha GPU que tenga.
    const plan = planPara({ cores: 16, memory: 16, reducedMotion: true });
    expect(plan.tier).toBe('static');
    expect(plan.maxContexts).toBe(0);
  });

  it('respeta el ahorro de datos como señal de «menos trabajo»', () => {
    const plan = planPara({ cores: 16, memory: 16, saveData: true });
    expect(plan.tier).toBe('lite');
  });

  it('sin señales del navegador no deja la carta sin pintar', () => {
    // SSR y navegadores viejos: el plan debe seguir existiendo y ser el más liviano.
    const plan = planPara({ cores: undefined, memory: undefined });
    expect(plan.tier).toBeTruthy();
    expect(plan.textureWidth).toBeGreaterThan(0);
  });
});
