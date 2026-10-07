'use client';
/**
 * Lista lateral del mantenedor: busca y filtra por estado e INCLUYE borradores y
 * ocultos (la ruta pública `api.list` no los devuelve, por eso usa `adminList`).
 *
 * Es un BUSCADOR, no un índice: sin texto ni filtro no muestra nada (ni pide nada), y con
 * ellos trae como mucho `MAX_RESULTADOS`. Antes listaba 40 por página de las ~785 fichas y la
 * columna era una sábana que había que paginar para encontrar una ficha que ya se sabía nombrar.
 */
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import type { AdminCorreoFilter, AdminStatusFilter, VtuberCard } from '@/lib/types';
import { percentOfCard } from '@/components/admin/completeness';
import { ghostButton, inputClass, labelClass } from '@/components/admin/ui';

const STATUS_LABEL: Record<VtuberCard['status'], string> = {
  published: 'publicado',
  draft: 'borrador',
  hidden: 'oculto',
};

const MAX_RESULTADOS = 10;

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
  const [correo, setCorreo] = useState<AdminCorreoFilter>('todos');
  const [rows, setRows] = useState<(VtuberCard & { hasEmail?: boolean })[]>([]);
  const [total, setTotal] = useState(0);
  const filtrando = query.trim() !== '' || status !== 'all' || correo !== 'todos';

  useEffect(() => {
    if (!filtrando) {
      setRows([]);
      setTotal(0);
      return;
    }
    const controller = new AbortController();
    api
      .adminList(token, { q: query, status, correo, page: 1, perPage: MAX_RESULTADOS }, controller.signal)
      .then((response) => {
        setRows(response.items);
        setTotal(response.total);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, query, status, correo, filtrando, refreshKey]);

  return (
    <aside className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
      <label className={labelClass}>
        Buscar ficha
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
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
          }}
          className={inputClass}
        >
          <option value="all">todos</option>
          <option value="published">publicados</option>
          <option value="draft">borradores</option>
          <option value="hidden">ocultos</option>
        </select>
      </label>
      <label className={`${labelClass} mt-3`}>
        Correo
        <select
          aria-label="Filtrar por correo"
          value={correo}
          onChange={(event) => {
            setCorreo(event.target.value as AdminCorreoFilter);
          }}
          className={inputClass}
        >
          <option value="todos">todos</option>
          <option value="con">con correo</option>
          <option value="sin">sin correo</option>
        </select>
      </label>
      {filtrando && (
        <p className="mt-3 text-xs text-dex-muted" data-testid="list-count">
          {total > rows.length ? `${rows.length} de ${total} fichas: afina la búsqueda para ver el resto` : `${total} ${total === 1 ? 'ficha' : 'fichas'}`}
        </p>
      )}
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
              <span
                className={`font-mono text-[10px] ${row.hasEmail ? 'text-emerald-300' : 'text-dex-muted/60'}`}
                title={row.hasEmail ? 'Tiene correo asociado' : 'Sin correo asociado'}
                data-testid="row-email"
              >
                {row.hasEmail ? '✉' : '–'}
              </span>
              {row.status !== 'published' && (
                <span className="rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200">{STATUS_LABEL[row.status]}</span>
              )}
            </button>
          </li>
        ))}
        {!filtrando && (
          <li className="space-y-2 px-2 py-3 text-xs text-dex-muted" data-testid="list-idle">
            <p>Escribe un nombre o número, o elige un estado o filtro de correo, para ver fichas.</p>
            {onCreate && (
              <button type="button" className={ghostButton} onClick={onCreate}>
                O crea una carta nueva
              </button>
            )}
          </li>
        )}
        {filtrando && rows.length === 0 && (
          <li className="px-2 py-3 text-xs text-dex-muted" data-testid="list-empty">
            Ninguna ficha coincide con la búsqueda.
          </li>
        )}
      </ul>
    </aside>
  );
}
