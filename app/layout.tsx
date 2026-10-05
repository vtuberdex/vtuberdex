/**
 * Layout raíz.
 *
 * Equivale al `web/index.html` del front de Vite: los mismos metadatos y el mismo
 * `<html lang="es">`. El CSS de Tailwind se importa aquí, así que aplica a toda la
 * app sin que ninguna página tenga que acordarse.
 */
import type { Metadata, Viewport } from 'next';
import { Asul, Knewave } from 'next/font/google';

import { ClienteStats } from '@/components/cliente-stats';
import { I18nProvider } from '@/lib/i18n';
import { DESCRIPCION_SITIO, NOMBRE_SITIO, siteUrl } from '@/lib/seo';

import './globals.css';

/**
 * Knewave para los títulos y Asul para el resto de la interfaz. `next/font` las baja en el
 * build y las sirve desde el propio dominio (sin pedir nada a Google en cada visita, y sin
 * el salto de diseño de una hoja de estilos externa). Knewave solo existe en peso 400, por
 * eso `globals.css` fija ese peso en los títulos: pedir negrita fabricaría una falsa.
 * Las CARTAS no las usan: sus lienzos dibujan con la constante `FONT` de
 * `card-texture/dimensiones.ts`.
 */
const knewave = Knewave({ subsets: ['latin'], weight: '400', variable: '--font-knewave', display: 'swap' });
const asul = Asul({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-asul', display: 'swap' });

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
    <html lang="es" className={`${knewave.variable} ${asul.variable}`}>
      <body>
        <I18nProvider>
          {children}
          <ClienteStats />
        </I18nProvider>
      </body>
    </html>
  );
}
