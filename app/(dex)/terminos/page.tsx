/**
 * `/terminos` — Términos y Condiciones. Es la página que los formularios de inscripción y de baja
 * obligan a aceptar. El texto es dato (`lib/terminos.ts`, con traducciones de cortesía en
 * `lib/terminos-i18n.ts`); el cuerpo lo pinta `TerminosContenido` en el idioma elegido, con un ancla
 * por cláusula para poder enlazar a las que importan (`#salida`, `#datos-personales`). Los metadatos
 * del servidor quedan en español.
 */
import type { Metadata } from 'next';

import { TerminosContenido } from '@/components/terminos-contenido';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Términos y Condiciones · ${NOMBRE_SITIO}`,
  description: 'Términos y condiciones de la inscripción, el uso y la baja de fichas en VTuberDex.',
  alternates: { canonical: '/terminos' },
};

export default function TerminosRoute() {
  return <TerminosContenido />;
}
