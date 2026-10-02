'use client';
/**
 * Lista lateral del mantenedor: busca y filtra por estado e INCLUYE borradores y
 * ocultos (la ruta pública `api.list` no los devuelve, por eso usa `adminList`).
 */
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { AdminStatusFilter, VtuberCard } from '@/lib/types';
import { percentOfCard } from '@/components/admin/completeness';
import { ghostButton, inputClass, labelClass, primaryButton } from '@/components/admin/ui';

const STATUS_LABEL: Record<VtuberCard['status'], string> = {
  published: 'publicado',
  draft: 'borrador',
  hidden: 'oculto',
};

const PER_PAGE = 40;

export function VtuberList({
  token,
  selectedId,
  refreshKey,
  onOpen,
  onCreate,
}: {
  token: string;
  selectedId: number | null;
  /** Cambia tras guardar/crear para volver a pedir la página actual. */
  refreshKey: unknown;
  onOpen: (row: VtuberCard) => void;
  /** Acción del estado vacío. */
  onCreate?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<AdminStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<VtuberCard[]>([]);
  const [meta, setMeta] = useState({ total: 0, pageCount: 1 });

  useEffect(() => {
    const controller = new AbortController();
    api
      .adminList(token, { q: query, status, page, perPage: PER_PAGE }, controller.signal)
      .then((response) => {
        setRows(response.items);
        setMeta({ total: response.total, pageCount: response.pageCount });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, query, status, page, refreshKey]);

  return (
    <aside className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
      <label className={labelClass}>
        Buscar ficha
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          className={inputClass}
          placeholder="nombre o número"
        />
      </label>
      <label className={`${labelClass} mt-3`}>
        Estado
        <select
          aria-label="Filtrar por estado"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as AdminStatusFilter);
            setPage(1);
          }}
          className={inputClass}
        >
          <option value="all">todos</option>
          <option value="published">publicados</option>
          <option value="draft">borradores</option>
          <option value="hidden">ocultos</option>
        </select>
      </label>
      <p className="mt-3 text-xs text-dex-muted">{meta.total} fichas</p>
      <ul className="dex-scroll mt-2 max-h-[60vh] space-y-1 overflow-y-auto">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => onOpen(row)}
              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                selectedId === row.id ? 'bg-dex-accent/15 text-dex-ink' : 'text-dex-muted hover:bg-white/5'
              }`}
            >
              <span className="font-mono text-[11px] text-dex-muted">#{String(row.dexNumber).padStart(3, '0')}</span>
              <span className="min-w-0 flex-1 truncate">{row.name}</span>
              <span className="font-mono text-[10px] text-dex-muted" title="Completitud de la carta" data-testid="row-percent">
                {percentOfCard(row)}%
              </span>
              {row.status !== 'published' && (
                <span className="rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200">{STATUS_LABEL[row.status]}</span>
              )}
            </button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="space-y-2 px-2 py-3 text-xs text-dex-muted" data-testid="list-empty">
            {query || status !== 'all' ? (
              'Ninguna ficha coincide con la búsqueda.'
            ) : (
              <>
                <p>Aún no hay fichas.</p>
                {onCreate && (
                  <button type="button" className={primaryButton} onClick={onCreate}>
                    Crear la primera carta
                  </button>
                )}
              </>
            )}
          </li>
        )}
      </ul>
      {meta.pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between">
          <button type="button" className={ghostButton} disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            ← Anterior
          </button>
          <span className="font-mono text-[11px] text-dex-muted">
            {page} / {meta.pageCount}
          </span>
          <button type="button" className={ghostButton} disabled={page >= meta.pageCount} onClick={() => setPage((current) => current + 1)}>
            Siguiente →
          </button>
        </div>
      )}
    </aside>
  );
}
