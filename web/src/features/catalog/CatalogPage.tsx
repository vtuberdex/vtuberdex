/**
 * Catálogo: buscador + facetas + grilla de cartas.
 *
 * Responsive: en escritorio los filtros son una columna fija; en móvil viven en
 * una hoja inferior (los 785 divs del origen obligaban a hacer scroll infinito).
 */
import { useEffect, useState } from 'react';

import { activeFilterCount } from '../../lib/query';
import { CardTile } from './CardTile';
import { FilterPanel } from './FilterPanel';
import { Pagination } from './Pagination';
import { SearchBar } from './SearchBar';
import { SortSelect } from './SortSelect';
import { useVtuberSearch } from './useVtuberSearch';

const PER_PAGE_OPTIONS = [12, 24, 48, 96];

function SkeletonGrid({ count = 12 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" data-testid="skeleton-grid">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-dex-line">
          <div className="dex-skeleton h-8" />
          <div className="dex-skeleton aspect-[5/6]" />
          <div className="dex-skeleton h-8" />
        </div>
      ))}
    </div>
  );
}

export function CatalogPage() {
  const { params, data, loading, error, setParams, reset, goToPage } = useVtuberSearch();
  const [sheetOpen, setSheetOpen] = useState(false);
  const filterCount = activeFilterCount(params);

  // Bloquea el scroll del fondo cuando la hoja de filtros está abierta.
  useEffect(() => {
    document.body.style.overflow = sheetOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [sheetOpen]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        {/* Columna de filtros (escritorio). */}
        <aside className="hidden lg:sticky lg:top-6 lg:block lg:h-[calc(100vh-3rem)]">
          <FilterPanel
            facets={data?.facets ?? null}
            params={params}
            onChange={setParams}
            onReset={reset}
            loading={loading}
          />
        </aside>

        <main className="min-w-0">
          <div className="mb-5 space-y-4">
            <SearchBar
              value={params.q}
              onChange={(value) => setParams({ q: value, page: 1 })}
              total={total}
              loading={loading}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSheetOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg border border-dex-line bg-dex-panel px-3 py-1.5 text-xs text-dex-muted hover:border-dex-accent/60 hover:text-dex-ink lg:hidden"
                  aria-haspopup="dialog"
                >
                  Filtros
                  {filterCount > 0 && (
                    <span className="rounded-full bg-dex-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-dex-accent">
                      {filterCount}
                    </span>
                  )}
                </button>
                <SortSelect value={params.sort} onChange={(sort) => setParams({ sort, page: 1 })} />
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-dex-muted">
                <span className="uppercase tracking-[0.14em]">Por página</span>
                <select
                  value={params.perPage}
                  onChange={(event) => setParams({ perPage: Number(event.target.value), page: 1 })}
                  className="rounded-lg border border-dex-line bg-dex-panel px-2 py-1.5 text-xs text-dex-ink outline-none focus:border-dex-accent"
                >
                  {PER_PAGE_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* Chips de filtros activos. */}
            {filterCount > 0 && (
              <ul className="flex flex-wrap gap-2">
                {params.q && (
                  <li key="query">
                    <button
                      type="button"
                      onClick={() => setParams({ q: '', page: 1 })}
                      className="rounded-full border border-dex-accent/50 bg-dex-accent/10 px-3 py-1 text-xs text-dex-accent"
                    >
                      “{params.q}” ✕
                    </button>
                  </li>
                )}
                {(
                  [
                    ['countries', params.countries],
                    ['languages', params.languages],
                    ['factions', params.factions],
                    ['groups', params.groups],
                    ['artists', params.artists],
                  ] as const
                ).flatMap(([key, values]) =>
                  values.map((value) => (
                    <li key={`${key}:${value}`}>
                      <button
                        type="button"
                        onClick={() =>
                          setParams({ [key]: values.filter((item) => item !== value), page: 1 } as never)
                        }
                        className="rounded-full border border-dex-line bg-dex-panel px-3 py-1 text-xs text-dex-muted hover:text-dex-ink"
                      >
                        {value} ✕
                      </button>
                    </li>
                  )),
                )}
              </ul>
            )}
          </div>

          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              No se pudo cargar el catálogo: {error}
            </p>
          )}

          {loading && items.length === 0 ? (
            <SkeletonGrid count={params.perPage > 24 ? 12 : params.perPage} />
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dex-line bg-dex-panel/60 px-6 py-16 text-center">
              <p className="text-lg font-bold text-dex-ink">Sin resultados</p>
              <p className="mt-1 text-sm text-dex-muted">
                Prueba con otro nombre, un número de dex o quita algún filtro.
              </p>
              <button
                type="button"
                onClick={reset}
                className="mt-4 rounded-lg border border-dex-accent/60 px-4 py-2 text-sm text-dex-accent"
              >
                Limpiar búsqueda
              </button>
            </div>
          ) : (
            <div
              className={`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 ${
                loading ? 'opacity-60 transition-opacity' : ''
              }`}
            >
              {items.map((card, index) => (
                <CardTile key={card.id} card={card} index={index} />
              ))}
            </div>
          )}

          {data && <Pagination page={data.page} pageCount={data.pageCount} onPage={goToPage} />}
        </main>
      </div>

      {/* Hoja de filtros en móvil. */}
      {sheetOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Filtros">
          <button
            type="button"
            aria-label="Cerrar filtros"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] rounded-t-3xl border-t border-dex-line bg-dex-void p-4 pb-8">
            <FilterPanel
              facets={data?.facets ?? null}
              params={params}
              onChange={setParams}
              onReset={reset}
              loading={loading}
            />
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              className="mt-4 w-full rounded-xl bg-dex-accent px-4 py-3 text-sm font-bold text-black"
            >
              Ver {total} resultado{total === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default CatalogPage;
