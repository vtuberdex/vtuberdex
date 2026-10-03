'use client';
/**
 * Catálogo: buscador + facetas + libro de cartas.
 *
 * Las 8 cartas de la página se muestran como un álbum abierto (dos hojas de 4 fundas)
 * en UN solo canvas WebGL (`CardBinder`); pasar de página es un giro de hoja. El
 * tamaño de página es fijo (8 = las dos hojas), así que ya no hay selector «por
 * página»: ver `use-vtuber-search.ts`.
 *
 * Responsive: en escritorio los filtros son una columna fija; en móvil viven en
 * una hoja inferior (los 785 divs del origen obligaban a hacer scroll infinito).
 */
import { Fragment, useEffect, useState } from 'react';

import { activeFilterCount } from '@/lib/query';
import { CardBinder } from '@/components/card-binder';
import { BINDER } from '@/components/card3d-config';
import { FilterPanel } from '@/components/filter-panel';
import { Pagination } from '@/components/pagination';
import { SearchBar } from '@/components/search-bar';
import { SortSelect } from '@/components/sort-select';
import { useSingleSheet } from '@/components/use-single-sheet';
import { useVtuberSearch } from '@/components/use-vtuber-search';

/**
 * Libro fantasma mientras carga.
 *
 * Tiene la MISMA forma que el libro real (dos hojas de 2x2 fundas con proporción de
 * carta 5/7): si divergieran, al llegar los datos el libro saltaría de sitio. El
 * `data-testid` se conserva de la grilla anterior porque es el contrato que fijan los
 * tests («muestra esqueletos mientras carga»).
 */
function SkeletonBook({ single = false }: { single?: boolean }) {
  return (
    <div
      className={single ? 'rounded-2xl p-3' : 'grid grid-cols-[1fr_12px_1fr] gap-2 rounded-2xl p-3'}
      style={{ background: BINDER.coverColor }}
      data-testid="skeleton-grid"
    >
      {(single ? ['derecha'] : ['izquierda', 'derecha']).map((side, position) => (
        <Fragment key={side}>
          {position === 1 && <div aria-hidden className="rounded-full bg-black/60" />}
          <div className="grid grid-cols-2 gap-3 rounded-xl p-3" style={{ background: BINDER.pageColor }}>
            {Array.from({ length: BINDER.cardsPerPage }, (_, index) => (
              <div key={index} className="overflow-hidden rounded-2xl border border-dex-line">
                <div className="dex-skeleton aspect-[5/7]" />
              </div>
            ))}
          </div>
        </Fragment>
      ))}
    </div>
  );
}

export function CatalogPage() {
  // En celular el libro es UNA hoja de 4 fundas: cada página son 4 cartas (ver `useSingleSheet`).
  const single = useSingleSheet();
  const { params, data, loading, error, setParams, reset, goToPage } = useVtuberSearch({
    perPage: single ? BINDER.cardsPerPage : BINDER.cardsPerPage * 2,
  });
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

            <div className="flex flex-wrap items-center gap-3">
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
                {/*
                  Sección premium: las cartas gradeadas (en placa de acrílico). Es un filtro más,
                  así que vive en la URL (`?premium=1`) y un enlace compartido la conserva.
                */}
                <button
                  type="button"
                  aria-pressed={params.premium}
                  onClick={() => setParams({ premium: !params.premium, page: 1 })}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                    params.premium
                      ? 'border-amber-300/70 bg-amber-300/15 text-amber-200'
                      : 'border-dex-line bg-dex-panel text-dex-muted hover:border-amber-300/50 hover:text-amber-200'
                  }`}
                >
                  <span aria-hidden>★</span> Premium
                </button>
              </div>

            </div>

            {/* Chips de filtros activos. */}
            {filterCount > 0 && (
              <ul className="flex flex-wrap gap-2">
                {params.premium && (
                  <li key="premium">
                    <button
                      type="button"
                      onClick={() => setParams({ premium: false, page: 1 })}
                      className="rounded-full border border-amber-300/50 bg-amber-300/10 px-3 py-1 text-xs text-amber-200"
                    >
                      ★ Premium ✕
                    </button>
                  </li>
                )}
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

          {params.premium && (
            <p data-testid="premium-intro" className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/5 px-4 py-3 text-sm text-dex-muted">
              <span className="font-bold text-amber-200">Cartas premium.</span> VTubers que apoyan el proyecto: su carta se
              guarda gradeada en una placa de acrílico y sube de grado (8 → 10 → Black Label) mientras siguen apoyando.
            </p>
          )}

          {error && (
            <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
              No se pudo cargar el catálogo: {error}
            </p>
          )}

          {loading && items.length === 0 ? (
            <SkeletonBook single={single} />
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
            /*
              `page` sale de la URL (cambia al instante) y `pageCount` de la respuesta: el
              libro necesita saber hacia dónde gira ANTES de que lleguen los datos de la
              página nueva, y mientras tanto mantiene la hoja en pie.
            */
            <CardBinder
              items={items}
              single={single}
              page={params.page}
              pageCount={data?.pageCount ?? 1}
              loading={loading}
              onPage={goToPage}
            />
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
