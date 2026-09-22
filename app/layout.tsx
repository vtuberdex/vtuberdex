/**
 * Layout raíz.
 *
 * Equivale al `web/index.html` del front de Vite: los mismos metadatos y el mismo
 * `<html lang="es">`. El CSS de Tailwind se importa aquí, así que aplica a toda la
 * app sin que ninguna página tenga que acordarse.
 */
import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'VTuberDex',
  description:
    'VTuberDex: catálogo buscable de VTubers hispanohablantes con carta holográfica 3D, ficha, atributos y habilidades.',
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
