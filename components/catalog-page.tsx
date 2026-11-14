// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
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
import { useCallback, useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { activeFilterCount } from "@/lib/query";
import type {
  ApiListResponse,
  Facets,
  SearchParams,
  SortKey,
} from "@/lib/types";
import { CardBinder } from "@/components/card-binder";
import { BINDER } from "@/components/card3d-config";
import { FilterPanel } from "@/components/filter-panel";
import { Pagination } from "@/components/pagination";
import { SearchBar } from "@/components/search-bar";
import { SortSelect } from "@/components/sort-select";
import { VrtonBanners } from "@/components/vrton-banners";
import { useSingleSheet } from "@/components/use-single-sheet";
import { useVtuberSearch } from "@/components/use-vtuber-search";

export function CatalogPage() {
  // En celular el libro es UNA hoja de 4 fundas: cada página son 4 cartas (ver `useSingleSheet`).
  const single = useSingleSheet();
  const { params, data, loading, error, setParams, reset, goToPage } =
    useVtuberSearch({
      perPage: single ? BINDER.cardsPerPage : BINDER.cardsPerPage * 2,
    });
  const [sheetOpen, setSheetOpen] = useState(false);
  // Premium tiene su propio botón (que también lo apaga): ni cuenta en «Filtros» ni lleva chip.
  const filterCount = activeFilterCount(params) - Number(params.premium);

  // Bloquea el scroll del fondo cuando la hoja de filtros está abierta.
  useEffect(() => {
    document.body.style.overflow = sheetOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) {
      return undefined;
    }
    const alTeclear = (e: KeyboardEvent) =>
      e.key === "Escape" && setSheetOpen(false);
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [sheetOpen]);

  const { total, facets } = resumenDe(data);

  const buscar = useCallback(
    (value: string) => setParams({ q: value, page: 1 }),
    [setParams],
  );
  const ordenar = useCallback(
    (sort: SortKey) => setParams({ sort, page: 1 }),
    [setParams],
  );
  const cerrarFiltros = useCallback(() => setSheetOpen(false), []);
  const abrirFiltros = useCallback(() => setSheetOpen(true), []);

  return (
    <div
      data-catalogo
      className="mx-auto w-full max-w-[1600px] px-4 pb-1 pt-3 sm:px-6 lg:px-8"
    >
      {/* Los filtros no ocupan una columna fija: viven en un panel que se abre a demanda
          (hoja inferior en celular, cajón lateral en escritorio) para que las cartas tengan
          el ancho completo. */}
      <VrtonBanners>
        <main className="min-w-0">
          <div className="mb-4 space-y-3">
            {/* Buscador a la izquierda; filtros, orden y Premium agrupados a la derecha. */}
            <div className="flex flex-col gap-3 md:flex-row md:items-start">
              <div className="min-w-0 flex-1">
                <SearchBar
                  value={params.q}
                  onChange={buscar}
                  total={total}
                  loading={loading}
                />
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 md:ml-auto md:h-[50px]">
                <BotonFiltros cuenta={filterCount} onAbrir={abrirFiltros} />
                <SortSelect value={params.sort} onChange={ordenar} />
                {/*
                  Sección premium: las cartas gradeadas (en placa de acrílico). Es un filtro más,
                  así que vive en la URL (`?premium=1`) y un enlace compartido la conserva. Va en
                  dorado: es el color de la placa y de su etiqueta.
                */}
                <BotonPremium activo={params.premium} setParams={setParams} />
              </div>
            </div>

            {/* Chips de filtros activos. */}
            {filterCount > 0 && (
              <ChipsDeFiltros params={params} setParams={setParams} />
            )}
          </div>

          <ResultadosDelCatalogo
            data={data}
            error={error}
            loading={loading}
            single={single}
            page={params.page}
            onPage={goToPage}
            onReset={reset}
          />
        </main>
      </VrtonBanners>

      {/* Panel de filtros: hoja inferior en celular, cajón lateral en escritorio. */}
      {sheetOpen && (
        <HojaDeFiltros
          facets={facets}
          params={params}
          setParams={setParams}
          reset={reset}
          loading={loading}
          total={total}
          onClose={cerrarFiltros}
        />
      )}
    </div>
  );
}

type SetParams = (patch: Partial<SearchParams>) => void;

/** Lo que el catálogo lee de la respuesta, con sus valores mientras aún no llega ninguna. */
function resumenDe(data: ApiListResponse | null): {
  items: ApiListResponse["items"];
  total: number;
  facets: Facets | null;
} {
  if (!data) {
    return { items: [], total: 0, facets: null };
  }
  return { items: data.items, total: data.total, facets: data.facets ?? null };
}

/** Abre la hoja de filtros; lleva cuántos hay activos. */
function BotonFiltros({
  cuenta,
  onAbrir,
}: Readonly<{ cuenta: number; onAbrir: () => void }>) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="inline-flex items-center gap-2 rounded-lg border border-dex-line bg-dex-panel px-3 py-1.5 text-xs text-dex-muted hover:border-dex-accent/60 hover:text-dex-ink"
      aria-haspopup="dialog"
    >
      {t("filtros.titulo")}
      {cuenta > 0 && (
        <span className="rounded-full bg-dex-accent/20 px-1.5 py-0.5 font-mono text-[10px] text-dex-accent">
          {cuenta}
        </span>
      )}
    </button>
  );
}

/** Error, libro (o «sin resultados») y paginación. */
function ResultadosDelCatalogo({
  data,
  error,
  loading,
  single,
  page,
  onPage,
  onReset,
}: Readonly<{
  data: ApiListResponse | null;
  error: string | null;
  loading: boolean;
  single: boolean;
  page: number;
  onPage: (page: number) => void;
  onReset: () => void;
}>) {
  const { t } = useI18n();
  const { items } = resumenDe(data);
  return (
    <>
      {error && (
        <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {t("catalogo.error", { error })}
        </p>
      )}

      {/* Sin preloader: mientras llega la primera página no se dibuja nada en lugar del libro. */}
      {!(loading && items.length === 0) &&
        (items.length === 0 ? (
          <SinResultados onReset={onReset} />
        ) : (
          /*
            `page` sale de la URL (cambia al instante) y `pageCount` de la respuesta: el
            libro necesita saber hacia dónde gira ANTES de que lleguen los datos de la
            página nueva, y mientras tanto mantiene la hoja en pie.
          */
          <CardBinder
            items={items}
            single={single}
            page={page}
            pageCount={data?.pageCount ?? 1}
            loading={loading}
            onPage={onPage}
          />
        ))}

      {data && (
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          onPage={onPage}
        />
      )}
    </>
  );
}

/** Un chip por filtro activo (la búsqueda y cada valor de faceta); pulsarlo quita ese filtro. */
function ChipsDeFiltros({
  params,
  setParams,
}: Readonly<{ params: SearchParams; setParams: SetParams }>) {
  return (
    <ul className="flex flex-wrap gap-2">
      {params.q && (
        <li key="query">
          <button
            type="button"
            onClick={() => setParams({ q: "", page: 1 })}
            className="rounded-full border border-dex-accent/50 bg-dex-accent/10 px-3 py-1 text-xs text-dex-accent"
          >
            “{params.q}” ✕
          </button>
        </li>
      )}
      {(
        [
          ["countries", params.countries],
          ["languages", params.languages],
          ["factions", params.factions],
          ["groups", params.groups],
          ["artists", params.artists],
        ] as const
      ).flatMap(([key, values]) =>
        values.map((value) => (
          <li key={`${key}:${value}`}>
            <button
              type="button"
              onClick={() =>
                setParams({
                  [key]: values.filter((item) => item !== value),
                  page: 1,
                } as never)
              }
              className="rounded-full border border-dex-line bg-dex-panel px-3 py-1 text-xs text-dex-muted hover:text-dex-ink"
            >
              {value} ✕
            </button>
          </li>
        )),
      )}
    </ul>
  );
}

function BotonPremium({
  activo,
  setParams,
}: Readonly<{ activo: boolean; setParams: SetParams }>) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-pressed={activo}
      onClick={() => setParams({ premium: !activo, page: 1 })}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors ${
        activo
          ? "border-amber-200 bg-gradient-to-b from-amber-200 to-amber-400 text-amber-950 shadow-[0_0_14px_rgb(251_191_36/0.45)]"
          : "border-amber-400/70 bg-amber-400/10 text-amber-300 hover:bg-amber-400/20 hover:text-amber-200"
      }`}
    >
      <span aria-hidden>★</span> {t("catalogo.premium")}
    </button>
  );
}

function SinResultados({ onReset }: Readonly<{ onReset: () => void }>) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-dex-line bg-dex-panel/60 px-6 py-16 text-center">
      <p className="text-lg font-bold text-dex-ink">
        {t("catalogo.sinResultados")}
      </p>
      <p className="mt-1 text-sm text-dex-muted">
        {t("catalogo.sinResultadosAyuda")}
      </p>
      <button
        type="button"
        onClick={onReset}
        className="mt-4 rounded-lg border border-dex-accent/60 px-4 py-2 text-sm text-dex-accent"
      >
        {t("catalogo.limpiarBusqueda")}
      </button>
    </div>
  );
}

function HojaDeFiltros({
  facets,
  params,
  setParams,
  reset,
  loading,
  total,
  onClose,
}: Readonly<{
  facets: Facets | null;
  params: SearchParams;
  setParams: SetParams;
  reset: () => void;
  loading: boolean;
  total: number;
  onClose: () => void;
}>) {
  const { t } = useI18n();
  return (
    <div
      className="fixed inset-0 z-40"
      role="dialog"
      aria-modal="true"
      aria-label={t("filtros.titulo")}
    >
      <button
        type="button"
        aria-label={t("filtros.cerrar")}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-3xl border-t border-dex-line bg-dex-void p-4 pb-8 lg:inset-y-0 lg:right-auto lg:left-0 lg:max-h-none lg:w-[380px] lg:rounded-none lg:rounded-r-3xl lg:border-r lg:border-t-0 lg:pb-4">
        <FilterPanel
          facets={facets}
          params={params}
          onChange={setParams}
          onReset={reset}
          loading={loading}
        />
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded-xl bg-dex-accent px-4 py-3 text-sm font-bold text-black"
        >
          {t("filtros.verResultados", { n: total })}
        </button>
      </div>
    </div>
  );
}

export default CatalogPage;
