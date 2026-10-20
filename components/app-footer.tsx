"use client";
/**
 * Pie del sitio: solo el aviso de derechos. Los enlaces (inscripción, modificación, baja, términos…)
 * viven en el menú lateral de la cabecera (`side-menu.tsx`).
 */
import Link from "next/link";

import { useI18n } from "@/lib/i18n";

export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="mt-12 border-t border-dex-line/80">
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
      {/*
        Aviso visible de derechos (términos, cláusula 18). Es de línea fija (leading-4) y corto a propósito:
        1 línea en escritorio y 2 en celular. `--binder-chrome` (globals.css) reserva la altura del pie;
        si lo alargas, mídelo de nuevo o el libro empujará la paginación fuera de la pantalla.
      */}
      <p className="footer-derechos mx-auto w-full max-w-[1600px] px-4 py-6 text-[11px] leading-4 text-dex-muted sm:px-6 lg:px-8">
        {t("pie.derechos")}{" "}
        <Link
          href="/terminos#seguridad"
          className="underline hover:text-dex-ink"
        >
          {t("pie.derechosVer")}
        </Link>
      </p>
    </footer>
  );
}

export default AppFooter;
