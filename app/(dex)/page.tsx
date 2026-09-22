/**
 * Catálogo: `/` — buscador + facetas + grilla de cartas.
 *
 * `CatalogPage` es un componente de cliente porque la búsqueda vive en el
 * querystring y se resuelve en el navegador (`useVtuberSearch`); el App Router
 * solo se encarga de montarlo en esta ruta. `Suspense` hace falta porque
 * `useSearchParams` suspende durante la hidratación.
 */
import { Suspense } from 'react';

import { CatalogPage } from '@/components/catalog-page';

function Fallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-dex-muted">
      cargando catálogo…
    </div>
  );
}

export default function CatalogRoute() {
  return (
    <Suspense fallback={<Fallback />}>
      <CatalogPage />
    </Suspense>
  );
}
