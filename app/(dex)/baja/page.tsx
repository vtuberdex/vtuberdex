/**
 * `/baja` — formulario público para darse de baja. Acepta los mismos términos que la inscripción.
 * La baja no borra la ficha (cláusula de salida): queda como solicitud en espera.
 */
import type { Metadata } from 'next';

import { Encabezado } from '@/components/solicitudes/campos';
import { BajaForm } from '@/components/solicitudes/baja-form';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Darme de baja · ${NOMBRE_SITIO}`,
  description: 'Formulario para solicitar la baja de una ficha del catálogo.',
  alternates: { canonical: '/baja' },
};

export default function BajaRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Encabezado titulo="baja.titulo" texto="baja.intro" />
      <BajaForm />
    </main>
  );
}
