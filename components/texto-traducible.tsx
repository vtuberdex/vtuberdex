// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Texto libre de una ficha (frase, historia) con traducción al vuelo.
 *
 * Si el texto NO está en el idioma de la interfaz (`idiomaDelTexto`), ofrece «Traducir a …». La
 * traducción corre en el dispositivo (`lib/traductor`) y solo se pide al pulsar: ninguna
 * descarga ni cálculo ocurre por el simple hecho de abrir la ficha. Si el motor es el de
 * respaldo (modelo propio de ~100 MB) se avisa ANTES de pulsar, no después.
 */
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { NOMBRE_PROPIO } from "@/lib/i18n/locales";
import { idiomaDelTexto } from "@/lib/traductor/idioma-texto";
import { hayTraductorNativo, traducirTexto } from "@/lib/traductor/traductor";

type Estado =
  | { fase: "reposo" }
  | { fase: "traduciendo"; pct: number | null }
  | { fase: "listo"; texto: string }
  | { fase: "fallo" };

export function TextoTraducible({
  texto,
  className = "",
  acento,
}: Readonly<{
  texto: string;
  className?: string;
  acento?: string;
}>) {
  const { locale } = useI18n();
  const [estado, setEstado] = useState<Estado>({ fase: "reposo" });
  const [verOriginal, setVerOriginal] = useState(false);
  // El motor nativo depende del navegador: se consulta tras hidratar para no discrepar con el servidor.
  const [nativo, setNativo] = useState(true);
  useEffect(() => setNativo(hayTraductorNativo()), []);

  // Otra ficha u otro idioma de interfaz: lo traducido ya no corresponde.
  useEffect(() => {
    setEstado({ fase: "reposo" });
    setVerOriginal(false);
  }, [texto, locale]);

  const origen = idiomaDelTexto(texto);
  const traducido = estado.fase === "listo" && !verOriginal;

  const traducir = async () => {
    if (!origen) {
      return;
    }
    setEstado({ fase: "traduciendo", pct: null });
    try {
      const salida = await traducirTexto(texto, origen, locale, (pct) =>
        setEstado({ fase: "traduciendo", pct }),
      );
      setEstado({ fase: "listo", texto: salida });
      setVerOriginal(false);
    } catch {
      setEstado({ fase: "fallo" });
    }
  };

  const alternarOriginal = () => setVerOriginal((v) => !v);

  return (
    <div data-testid="texto-traducible">
      <p
        className={className}
        lang={traducido ? locale : (origen ?? undefined)}
      >
        {estado.fase === "listo" && !verOriginal ? estado.texto : texto}
      </p>
      {origen && origen !== locale && (
        <ControlesDeTraduccion
          estado={estado}
          verOriginal={verOriginal}
          onAlternar={alternarOriginal}
          onTraducir={traducir}
          nativo={nativo}
          traducido={traducido}
          acento={acento}
        />
      )}
    </div>
  );
}

type Traductor = ReturnType<typeof useI18n>["t"];
type Locale = ReturnType<typeof useI18n>["locale"];

/** Rótulo del botón mientras no hay traducción: traduciendo, descargando el modelo (%) o la oferta. */
function rotuloDeTraducir(
  estado: Estado,
  t: Traductor,
  locale: Locale,
): string {
  if (estado.fase !== "traduciendo") {
    return t("traduccion.traducir", { idioma: NOMBRE_PROPIO[locale] });
  }
  if (estado.pct === null) {
    return t("traduccion.traduciendo");
  }
  return t("traduccion.descargando", { pct: estado.pct });
}

/** Botón de traducir / ver original y los avisos que lo acompañan. */
function ControlesDeTraduccion({
  estado,
  verOriginal,
  onAlternar,
  onTraducir,
  nativo,
  traducido,
  acento,
}: Readonly<{
  estado: Estado;
  verOriginal: boolean;
  onAlternar: () => void;
  onTraducir: () => void;
  nativo: boolean;
  traducido: boolean;
  acento?: string;
}>) {
  const { locale, t } = useI18n();
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-dex-muted">
      {estado.fase === "listo" ? (
        <button
          type="button"
          onClick={onAlternar}
          className="underline hover:text-dex-ink"
          style={{ color: acento }}
        >
          {verOriginal
            ? t("traduccion.traducir", { idioma: NOMBRE_PROPIO[locale] })
            : t("traduccion.original")}
        </button>
      ) : (
        <button
          type="button"
          onClick={onTraducir}
          disabled={estado.fase === "traduciendo"}
          data-testid="boton-traducir"
          className="underline hover:text-dex-ink disabled:cursor-wait disabled:no-underline disabled:opacity-70"
          style={{ color: acento }}
        >
          {rotuloDeTraducir(estado, t, locale)}
        </button>
      )}
      {estado.fase === "fallo" && (
        <span role="alert" className="text-amber-200">
          {t("traduccion.fallo")}
        </span>
      )}
      {estado.fase === "reposo" && !nativo && (
        <span>{t("traduccion.avisoDescarga")}</span>
      )}
      {traducido && <span>{t("traduccion.aviso")}</span>}
    </div>
  );
}

export default TextoTraducible;
