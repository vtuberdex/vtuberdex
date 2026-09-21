/** Cabecera de la app: marca, buscador rápido y enlace al mantenedor. */
import { Link, useLocation } from 'react-router-dom';

export function AppHeader() {
  const { pathname } = useLocation();
  const inAdmin = pathname.startsWith('/admin');

  return (
    <header className="sticky top-0 z-30 border-b border-dex-line/80 bg-dex-void/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-dex-accent/60 bg-dex-accent/10">
            <span className="h-2.5 w-2.5 rounded-full bg-dex-accent" style={{ boxShadow: '0 0 12px var(--color-dex-accent)' }} />
          </span>
          <span className="text-sm font-extrabold uppercase tracking-[0.28em] text-dex-ink">VTuberDex</span>
        </Link>

        <span className="ml-auto hidden font-mono text-[11px] text-dex-muted sm:block">
          catálogo · búsqueda · carta holográfica
        </span>

        {!inAdmin && (
          <Link
            to="/admin"
            className="ml-auto rounded-lg border border-dex-line px-3 py-1.5 text-xs text-dex-muted hover:border-dex-accent/60 hover:text-dex-ink sm:ml-4"
          >
            Mantenedor
          </Link>
        )}
      </div>
    </header>
  );
}

export default AppHeader;
