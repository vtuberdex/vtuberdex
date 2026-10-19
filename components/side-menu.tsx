"use client";
/**
 * Menú lateral: botón de hamburguesa en la cabecera (arriba a la izquierda) que abre un panel con TODOS
 * los enlaces del sitio. Reemplaza a los enlaces que antes vivían en el pie.
 *
 * Es un diálogo modal: foco al abrir, Escape y el fondo lo cierran, Tab no se sale del panel, el foco
 * vuelve al botón y la página de detrás no se desplaza. Se cierra solo al navegar. El botón vive DENTRO
 * de la fila de 3,5 rem de la cabecera: no cambia su alto, que `--binder-chrome` (globals.css) da por fijo.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useRef, useState } from "react";

import { useI18n } from "@/lib/i18n";

/**
 * Enlaces del menú, agrupados por categoría y en el orden en que se muestran. Una página pública
 * nueva se añade AQUÍ, en el grupo que le corresponda.
 */
const GRUPOS = [
  {
    clave: "menu.grupo.explorar",
    enlaces: [
      { href: "/", clave: "menu.inicio" },
      { href: "/?premium=1", clave: "catalogo.premium" },
    ],
  },
  {
    clave: "menu.grupo.fichas",
    enlaces: [
      { href: "/inscripcion", clave: "pie.inscribir" },
      { href: "/modificacion", clave: "pie.actualizar" },
      { href: "/mi-ficha", clave: "pie.miFicha" },
      { href: "/baja", clave: "pie.baja" },
    ],
  },
  {
    clave: "menu.grupo.juego",
    enlaces: [
      { href: "/niveles", clave: "pie.niveles" },
      { href: "/minecraft", clave: "pie.minecraft" },
    ],
  },
  {
    clave: "menu.grupo.legal",
    enlaces: [{ href: "/terminos", clave: "pie.terminos" }],
  },
] as const;

const FOCUSABLES = "a[href], button:not([disabled])";

export function SideMenu() {
  const { t } = useI18n();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const idPanel = useId();
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  const cerrar = useCallback(() => setAbierto(false), []);

  // Navegar cierra el menú (el enlace puede ser a la misma ruta con otro querystring).
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);

  useEffect(() => {
    if (!abierto) return;
    const boton_ = boton.current;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.querySelector<HTMLElement>(FOCUSABLES)?.focus();

    const alTeclear = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setAbierto(false);
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [
        ...panel.current.querySelectorAll<HTMLElement>(FOCUSABLES),
      ];
      if (!items.length) return;
      const primero = items[0];
      const ultimo = items[items.length - 1];
      if (e.shiftKey && document.activeElement === primero) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
      document.body.style.overflow = anterior;
      boton_?.focus();
    };
  }, [abierto]);

  return (
    <>
      <button
        ref={boton}
        type="button"
        aria-label={t("menu.abrir")}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={idPanel}
        data-testid="menu-abrir"
        onClick={() => setAbierto(true)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-dex-line/80 text-dex-ink hover:border-dex-accent/60 hover:text-dex-accent"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M2 4.5h14M2 9h14M2 13.5h14" />
        </svg>
      </button>
      {/*
        PORTAL a <body>, no hijo de la cabecera: la cabecera lleva `backdrop-blur` (backdrop-filter) y
        `z-30`, y un backdrop-filter convierte a su caja en el bloque contenedor de todo lo `fixed` de
        dentro y en un contexto de apilamiento propio. El panel quedaba recortado a los 3,5 rem de la
        cabecera y por debajo del resto de la página. No lo devuelvas a la cabecera.
      */}
      {abierto &&
        createPortal(
          <div className="fixed inset-0 z-[100]" data-testid="menu-lateral">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
              onClick={cerrar}
              aria-hidden="true"
            />
            <aside
              ref={panel}
              id={idPanel}
              role="dialog"
              aria-modal="true"
              aria-label={t("menu.titulo")}
              className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-dex-line/80 bg-dex-void shadow-2xl"
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-dex-line/80 px-4">
                <span className="font-heading text-sm uppercase tracking-[0.2em] text-dex-ink">
                  {t("menu.titulo")}
                </span>
                <button
                  type="button"
                  aria-label={t("menu.cerrar")}
                  onClick={cerrar}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-dex-muted hover:text-dex-ink"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    aria-hidden="true"
                  >
                    <path d="M3 3l10 10M13 3L3 13" />
                  </svg>
                </button>
              </div>
              <nav
                aria-label={t("menu.titulo")}
                className="flex-1 overflow-y-auto px-2 py-3"
              >
                {GRUPOS.map((grupo, i) => (
                  <section
                    key={grupo.clave}
                    aria-labelledby={`${idPanel}-g${i}`}
                    className={i > 0 ? "mt-4" : undefined}
                  >
                    <h2
                      id={`${idPanel}-g${i}`}
                      className="px-3 pb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-dex-muted/70"
                    >
                      {t(grupo.clave)}
                    </h2>
                    <ul className="flex flex-col gap-0.5">
                      {grupo.enlaces.map(({ href, clave }) => (
                        <li key={href}>
                          <Link
                            href={href}
                            onClick={cerrar}
                            aria-current={
                              href === pathname ? "page" : undefined
                            }
                            className="block rounded-lg px-3 py-2.5 text-sm text-dex-muted hover:bg-dex-accent/10 hover:text-dex-ink aria-[current=page]:text-dex-accent"
                          >
                            {t(clave)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </nav>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
}

export default SideMenu;
