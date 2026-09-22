/**
 * Detalle: `/v/:slug` — carta 3D + ficha, stats, habilidades y redes.
 *
 * Con el App Router el slug viene por parámetro de ruta y no por `useParams` de
 * react-router. Se marca como `async` porque en Next 16 `params` es una promesa.
 */
import { DetailPage } from '@/components/detail-page';

export default async function DetailRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <DetailPage slug={slug} />;
}
