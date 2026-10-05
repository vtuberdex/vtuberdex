'use client';
/**
 * Barra de búsqueda con debounce y sugerencia de número de dex.
 * El origen resolvía la búsqueda con un `alert` y `scrollIntoView`; aquí el
 * estado vive en la URL y el resultado es una lista paginada.
 */
import { useEffect, useRef, useState } from 'react';

import { useI18n } from '@/lib/i18n';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  /** Total de resultados, para el contador accesible. */
  total: number;
  loading?: boolean;
  placeholder?: string;
}

const DEBOUNCE_MS = 260;

export function SearchBar({ value, onChange, total, loading = false, placeholder }: SearchBarProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // El valor externo manda (navegación atrás, chip eliminado…).
  useEffect(() => {
    setDraft((current) => (current === value ? current : value));
  }, [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = window.setTimeout(() => onChangeRef.current(draft), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, value]);

  // Atajo de teclado: "/" enfoca el buscador (como en la terminal del origen).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative w-full">
      <div className="flex items-center gap-3 rounded-xl border border-dex-line bg-dex-panel/80 px-4 py-3 backdrop-blur focus-within:border-dex-accent/70">
        <svg className="h-5 w-5 shrink-0 text-dex-muted" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setDraft('');
          }}
          placeholder={placeholder ?? t('buscador.placeholder')}
          aria-label={t('buscador.etiqueta')}
          className="min-w-0 flex-1 bg-transparent text-base text-dex-ink outline-none placeholder:text-dex-muted/70"
        />
        {draft && (
          <button
            type="button"
            onClick={() => setDraft('')}
            className="rounded-md px-2 py-1 text-xs text-dex-muted hover:bg-white/5 hover:text-dex-ink"
            aria-label={t('buscador.limpiarEtiqueta')}
          >
            {t('buscador.limpiar')}
          </button>
        )}
        <span className="hidden shrink-0 font-mono text-xs text-dex-muted sm:block" aria-hidden>
          <kbd className="rounded border border-dex-line px-1.5 py-0.5">/</kbd>
        </span>
      </div>
      <p className="mt-2 px-1 text-xs text-dex-muted" role="status" aria-live="polite">
        {loading ? t('buscador.buscando') : t('buscador.encontrados', { n: total })}
      </p>
    </div>
  );
}

export default SearchBar;
