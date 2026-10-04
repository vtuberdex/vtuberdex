/**
 * Pie del sitio: acceso a la inscripción, la modificación, la baja y los términos. Son las
 * páginas que componen el circuito de alta/cambio/baja de fichas, y el pie es donde un VTuber las busca.
 */
import Link from 'next/link';

export function AppFooter() {
  return (
    <footer className="mt-12 border-t border-dex-line/80">
      <nav
        aria-label="Inscripción y términos"
        className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-dex-muted sm:px-6 lg:px-8"
      >
        <Link href="/inscripcion" className="hover:text-dex-ink">Inscribir mi ficha</Link>
        <Link href="/modificacion" className="hover:text-dex-ink">Actualizar mi ficha</Link>
        <Link href="/baja" className="hover:text-dex-ink">Darme de baja</Link>
        <Link href="/terminos" className="hover:text-dex-ink">Términos y Condiciones</Link>
      </nav>
    </footer>
  );
}

export default AppFooter;
