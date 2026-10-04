/**
 * `/modificacion` — formulario público para actualizar una ficha ya registrada. Acepta los mismos
 * términos que la inscripción y no cambia nada por sí solo: queda en espera de revisión.
 */
import type { Metadata } from 'next';

import { ModificacionForm } from '@/components/solicitudes/modificacion-form';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Actualizar mi ficha · ${NOMBRE_SITIO}`,
  description: 'Formulario para pedir cambios en una ficha ya registrada del catálogo.',
  alternates: { canonical: '/modificacion' },
};

export default function ModificacionRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-dex-ink">Actualizar mi ficha</h1>
      <p className="mt-2 mb-8 text-sm text-dex-muted">
        ¿Ya estás en el catálogo y algo cambió? Cuéntanos qué: solo rellena lo que quieras modificar. Los cambios no se publican solos, el
        mantenedor los revisa antes de aplicarlos.
      </p>
      <ModificacionForm />
    </main>
  );
}
