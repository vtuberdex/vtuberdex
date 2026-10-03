/**
 * Catálogo: `/` — buscador + facetas + grilla de cartas.
 *
 * `CatalogPage` es un componente de cliente porque la búsqueda vive en el
 * querystring y se resuelve en el navegador (`useVtuberSearch`); el App Router
 * solo se encarga de montarlo en esta ruta. `Suspense` hace falta porque
 * `useSearchParams` suspende durante la hidratación.
 *
 * SEO: el cuerpo lo pinta el cliente, así que lo que el servidor aporta es el `<head>` y el
 * JSON-LD. El canonical es SIEMPRE `/`: los filtros y la página viven en el querystring
 * (`?q=`, `?page=`…) y son vistas del mismo catálogo; dejarlas indexables multiplicaría
 * páginas casi idénticas. Las fichas se descubren por el sitemap y por el JSON-LD.
 */
import type { Metadata } from 'next';
import { Suspense } from 'react';

import { CatalogPage } from '@/components/catalog-page';
import { fichasPublicadas } from '@/lib/seo-datos.mjs';
import { DESCRIPCION_SITIO, NOMBRE_SITIO, jsonLdDelIndice, serializarJsonLd } from '@/lib/seo';

export const metadata: Metadata = {
  title: { absolute: `${NOMBRE_SITIO} · catálogo de VTubers hispanohablantes con cartas 3D` },
  description: DESCRIPCION_SITIO,
  alternates: { canonical: '/' },
  openGraph: { title: `${NOMBRE_SITIO} · catálogo de VTubers`, description: DESCRIPCION_SITIO, url: '/' },
};

/** Cuántas fichas se listan en el JSON-LD: una muestra, el resto sale del sitemap. */
const FICHAS_EN_JSON_LD = 24;

function Fallback() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-20 text-center font-mono text-sm text-dex-muted">
      cargando catálogo…
    </div>
  );
}

export default async function CatalogRoute() {
  // Si la base falla el catálogo sigue funcionando: solo se pierde el JSON-LD de la lista.
  const fichas = await fichasPublicadas({ limit: FICHAS_EN_JSON_LD }).catch(() => []);
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializarJsonLd(jsonLdDelIndice(fichas)) }}
      />
      <Suspense fallback={<Fallback />}>
        <CatalogPage />
      </Suspense>
    </>
  );
}
