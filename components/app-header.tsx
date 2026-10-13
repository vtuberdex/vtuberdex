'use client';
/**
 * Cabecera de la app: marca y nada más.
 *
 * Antes colgaba aquí un enlace al mantenedor y el reclamo «catálogo · búsqueda ·
 * carta holográfica». Los dos se retiraron de la vista pública: el mantenedor es
 * una herramienta interna (sigue en `/admin`, que en producción responde 404 vía
 * `app/api/admin/[...path]`) y la etiqueta era ruido de marketing en una cabecera
 * que ya se explica sola. Sin ese enlace, `usePathname` deja de tener uso.
 *
 * El botón «Inscribir mi ficha» va a la derecha y relleno: la gente no encontraba cómo inscribirse cuando
 * solo existía el enlace del pie.
 *
 * Lo único que se añade es el acceso a la sección PREMIUM (`/?premium=1`): las cartas gradeadas
 * en placa de acrílico. Es el catálogo con un filtro, no una página aparte, así que comparte
 * libro, buscador y enlaces compartibles.
 */
import Link from 'next/link';

import { LanguageSwitcher } from '@/components/language-switcher';
import { useI18n } from '@/lib/i18n';

export function AppHeader() {
  const { t } = useI18n();
  return (
    <header className="sticky top-0 z-30 border-b border-dex-line/80 bg-dex-void/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-3 sm:gap-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-dex-accent/60 bg-dex-accent/10">
            <span className="h-2.5 w-2.5 rounded-full bg-dex-accent" style={{ boxShadow: '0 0 12px var(--color-dex-accent)' }} />
          </span>
          <span className="font-heading text-sm uppercase tracking-[0.08em] sm:text-base sm:tracking-[0.2em] text-dex-ink">VTuberDex</span>
        </Link>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link href="/minecraft" className="hidden text-sm text-dex-muted hover:text-dex-ink md:inline">
            {t('pie.minecraft')}
          </Link>
          <LanguageSwitcher />
          {/* El alta es lo que más se busca y estaba escondida en el pie: botón relleno, siempre visible. */}
          <Link
            href="/inscripcion"
            data-testid="cabecera-inscribir"
            className="whitespace-nowrap rounded-xl bg-dex-accent px-3 py-2 text-xs font-bold text-black shadow-[0_0_16px_var(--color-dex-accent)] sm:px-4 sm:text-sm"
          >
            {t('pie.inscribir')}
          </Link>
        </div>
      </div>
    </header>
  );
}

export default AppHeader;
