/**
 * `/sitemap.xml`: el índice y TODAS las fichas publicadas.
 *
 * Es la vía principal para que un buscador descubra las 785 fichas, ya que el catálogo se
 * pagina en el cliente y no expone enlaces rastreables. Sale de la misma base que la web
 * (con el diario del mantenedor), así que un borrador no aparece y un renombrado sí. Se
 * genera en cada petición: es dinámico a propósito, para no congelar el catálogo del build.
 */
import type { MetadataRoute } from 'next';

import { fichasPublicadas } from '@/lib/seo-datos.mjs';
import { rutaDeFicha, urlAbsoluta } from '@/lib/seo';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const fichas = await fichasPublicadas().catch(() => []);
  return [
    { url: urlAbsoluta('/'), changeFrequency: 'daily', priority: 1 },
    { url: urlAbsoluta('/inscripcion'), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: urlAbsoluta('/modificacion'), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: urlAbsoluta('/terminos'), changeFrequency: 'yearly' as const, priority: 0.2 },
    ...fichas.map((f: { slug: string }) => ({
      url: urlAbsoluta(rutaDeFicha(f.slug)),
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
  ];
}
