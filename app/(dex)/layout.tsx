import { Suspense } from 'react';

import { AppHeader } from '@/components/app-header';

/**
 * Layout compartido por las páginas con el catálogo (inicio y detalle).
 *
 * Equivale al envoltorio del front de Vite original (cabecera + fondo de
 * rejilla) pero SIN router propio: el enrutado lo hace el App Router de Next a
 * partir de las carpetas, así que aquí solo queda el marco visual.
 */
export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="dex-grid relative min-h-screen">
      <div className="relative z-10">
        <AppHeader />
        <Suspense
          fallback={
            <div className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-dex-muted">
              cargando módulo…
            </div>
          }
        >
          {children}
        </Suspense>
      </div>
    </div>
  );
}
