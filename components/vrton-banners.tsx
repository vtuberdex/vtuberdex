"use client";
/**
 * Pendones de la invitación a VRTon 2026: uno a cada lado de la galería y de la ficha.
 *
 * Solo escritorio (`xl`, 1280 px): en una pantalla más angosta cada pendón le quitaría al libro
 * 3D el ancho que necesita, y en celular no caben. Por eso los pendones son `hidden xl:block`
 * y la rejilla de 3 columnas solo existe desde `xl`; debajo, `children` ocupa todo el ancho
 * como antes.
 *
 * Los assets (logo y cruz de Teletón) son de VRTon (repo `VRTon/ASSETS2025`), cuya licencia
 * permite derivados no comerciales a condición de enlazar visiblemente a https://vrton.org/:
 * todo el pendón es ese enlace. Las imágenes viven en `components/vrton/` (recortadas y en WebP;
 * `public/` está en .gitignore, así que no viajarían al deploy).
 */
import { useI18n } from "@/lib/i18n";
import logoImport from "@/components/vrton/logo.webp";
import teletonImport from "@/components/vrton/teleton.webp";

/** Next entrega `{ src }` y vitest una cadena (ver la trampa de `metalEnvUrl` en `card-material.ts`). */
const urlDe = (m: unknown): string =>
  typeof m === "string" ? m : (m as { src: string }).src;
const LOGO = urlDe(logoImport);
const TELETON = urlDe(teletonImport);

const VRTON_URL = "https://vrton.org/";

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
        >
          <span className="pendon-barra" aria-hidden>
            <i />
            <i />
          </span>
          <span className="pendon-tela">
            <span className="pendon-contenido">
              <span className="pendon-evento">{t("vrton.evento")}</span>
              <img
                src={LOGO}
                alt="VRTon"
                width={486}
                height={243}
                className="pendon-logo"
              />
              <span className="pendon-anio">2026</span>
              <span className="pendon-fechas">{t("vrton.fechas")}</span>
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
        </a>
      </div>
    </aside>
  );
}

export function VrtonBanners({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[9.5rem_minmax(0,1fr)_9.5rem] xl:items-start">
      <Pendon lado="izquierdo" />
      {children}
      <Pendon lado="derecho" />
    </div>
  );
}
