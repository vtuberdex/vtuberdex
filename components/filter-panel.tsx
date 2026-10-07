'use client';
/**
 * Panel de facetas: países, idiomas, grupos, artistas y facciones.
 * Cada grupo se pinta con su contador real y estado seleccionado, en un
 * acordeón que funciona igual en escritorio (columna) y móvil (hoja).
 */
import { useState } from 'react';

import { useI18n } from '@/lib/i18n';
import { nombreDeIdioma, nombreDePais } from '@/lib/i18n/nombres';

import type { FacetBucket, Facets, SearchParams } from '@/lib/types';
import { facetValue } from '@/lib/types';
import { toggleValue } from '@/lib/query';

interface FacetGroupProps {
  title: string;
  buckets: FacetBucket[];
  selected: string[];
  onToggle: (value: string) => void;
  initialOpen?: boolean;
  showFlag?: boolean;
  max?: number;
  /** Cómo se escribe el nombre de un bucket en el idioma activo (por defecto, el de la base). */
  nombre?: (bucket: FacetBucket) => string;
}

function FacetGroup({ title, buckets, selected, onToggle, initialOpen = false, showFlag = false, max = 14, nombre }: FacetGroupProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(initialOpen);
  const [showAll, setShowAll] = useState(false);
  if (buckets.length === 0) return null;
  const visible = showAll ? buckets : buckets.slice(0, max);

  return (
    <section className="border-b border-dex-line/70 py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">{title}</span>
        <span className="flex items-center gap-2">
          {selected.length > 0 && (
            <span className="rounded-full bg-dex-accent/15 px-2 py-0.5 font-mono text-[10px] text-dex-accent">
              {selected.length}
            </span>
          )}
          <svg
            className={`h-4 w-4 text-dex-muted transition-transform ${open ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      {open && (
        <ul className="mt-3 space-y-1">
          {visible.map((bucket) => {
            const value = facetValue(bucket);
            const active = selected.includes(value);
            return (
              <li key={value}>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors ${
                    active ? 'bg-dex-accent/12 text-dex-ink' : 'text-dex-muted hover:bg-white/5 hover:text-dex-ink'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={() => onToggle(value)}
                    className="h-3.5 w-3.5 accent-dex-accent"
                  />
                  {showFlag && <span aria-hidden>{bucket.flag?.trim() || '🏳️'}</span>}
                  <span className="min-w-0 flex-1 truncate">{nombre ? nombre(bucket) : bucket.name}</span>
                  <span className="font-mono text-[11px] text-dex-muted">{bucket.count}</span>
                </label>
              </li>
            );
          })}
          {buckets.length > max && (
            <li key="toggle-all">
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className="mt-1 px-2 text-xs text-dex-accent hover:underline"
              >
                {showAll ? t('filtros.verMenos') : t('filtros.verTodos', { n: buckets.length })}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export interface FilterPanelProps {
  facets: Facets | null;
  params: SearchParams;
  onChange: (patch: Partial<SearchParams>) => void;
  onReset: () => void;
  loading?: boolean;
}

export function FilterPanel({ facets, params, onChange, onReset, loading = false }: FilterPanelProps) {
  const { t, locale } = useI18n();
  const activeCount =
    params.countries.length + params.languages.length + params.groups.length + params.artists.length + params.factions.length;

  return (
    <div className="dex-scroll flex h-full flex-col overflow-y-auto rounded-2xl border border-dex-line bg-dex-panel/70 p-4" data-testid="filter-panel">
      <header className="flex items-center justify-between gap-2 pb-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.18em] text-dex-ink">{t('filtros.titulo')}</h2>
          <p className="text-xs text-dex-muted">
            {loading ? t('filtros.calculando') : t('filtros.enCatalogo', { n: facets?.totals.total ?? 0 })}
          </p>
        </div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-lg border border-dex-line px-2 py-1 text-xs text-dex-muted hover:border-dex-accent/60 hover:text-dex-ink"
          >
            {t('filtros.limpiar', { n: activeCount })}
          </button>
        )}
      </header>

      <FacetGroup
        title={t('filtros.pais')}
        buckets={facets?.countries ?? []}
        selected={params.countries}
        onToggle={(value) => onChange({ countries: toggleValue(params.countries, value), page: 1 })}
        showFlag
        nombre={(bucket) => nombreDePais(locale, bucket)}
      />
      <FacetGroup
        title={t('filtros.idioma')}
        buckets={facets?.languages ?? []}
        selected={params.languages}
        onToggle={(value) => onChange({ languages: toggleValue(params.languages, value), page: 1 })}
        nombre={(bucket) => nombreDeIdioma(locale, bucket.code ?? facetValue(bucket), bucket.name)}
      />
      <FacetGroup
        title={t('filtros.faccion')}
        buckets={facets?.factions ?? []}
        selected={params.factions}
        onToggle={(value) => onChange({ factions: toggleValue(params.factions, value), page: 1 })}
      />
      <FacetGroup
        title={t('filtros.grupo')}
        buckets={facets?.groups ?? []}
        selected={params.groups}
        onToggle={(value) => onChange({ groups: toggleValue(params.groups, value), page: 1 })}
      />
      <FacetGroup
        title={t('filtros.artista')}
        buckets={facets?.artists ?? []}
        selected={params.artists}
        onToggle={(value) => onChange({ artists: toggleValue(params.artists, value), page: 1 })}
      />
    </div>
  );
}

export default FilterPanel;
