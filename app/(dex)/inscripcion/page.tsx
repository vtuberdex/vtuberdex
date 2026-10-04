/**
 * `/inscripcion` — formulario público para inscribir una ficha de VTuber.
 *
 * Es una página estática que monta un formulario de cliente. Lo enviado queda como solicitud en
 * espera hasta que el mantenedor la revisa (ver `server/src/solicitudes.mjs`); nada se publica solo.
 */
import type { Metadata } from 'next';

import { InscripcionForm } from '@/components/solicitudes/inscripcion-form';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Inscribir mi ficha · ${NOMBRE_SITIO}`,
  description: 'Formulario para inscribir la ficha de un VTuber en el catálogo. Las inscripciones quedan en espera de revisión.',
  alternates: { canonical: '/inscripcion' },
};

export default function InscripcionRoute() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-dex-ink">Inscribir mi ficha</h1>
      <p className="mt-2 mb-8 text-sm text-dex-muted">
        Completa el formulario para pedir tu lugar en el catálogo. Tu inscripción queda <strong>en espera de revisión</strong>: nada se
        publica hasta que el mantenedor la apruebe. Tu correo y tu nombre civil son confidenciales y no se publican.
      </p>
      <InscripcionForm />
    </main>
  );
}
