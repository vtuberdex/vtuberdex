'use client';
/** Paginación simple con ventana de páginas. */
export interface PaginationProps {
  page: number;
  pageCount: number;
  onPage: (page: number) => void;
}

function windowedPages(page: number, pageCount: number, span = 2): number[] {
  const start = Math.max(1, Math.min(page - span, pageCount - span * 2));
  const end = Math.min(pageCount, Math.max(page + span, span * 2 + 1));
  const pages: number[] = [];
  for (let value = start; value <= end; value += 1) pages.push(value);
  return pages;
}

export function Pagination({ page, pageCount, onPage }: PaginationProps) {
  if (pageCount <= 1) return null;
  const pages = windowedPages(page, pageCount);

  const buttonClass = (active: boolean) =>
    `min-w-9 rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors ${
      active
        ? 'border-dex-accent bg-dex-accent/15 text-dex-accent'
        : 'border-dex-line text-dex-muted hover:border-dex-accent/50 hover:text-dex-ink'
    }`;

  return (
    <nav className="mt-8 flex flex-wrap items-center justify-center gap-2" aria-label="Paginación de resultados">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} className={buttonClass(false)}>
        ← Anterior
      </button>
      {pages[0] > 1 && (
        <>
          <button type="button" onClick={() => onPage(1)} className={buttonClass(page === 1)}>
            1
          </button>
          {pages[0] > 2 && <span className="text-dex-muted">…</span>}
        </>
      )}
      {pages.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPage(value)}
          aria-current={value === page ? 'page' : undefined}
          className={buttonClass(value === page)}
        >
          {value}
        </button>
      ))}
      {pages[pages.length - 1] < pageCount && (
        <>
          {pages[pages.length - 1] < pageCount - 1 && <span className="text-dex-muted">…</span>}
          <button type="button" onClick={() => onPage(pageCount)} className={buttonClass(page === pageCount)}>
            {pageCount}
          </button>
        </>
      )}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= pageCount} className={buttonClass(false)}>
        Siguiente →
      </button>
    </nav>
  );
}

export default Pagination;
