"use client";
/**
 * Pie del sitio: acceso a la inscripción, la modificación, la baja y los términos. Son las
 * páginas que componen el circuito de alta/cambio/baja de fichas, y el pie es donde un VTuber las busca.
 */
import Link from "next/link";

import { useI18n } from "@/lib/i18n";

export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-12 border-t border-dex-line/80">
      <nav
        aria-label={t("pie.navegacion")}
        className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-xs text-dex-muted sm:px-6 lg:px-8"
      >
        <Link href="/inscripcion" className="hover:text-dex-ink">
          {t("pie.inscribir")}
        </Link>
        <Link href="/modificacion" className="hover:text-dex-ink">
          {t("pie.actualizar")}
        </Link>
        <Link href="/niveles" className="hover:text-dex-ink">
          {t("pie.niveles")}
        </Link>
        <Link href="/minecraft" className="hover:text-dex-ink">
          {t("pie.minecraft")}
        </Link>
        {/*
          Trampa para rastreadores: ningún humano la ve ni la alcanza con el teclado, robots.txt la
          prohíbe, así que solo la sigue un bot que recorre todos los enlaces del HTML. nginx
          responde 403 y fail2ban banea la red (infra/, jail vtuberdex-trampa). No la quites ni la
          muestres: quien la pulse quedaría baneado 24 h. Es un <a> y no un <Link> A PROPÓSITO:
          Link precarga lo que entra en pantalla y banearía a un visitante real.
        */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/v/archivo-completo"
          rel="nofollow"
          aria-hidden="true"
          tabIndex={-1}
          className="sr-only"
        >
          Archivo completo
        </a>
        <Link href="/mi-ficha" className="hover:text-dex-ink">
          {t("pie.miFicha")}
        </Link>
        <Link href="/baja" className="hover:text-dex-ink">
          {t("pie.baja")}
        </Link>
        <Link href="/terminos" className="hover:text-dex-ink">
          {t("pie.terminos")}
        </Link>
      </nav>
    </footer>
  );
}

export default AppFooter;
