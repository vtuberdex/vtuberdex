/**
 * `/terminos` — Términos y Condiciones. Es la página que los formularios de inscripción y de baja
 * obligan a aceptar. El texto es dato (`lib/terminos.ts`); aquí solo se pinta, con un ancla por
 * cláusula para poder enlazar a las que importan (`#salida`, `#datos-personales`).
 */
import type { Metadata } from 'next';
import Link from 'next/link';

import { CLAUSULAS, FECHA_VIGENCIA, PREAMBULO, TERMINOS_VERSION } from '@/lib/terminos';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Términos y Condiciones · ${NOMBRE_SITIO}`,
  description: 'Términos y condiciones de la inscripción, el uso y la baja de fichas en VTuberDex.',
  alternates: { canonical: '/terminos' },
};

export default function TerminosRoute() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-dex-ink">Términos y Condiciones</h1>
      <p className="mt-2 text-xs text-dex-muted" data-testid="terminos-version">
        Versión {TERMINOS_VERSION} · vigente desde el {FECHA_VIGENCIA}
      </p>

      <div className="mt-6 space-y-3 text-sm leading-relaxed text-dex-ink/90">
        {PREAMBULO.map((parrafo, i) => (
          <p key={i}>{parrafo}</p>
        ))}
      </div>

      <nav aria-label="Índice de cláusulas" className="mt-8 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">Índice</p>
        <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {CLAUSULAS.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className="text-dex-accent hover:underline">
                {c.titulo}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {CLAUSULAS.map((c) => (
          <section key={c.id} id={c.id} aria-labelledby={`${c.id}-titulo`} className="scroll-mt-20">
            <h2 id={`${c.id}-titulo`} className="text-lg font-bold text-dex-ink">
              {c.titulo}
            </h2>
            <div className="mt-3 space-y-3 text-sm leading-relaxed text-dex-ink/85">
              {c.parrafos.map((parrafo, i) => (
                <p key={i}>{parrafo}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <p className="mt-12 border-t border-dex-line pt-6 text-sm text-dex-muted">
        Al enviar un formulario de{' '}
        <Link href="/inscripcion" className="text-dex-accent hover:underline">
          inscripción
        </Link>{' '}
        o de{' '}
        <Link href="/baja" className="text-dex-accent hover:underline">
          baja
        </Link>{' '}
        aceptas la totalidad de este documento.
      </p>
    </main>
  );
}
