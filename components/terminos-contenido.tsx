'use client';
/**
 * Cuerpo de `/terminos` en el idioma de la interfaz. Es cliente porque el idioma se elige en el
 * navegador (el HTML del servidor es siempre español, que es lo que indexan los buscadores). El texto
 * autoritativo es el español; en/ja son traducciones de cortesía (`lib/terminos-i18n.ts`).
 */
import Link from 'next/link';

import { useI18n } from '@/lib/i18n';
import { TERMINOS_VERSION } from '@/lib/terminos';
import { terminosDe } from '@/lib/terminos-i18n';

export function TerminosContenido() {
  const { locale } = useI18n();
  const { fechaVigencia, preambulo, clausulas, textosPagina: tx } = terminosDe(locale);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-extrabold text-dex-ink">{tx.titulo}</h1>
      <p className="mt-2 text-xs text-dex-muted" data-testid="terminos-version">
        {tx.versionLinea.replace('{version}', TERMINOS_VERSION).replace('{fecha}', fechaVigencia)}
      </p>
      {tx.notaTraduccion && (
        <p
          className="mt-4 rounded-xl border border-amber-300/40 bg-amber-300/10 px-4 py-3 text-sm text-amber-100"
          data-testid="terminos-nota-traduccion"
        >
          {tx.notaTraduccion}
        </p>
      )}

      <div className="mt-6 space-y-3 text-sm leading-relaxed text-dex-ink/90">
        {preambulo.map((parrafo, i) => (
          <p key={i}>{parrafo}</p>
        ))}
      </div>

      <nav aria-label={tx.indiceEtiqueta} className="mt-8 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">{tx.indice}</p>
        <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {clausulas.map((c) => (
            <li key={c.id}>
              <a href={`#${c.id}`} className="text-dex-accent hover:underline">
                {c.titulo}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-10">
        {clausulas.map((c) => (
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
        {tx.pieAntes}{' '}
        <Link href="/inscripcion" className="text-dex-accent hover:underline">
          {tx.pieInscripcion}
        </Link>{' '}
        {tx.pieO}{' '}
        <Link href="/baja" className="text-dex-accent hover:underline">
          {tx.pieBaja}
        </Link>{' '}
        {tx.pieDespues}
      </p>
    </main>
  );
}
