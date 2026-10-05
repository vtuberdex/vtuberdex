/** Tests de componentes: barra de búsqueda, facetas, tiles y paginación. */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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
import { makeFacets } from '@/test/fixtures';

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
  it('arranca con todos los grupos colapsados', () => {
    render(<FilterPanel facets={makeFacets()} params={DEFAULT_SEARCH} onChange={vi.fn()} onReset={vi.fn()} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByRole('button', { name: /País/ })).toHaveAttribute('aria-expanded', 'false');
  });

  it('muestra los contadores reales de cada faceta', async () => {
    const user = userEvent.setup();
    render(
      <FilterPanel
        facets={makeFacets()}
        params={DEFAULT_SEARCH}
        onChange={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /País/ }));
    await user.click(screen.getByRole('button', { name: /Idioma/ }));
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
    await user.click(screen.getByRole('button', { name: /País/ }));
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
    await user.click(screen.getByRole('button', { name: /País/ }));
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

    await user.click(screen.getByRole('button', { name: /Idioma/ }));
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

