/**
 * `/baja` — formulario público para darse de baja. Acepta los mismos términos que la inscripción.
 * La baja no borra la ficha (cláusula de salida): queda como solicitud en espera.
 */
import type { Metadata } from 'next';

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
      <h1 className="text-2xl font-extrabold text-dex-ink">Darme de baja</h1>
      <p className="mt-2 mb-8 text-sm text-dex-muted">
        Si ya no quieres figurar en el catálogo, solicítalo aquí. La solicitud queda en espera hasta que el mantenedor compruebe que eres
        el titular.
      </p>
      <BajaForm />
    </main>
  );
}
