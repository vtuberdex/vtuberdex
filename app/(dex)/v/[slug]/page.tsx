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
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DetailPage } from '@/components/detail-page';
import { fichaPublica } from '@/lib/seo-datos.mjs';
import { esFichaDeteriorada } from '@/lib/premium';
import {
  descripcionDeFicha,
  jsonLdDeFicha,
  rutaDeFicha,
  serializarJsonLd,
  tituloDeFicha,
} from '@/lib/seo';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const card = await fichaPublica(slug).catch(() => null);
  // Sin ficha, `notFound()` de la página decide; aquí solo se evita publicar un título falso.
  if (!card) return { title: 'VTuber no encontrado', robots: { index: false, follow: false } };

  // Ficha deteriorada (baja): sin nombre, sin descripción, sin imagen social y fuera del índice.
  if (esFichaDeteriorada(card)) {
    return { title: 'Ficha Deteriorada', description: 'Ficha deteriorada.', robots: { index: false, follow: false } };
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
      type: 'profile',
      title: titulo,
      description: descripcion,
      url,
      ...(imagen ? { images: [{ url: imagen, width: 720, height: 1008, alt: `Carta de ${card.name}` }] } : {}),
    },
    twitter: {
      card: imagen ? 'summary_large_image' : 'summary',
      title: titulo,
      description: descripcion,
      ...(imagen ? { images: [imagen] } : {}),
    },
  };
}

export default async function DetailRoute({ params }: Props) {
  const { slug } = await params;
  const card = await fichaPublica(slug).catch(() => undefined);
  // `undefined` = la lectura falló: se deja pasar al cliente (que pedirá la API) en vez de
  // devolver un 404 falso por una caída transitoria. `null` = la ficha de verdad no existe.
  if (card === null) notFound();
  return (
    <>
      {card && !esFichaDeteriorada(card) ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializarJsonLd(jsonLdDeFicha(card)) }}
        />
      ) : null}
      <DetailPage slug={slug} />
    </>
  );
}
