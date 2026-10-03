/**
 * Layout raíz.
 *
 * Equivale al `web/index.html` del front de Vite: los mismos metadatos y el mismo
 * `<html lang="es">`. El CSS de Tailwind se importa aquí, así que aplica a toda la
 * app sin que ninguna página tenga que acordarse.
 */
import type { Metadata, Viewport } from 'next';

import { DESCRIPCION_SITIO, NOMBRE_SITIO, siteUrl } from '@/lib/seo';

import './globals.css';

/**
 * Metadatos por defecto de TODO el sitio; cada página los afina (`generateMetadata`).
 * `metadataBase` hace que Next convierta las rutas relativas (canonical, imágenes sociales) en
 * URLs absolutas, que es lo único que aceptan los buscadores y las vistas previas.
 */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: NOMBRE_SITIO, template: `%s · ${NOMBRE_SITIO}` },
  description: DESCRIPCION_SITIO,
  applicationName: NOMBRE_SITIO,
  openGraph: { siteName: NOMBRE_SITIO, locale: 'es_CL', type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#05060a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      {/* Sin fuentes de terceros: la app usa una pila local para no bloquear el
          render ni depender de un CDN externo (igual que el front original). */}
      <body>{children}</body>
    </html>
  );
}
