// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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
import type { Metadata } from "next";
import { Suspense } from "react";

import { headers } from "next/headers";

import { CatalogPage } from "@/components/catalog-page";
import type { DatosIniciales } from "@/components/use-vtuber-search";
import { gastarFichas, redDeLaPeticion } from "@/lib/anti-scraping.mjs";
import { dbConDiario } from "@/lib/diario.mjs";
import {
  buscarPagina,
  comoJson,
  completarPagina,
} from "@/lib/fichas-publicas.mjs";
import { searchParamsFromUrl, searchParamsToQuery } from "@/lib/query";
import { listQuerySchema } from "@/server/src/validation.mjs";
import { fichasPublicadas } from "@/lib/seo-datos.mjs";
import {
  DESCRIPCION_SITIO,
  NOMBRE_SITIO,
  jsonLdDelIndice,
  serializarJsonLd,
} from "@/lib/seo";

export const metadata: Metadata = {
  title: {
    absolute: `${NOMBRE_SITIO} · catálogo de VTubers hispanohablantes con cartas 3D`,
  },
  description: DESCRIPCION_SITIO,
  alternates: { canonical: "/" },
  openGraph: {
    title: `${NOMBRE_SITIO} · catálogo de VTubers`,
    description: DESCRIPCION_SITIO,
    url: "/",
  },
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

type Busqueda = Record<string, string | string[] | undefined>;

/**
 * La página que pide la URL, resuelta en el servidor y mandada en el HTML (ver `lib/fichas-publicas.mjs`):
 * las cartas empiezan a bajar en cuanto hidrata, sin esperar la sesión ni la API. Gasta el MISMO cupo de
 * fichas por red que la API; si se agotó, o si algo falla, no se manda nada y el cliente la pide como antes.
 * Siempre con 8 cartas: el servidor no sabe si es un celular (`use-vtuber-search` saca de ahí la hoja de 4).
 */
async function primeraVista(
  busqueda: Busqueda,
): Promise<DatosIniciales | null> {
  try {
    const url = new URLSearchParams();
    for (const [clave, valor] of Object.entries(busqueda)) {
      for (const v of Array.isArray(valor) ? valor : [valor]) {
        if (v !== undefined) {
          url.append(clave, v);
        }
      }
    }
    const params = searchParamsFromUrl(url.toString());
    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(new URLSearchParams(searchParamsToQuery(params))),
    );
    if (!parsed.success) {
      return null;
    }
    const db = await dbConDiario({ ttlMs: 2000 });
    const pagina = buscarPagina(db, parsed.data);
    const cupo = gastarFichas(
      redDeLaPeticion(await headers()),
      pagina.result.items.map((c: { id: number }) => c.id),
    );
    if (!cupo.permitido) {
      return null;
    }
    return { params, respuesta: comoJson(await completarPagina(db, pagina)) };
  } catch (error) {
    console.error(
      `[catalogo] sin primera vista del servidor: ${(error as Error).message}`,
    );
    return null;
  }
}

export default async function CatalogRoute({
  searchParams,
}: Readonly<{ searchParams: Promise<Busqueda> }>) {
  const inicial = await primeraVista(await searchParams);
  // Si la base falla el catálogo sigue funcionando: solo se pierde el JSON-LD de la lista.
  const fichas = await fichasPublicadas({ limit: FICHAS_EN_JSON_LD }).catch(
    () => [],
  );
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializarJsonLd(jsonLdDelIndice(fichas)),
        }}
      />
      <Suspense fallback={<Fallback />}>
        <CatalogPage inicial={inicial} />
      </Suspense>
    </>
  );
}
