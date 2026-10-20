"use client";
/**
 * Invitación a VRTon 2026. Escritorio (`xl`, 1280 px): un pendón vertical a cada lado de la
 * galería y de la ficha. Debajo de `xl` cada pendón le quitaría al libro 3D el ancho que necesita,
 * así que ahí va un solo estandarte horizontal encima (`Estandarte`: tablet y celular). Los
 * pendones son `hidden xl:block` y la rejilla de 3 columnas solo existe desde `xl`.
 *
 * Los assets (logo y cruz de Teletón) son de VRTon (repo `VRTon/ASSETS2025`), cuya licencia
 * permite derivados no comerciales a condición de enlazar visiblemente a https://vrton.org/:
 * todo el pendón es ese enlace. Las imágenes viven en `components/vrton/` (recortadas y en WebP;
 * `public/` está en .gitignore, así que no viajarían al deploy).
 */
import { useI18n } from "@/lib/i18n";
import logoImport from "@/components/vrton/logo.webp";
import teletonImport from "@/components/vrton/teleton.webp";
import fondoIzqImport from "@/components/vrton/fondo-izq.webp";
import fondoHImport from "@/components/vrton/fondo-h.webp";
import fondoDerImport from "@/components/vrton/fondo-der.webp";

/** Next entrega `{ src }` y vitest una cadena (ver la trampa de `metalEnvUrl` en `card-material.ts`). */
const urlDe = (m: unknown): string =>
  typeof m === "string" ? m : (m as { src: string }).src;
const LOGO = urlDe(logoImport);
const TELETON = urlDe(teletonImport);
/** Una franja de `hero-background` (vrton.org) por pendón: cada uno enmarca una torre del paisaje. */
const FONDO_H = urlDe(fondoHImport);
const FONDO = {
  izquierdo: urlDe(fondoIzqImport),
  derecho: urlDe(fondoDerImport),
};

const VRTON_URL = "https://vrton.org/";

/**
 * Versión de tablet (md a xl) y de celular (< md): un estandarte HORIZONTAL sobre el catálogo.
 * A estos anchos un pendón a cada lado le quitaría al libro 3D el ancho que necesita, así que
 * una sola franja arriba: en tablet con logo, fecha, Teletón y botón; en celular, compacta
 * (logo, fecha y flecha). Es el mismo markup y el CSS (`.pendon-h`) decide qué se ve en cada
 * ancho. `--binder-chrome` (globals.css) suma su alto para que el libro siga cabiendo.
 */
function Estandarte() {
  const { t } = useI18n();
  return (
    <aside
      aria-label={t("vrton.aria")}
      data-testid="estandarte-vrton"
      className="xl:hidden"
    >
      <a
        href={VRTON_URL}
        target="_blank"
        rel="noopener"
        className="pendon-h"
        style={{ "--pendon-fondo": `url(${FONDO_H})` } as React.CSSProperties}
      >
        <span className="pendon-barra" aria-hidden>
          <i />
          <i />
        </span>
        <span className="pendon-h-tela">
          <img
            src={LOGO}
            alt="VRTon"
            width={596}
            height={397}
            className="pendon-h-logo"
          />
          <span className="pendon-h-texto">
            <span className="pendon-h-evento">{t("vrton.evento")}</span>
            <span className="pendon-h-fecha">
              <b>2026</b> {t("vrton.fechas")}
            </span>
            <span className="pendon-h-horas">{t("vrton.horas")}</span>
          </span>
          <span className="pendon-h-causa">
            <img src={TELETON} alt="" width={244} height={247} />
            <span>
              {t("vrton.apoyo")} <b>{t("vrton.teleton")}</b>
            </span>
          </span>
          <span className="pendon-h-cta">{t("vrton.cta")}</span>
        </span>
      </a>
    </aside>
  );
}

function Pendon({ lado }: { lado: "izquierdo" | "derecho" }) {
  const { t } = useI18n();
  return (
    <aside
      aria-label={t("vrton.aria")}
      data-testid="pendon-vrton"
      className="hidden xl:block"
    >
      {/* Pegajoso: acompaña al libro (y a la ficha, que es larga) mientras se baja. */}
      <div className="sticky top-4">
        <a
          href={VRTON_URL}
          target="_blank"
          rel="noopener"
          className={`pendon pendon-${lado}`}
          style={
            { "--pendon-fondo": `url(${FONDO[lado]})` } as React.CSSProperties
          }
        >
          <span className="pendon-barra" aria-hidden>
            <i />
            <i />
          </span>
          <span className="pendon-tela">
            {/* Centrado en el alto del pendón (no en el flujo): los bloques de arriba y abajo no lo empujan. */}
            <img
              src={LOGO}
              alt="VRTon"
              width={596}
              height={397}
              className="pendon-logo"
            />
            <span className="pendon-contenido">
              <span className="pendon-alto">
                <span className="pendon-evento">{t("vrton.evento")}</span>
                <span className="pendon-anio">2026</span>
                <span className="pendon-fechas">{t("vrton.fechas")}</span>
              </span>
              <span className="pendon-bajo">
                <span className="pendon-horas">{t("vrton.horas")}</span>
                <span className="pendon-causa">
                  <img src={TELETON} alt="" width={244} height={247} />
                  <span>{t("vrton.apoyo")}</span>
                  <b>{t("vrton.teleton")}</b>
                </span>
                <span className="pendon-cta">{t("vrton.cta")}</span>
                <span className="pendon-url">vrton.org</span>
              </span>
            </span>
          </span>
        </a>
      </div>
    </aside>
  );
}

export function VrtonBanners({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-3 xl:gap-6 xl:grid-cols-[9.5rem_minmax(0,1fr)_9.5rem] xl:items-start">
      <Estandarte />
      <Pendon lado="izquierdo" />
      {children}
      <Pendon lado="derecho" />
    </div>
  );
}
