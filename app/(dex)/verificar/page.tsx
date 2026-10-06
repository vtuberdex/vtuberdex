/**
 * `/verificar` — destino del enlace de los correos de confirmación (inscripción, cambios y baja).
 * No se indexa: es una página de un solo uso. El token llega en el fragmento de la URL.
 */
import type { Metadata } from 'next';

import { Encabezado } from '@/components/solicitudes/campos';
import { VerificarCorreo } from '@/components/solicitudes/verificar-correo';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Confirmar correo · ${NOMBRE_SITIO}`,
  robots: { index: false, follow: false },
};

export default function VerificarRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <Encabezado titulo="verificar.titulo" texto="verificar.intro" />
      <VerificarCorreo />
    </main>
  );
}
