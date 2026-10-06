/**
 * `/mi-ficha` — donde un VTuber reparte los puntos de habilidad que gana al subir de nivel. Se entra con el
 * enlace mágico del correo (`/mi-ficha#t=…`); sin él, la página pide el correo y lo manda. No se indexa:
 * es personal y sin token no muestra nada.
 */
import type { Metadata } from 'next';

import { MiFicha } from '@/components/mi-ficha/mi-ficha';
import { Encabezado } from '@/components/solicitudes/campos';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Mi ficha · ${NOMBRE_SITIO}`,
  robots: { index: false, follow: false },
};

export default function MiFichaRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Encabezado titulo="mificha.titulo" texto="mificha.intro" />
      <MiFicha />
    </main>
  );
}
