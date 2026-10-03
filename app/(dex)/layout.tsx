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
        {/*
          Sin `Suspense` aquí a propósito: con él Next envía el status 200 junto al esqueleto
          y un `notFound()` de la ficha ya no puede cambiarlo (soft 404). Cada página que usa
          `useSearchParams` ya lleva su propio `Suspense` (ver `page.tsx`).
        */}
        {children}
      </div>
    </div>
  );
}
