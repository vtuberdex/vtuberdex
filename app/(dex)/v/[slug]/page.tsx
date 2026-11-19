// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Detalle: `/v/:slug` — carta 3D + ficha, stats, habilidades y redes.
 *
 * Con el App Router el slug viene por parámetro de ruta y no por `useParams` de
 * react-router. Se marca como `async` porque en Next 16 `params` es una promesa.
 *
 * SEO (el cuerpo lo pinta el cliente, esto es lo que el servidor dice sin JavaScript):
 *  - `generateMetadata`: título, descripción, canonical e imagen social PROPIOS de cada ficha.
 *  - Un slug que no existe (o es un borrador) es un 404 REAL (`notFound()`): antes la página
 *    respondía 200 con «VTuber no encontrado», un soft 404 que los buscadores indexan.
 *  - Un slug ANTERIOR (renombrado) sigue resolviendo: el canonical apunta al slug vigente, así
 *    que el buscador consolida las dos URLs en una.
 *  - JSON-LD (`ProfilePage` + `Person` + migas de pan).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { headers } from "next/headers";

import { DetailPage, type FichaInicial } from "@/components/detail-page";
import { gastarFichas, redDeLaPeticion } from "@/lib/anti-scraping.mjs";
import { dbConDiario } from "@/lib/diario.mjs";
import { comoJson, completarFicha } from "@/lib/fichas-publicas.mjs";
import { getVtuberBySlug } from "@/server/src/search.mjs";
import { fichaPublica } from "@/lib/seo-datos.mjs";
import {
  descripcionDeFicha,
  jsonLdDeFicha,
  rutaDeFicha,
  serializarJsonLd,
  tituloDeFicha,
} from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await fichaPublica(slug).catch(() => null);
  // Sin ficha, `notFound()` de la página decide; aquí solo se evita publicar un título falso.
  if (!card) {
    return {
      title: "VTuber no encontrado",
      robots: { index: false, follow: false },
    };
  }

  const titulo = tituloDeFicha(card);
  const descripcion = descripcionDeFicha(card);
  const url = rutaDeFicha(card.slug);
  const imagen = card.images.character;
  return {
    title: titulo,
    description: descripcion,
    alternates: { canonical: url },
    openGraph: {
      type: "profile",
      title: titulo,
      description: descripcion,
      url,
      ...(imagen
        ? {
            images: [
              {
                url: imagen,
                width: 720,
                height: 1008,
                alt: `Carta de ${card.name}`,
              },
            ],
          }
        : {}),
    },
    twitter: {
      card: imagen ? "summary_large_image" : "summary",
      title: titulo,
      description: descripcion,
      ...(imagen ? { images: [imagen] } : {}),
    },
  };
}

/**
 * La ficha completa resuelta en el servidor y mandada en el HTML (ver `lib/fichas-publicas.mjs`): la
 * carta empieza a bajar sus imágenes en cuanto hidrata. Gasta el MISMO cupo de fichas por red que la API;
 * si se agotó o algo falla, no se manda y el cliente la pide como antes.
 */
async function fichaInicial(slug: string): Promise<FichaInicial | null> {
  try {
    const db = await dbConDiario({ ttlMs: 2000 });
    const card = getVtuberBySlug(db, slug);
    if (!card) {
      return null;
    }
    const cupo = gastarFichas(redDeLaPeticion(await headers()), [card.id]);
    if (!cupo.permitido) {
      return null;
    }
    return comoJson(await completarFicha(db, card)) as FichaInicial;
  } catch (error) {
    console.error(
      `[ficha] ${slug} sin primera vista del servidor: ${(error as Error).message}`,
    );
    return null;
  }
}

export default async function DetailRoute({ params }: Readonly<Props>) {
  const { slug } = await params;
  const card = await fichaPublica(slug).catch(() => undefined);
  // `undefined` = la lectura falló: se deja pasar al cliente (que pedirá la API) en vez de
  // devolver un 404 falso por una caída transitoria. `null` = la ficha de verdad no existe.
  if (card === null) {
    notFound();
  }
  const inicial = card ? await fichaInicial(slug) : null;
  return (
    <>
      {card ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializarJsonLd(jsonLdDeFicha(card)),
          }}
        />
      ) : null}
      <DetailPage slug={slug} inicial={inicial} />
    </>
  );
}
