/**
 * `/modificacion` — formulario público para actualizar una ficha ya registrada. Acepta los mismos
 * términos que la inscripción y no cambia nada por sí solo: queda en espera de revisión.
 */
import type { Metadata } from 'next';

import { EncabezadoModificacion } from '@/components/solicitudes/encabezado-ficha';
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
      <EncabezadoModificacion />
      <ModificacionForm />
    </main>
  );
}
