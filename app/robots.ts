/**
 * `/robots.txt`: se rastrea el sitio público; la API, el mantenedor y las imágenes de la carta
 * no son contenido que deba indexarse. Los assets de Next (`/_next/`) NO se bloquean: el
 * buscador necesita el JS y el CSS para renderizar la página.
 */
import type { MetadataRoute } from 'next';

import { urlAbsoluta } from '@/lib/seo';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', '/admin'] }],
    sitemap: urlAbsoluta('/sitemap.xml'),
  };
}
