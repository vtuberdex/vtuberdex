// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Detalle del VTuber: carta 3D grande + ficha, stats, habilidades y redes.
 * Reúne lo que en el origen estaba repartido entre index.html y 194 páginas
 * "terminal" copiadas a mano (con enlaces rotos), ahora desde una sola API.
 *
 * El `slug` llega por props (la página de ruta lo lee de los params del App
 * Router) en vez de por `useParams` de react-router: así el componente no
 * depende del enrutador y los tests pueden montarlo con cualquier slug.
 */
import { VrtonBanners } from "@/components/vrton-banners";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { VoiceButton } from "@/components/voice-button";
import { limpiarAbriendo } from "@/lib/abriendo-detalle";
import { rutaDelCatalogo } from "@/lib/volver-al-catalogo";

import { api, type LikeResumen } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { nombreDePais } from "@/lib/i18n/nombres";
import { cardPalette, gradientCss, mixHex, rgba } from "@/lib/color";
import type { VtuberDetail, Neighbors } from "@/lib/types";
import { HoloCard } from "@/components/holo-card";
import { INTENSITY } from "@/components/card3d-config";
import { SkillList } from "@/components/skill-list";
import { StatBars } from "@/components/stat-bars";
import { ProfileGrid } from "@/components/profile-grid";
import { SocialLinks } from "@/components/social-links";
import { DirectoEnVivo } from "@/components/directo-en-vivo";
import { PremiumBadge } from "@/components/premium-badge";
import { DonatePayPal } from "@/components/donate-paypal";
import { LikeButton } from "@/components/like-button";
import { TextoTraducible } from "@/components/texto-traducible";

type Payload = (VtuberDetail & { neighbors: Neighbors }) | null;

export function DetailPage({ slug }: Readonly<{ slug: string }>) {
  const { t } = useI18n();
  const [data, setData] = useState<Payload>(null);
  /**
   * Panel de ajuste en vivo, SOLO si la URL trae `?tune=1`. Se importa de forma
   * dinámica para que no entre en el bundle de quien solo quiere ver la ficha: es un
   * banco de trabajo, no una función del producto.
   */
  const [Tuner, setTuner] = useState<
    null | typeof import("@/components/card3d-tuner").Card3dTuner
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Dónde estaba el visitante en el catálogo (página y filtros); se lee tras hidratar: el servidor no tiene `sessionStorage`. */
  const [volverA, setVolverA] = useState("/");
  useEffect(() => {
    setVolverA(rutaDelCatalogo());
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    api
      .detail(slug, controller.signal)
      .then((response) => setData(response))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setError(cause instanceof Error ? cause.message : "error desconocido");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    // `window` solo en un efecto: leerlo durante el render rompe el render del servidor.
    if (new URLSearchParams(window.location.search).get("tune") !== "1") {
      return;
    }
    void import("@/components/card3d-tuner").then((m) =>
      setTuner(() => m.Card3dTuner),
    );
  }, []);

  useEffect(() => {
    /**
     * Si se entró por una URL ANTERIOR de la ficha (el mantenedor le cambió el slug), la API
     * responde con la ficha y su slug actual: se corrige la barra de direcciones sin recargar,
     * para que lo que se comparta desde aquí sea la URL vigente.
     */
    if (data && data.slug !== slug) {
      window.history.replaceState(null, "", `/v/${data.slug}`);
    }
  }, [data, slug]);

  // Con datos (o con el error) ya no hace falta el aviso «Accediendo al detalle».
  useEffect(() => {
    if (!loading) {
      limpiarAbriendo();
    }
  }, [loading]);

  useEffect(() => {
    document.title = data ? `${data.name} · VTuberDex` : "VTuberDex";
    return () => {
      document.title = "VTuberDex";
    };
  }, [data]);

  /** Tras dar o leer un like: nivel, barra y total se actualizan sin volver a pedir la ficha. */
  const aplicarLikes = useCallback(
    (resumen: LikeResumen) =>
      setData((actual) =>
        actual
          ? {
              ...actual,
              likes: resumen.likes,
              level: resumen.level,
              experience: resumen.experience,
            }
          : actual,
      ),
    [],
  );

  if (loading) {
    return <DetalleCargando />;
  }

  if (error || !data) {
    return <DetalleNoEncontrado error={error} />;
  }

  const palette = cardPalette(data.themeColor, data.secondaryColor);

  return (
    <article className="mx-auto max-w-[1600px] px-4 pb-20 pt-6 sm:px-6 lg:px-8">
      <VrtonBanners>
        <div className="mx-auto w-full min-w-0 max-w-[1400px]">
          {Tuner ? <Tuner /> : null}

          <nav className="mb-5 flex items-center gap-3 text-xs text-dex-muted">
            <Link
              href={volverA}
              className="hover:text-dex-ink"
              data-testid="volver-catalogo"
            >
              {t("detalle.catalogo")}
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono">
              #{String(data.dexNumber).padStart(3, "0")}
            </span>
          </nav>

          <div className="grid gap-8 lg:grid-cols-[minmax(300px,440px)_1fr]">
            {/* Carta 3D */}
            <div className="lg:sticky lg:top-6 lg:self-start">
              <div
                className="relative overflow-hidden rounded-3xl border border-dex-line p-3"
                /**
                 * Fondo del contenedor: derivado del color PRIMARIO del VTuber, en
                 * oscuro pero no negro.
                 *
                 * Se probó en claro y perdía la identidad del personaje: el fondo es
                 * parte de la ficha. El degradado va del primario oscurecido (`deep`) a
                 * un tono un poco más claro y con más presencia del color en la esquina,
                 * de modo que se lee el matiz del VTuber sin competir con la carta.
                 */
                style={{
                  background: `linear-gradient(160deg, ${palette.deep} 0%, ${mixHex(palette.accent, "#05060a", 0.92)} 42%, ${mixHex(palette.accent, "#080a10", 0.95)} 100%)`,
                }}
              >
                {/* La voz vive sobre el borde de la carta: es de la carta, no un dato más de la ficha. */}
                <div className="absolute right-3 top-3 z-10">
                  <VoiceButton slug={data.slug} flotante />
                </div>
                <HoloCard
                  card={data}
                  holo={INTENSITY.holo.detail}
                  gloss={INTENSITY.gloss.detail}
                  className="aspect-[5/7] w-full"
                />
              </div>

              <DonatePayPal
                premium={data.premium}
                card={{ dexNumber: data.dexNumber, name: data.name }}
              />

              {/*
            Aquí estaba el bloque del RADAR de atributos (una imagen raster del
            sitio). Se eliminó junto con su carpeta: `StatBars` dibuja los MISMOS
            datos desde la base, unas líneas más abajo, así que era información
            duplicada — y en formato que no se puede tematizar ni escalar.
          */}
            </div>

            {/* Datos */}
            <div className="min-w-0 space-y-6">
              <header
                className="rounded-2xl border border-dex-line p-5"
                style={{
                  background: gradientCss(
                    rgba(palette.accent, 0.12),
                    rgba(palette.secondary, 0.08),
                  ),
                }}
              >
                <div className="flex flex-wrap items-start gap-4">
                  <span className="rounded-lg bg-black/50 px-3 py-1.5 font-mono text-sm font-bold text-white">
                    #{String(data.dexNumber).padStart(3, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h1 className="text-3xl font-extrabold leading-tight text-dex-ink sm:text-4xl">
                      {data.name}
                    </h1>
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-dex-muted">
                      <PaisDeLaFicha data={data} />
                      <span aria-hidden>•</span>
                      <span>
                        {data.hasDetail
                          ? t("detalle.fichaCompleta")
                          : t("detalle.fichaBasica")}
                      </span>
                    </p>
                    <AvisosDeLaFicha data={data} />
                  </div>
                </div>

                {/*
              Aquí iba el LOGO del header de la ficha, como `<img>` suelto en su propia
              fila centrada. Se retiró: la marca ya se dibuja DENTRO de la carta 3D
              (capa 2 + sticker, con su paralaje, su metal y sus efectos), así que la
              ficha mostraba el MISMO logo dos veces en la misma pantalla — el de la
              carta y este. Queda uno solo, el de la carta, que es el que lleva el
              acabado de la pieza; este era un duplicado plano sin tratamiento.
            */}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <LikeButton
                    slug={data.slug}
                    likes={data.likes ?? 0}
                    onChange={aplicarLikes}
                  />
                </div>

                {data.phrase && (
                  <div className="mt-4 max-w-3xl">
                    <TextoTraducible
                      texto={data.phrase}
                      className="text-sm leading-relaxed text-dex-ink/90"
                      acento={palette.accent}
                    />
                  </div>
                )}

                {/* Texto personalizado impreso en la carta (OCR). Suele ser una
                historia larga que NO está en el HTML: es el único sitio donde
                existe para las 574 fichas sin página de detalle. */}
                {data.cardText && (
                  <HistoriaDeLaFicha
                    texto={data.cardText}
                    confianza={data.cardTextConfidence}
                    acento={palette.accent}
                  />
                )}

                {/* Tipos: facciones + grupos + artistas */}
                <TiposDeLaFicha data={data} palette={palette} />
              </header>

              <div className="grid gap-6 xl:grid-cols-2">
                <ProfileGrid profile={data.profile} palette={palette} />
                <StatBars
                  stats={data.stats}
                  palette={palette}
                  level={data.level}
                  experience={data.experience}
                />
              </div>

              <SkillList skills={data.skills} palette={palette} />

              {data.socials.length > 0 && (
                <DirectoEnVivo slug={data.slug} palette={palette} />
              )}

              {data.socials.length > 0 && (
                <SocialLinks socials={data.socials} palette={palette} />
              )}

              {/* Navegación entre vecinos de la dex. */}
              <VecinosDeLaFicha neighbors={data.neighbors} />
            </div>
          </div>
        </div>
      </VrtonBanners>
    </article>
  );
}

type Traductor = ReturnType<typeof useI18n>["t"];

/** Texto del error del detalle: los dos códigos conocidos se traducen; el resto se muestra tal cual. */
function mensajeDeError(error: string | null, t: Traductor): string | null {
  if (error === "no_encontrado") {
    return t("detalle.slugInexistente");
  }
  if (error === "error desconocido") {
    return t("detalle.errorDesconocido");
  }
  return error;
}

function DetalleCargando() {
  return (
    <div
      className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8"
      data-testid="detail-loading"
    >
      <div className="grid gap-8 lg:grid-cols-[minmax(280px,420px)_1fr]">
        <div className="dex-skeleton aspect-[5/7] rounded-3xl" />
        <div className="space-y-4">
          <div className="dex-skeleton h-12 rounded-xl" />
          <div className="dex-skeleton h-32 rounded-xl" />
          <div className="dex-skeleton h-64 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function DetalleNoEncontrado({ error }: Readonly<{ error: string | null }>) {
  const { t } = useI18n();
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="text-2xl font-extrabold text-dex-ink">
        {t("detalle.noEncontrado")}
      </h1>
      <p className="mt-2 text-sm text-dex-muted">{mensajeDeError(error, t)}</p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg border border-dex-accent/60 px-4 py-2 text-sm text-dex-accent"
      >
        {t("detalle.volverCatalogo")}
      </Link>
    </div>
  );
}

type Ficha = VtuberDetail & { neighbors: Neighbors };

/** País (o países) de la ficha con la bandera del primero; sin país, el aviso. */
function PaisDeLaFicha({ data }: Readonly<{ data: Ficha }>) {
  const { t, locale } = useI18n();
  const primary = data.countries[0] ?? null;
  return (
    <>
      {primary && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden>{primary.flag?.trim() || "🏳️"}</span>
          {data.countries
            .map((country) => nombreDePais(locale, country))
            .join(" · ")}
        </span>
      )}
      {!primary && <span>{t("detalle.sinPais")}</span>}
    </>
  );
}

/** Graduado, sin correo y premium: las marcas que acompañan al nombre. */
function AvisosDeLaFicha({ data }: Readonly<{ data: Ficha }>) {
  const { t } = useI18n();
  return (
    <>
      {data.graduado && (
        <p
          className="mt-3 inline-flex rounded border border-dex-muted/40 bg-black/30 px-2 py-1 text-xs"
          data-testid="graduado"
        >
          <strong>🎓 {t("detalle.graduado")}</strong>
        </p>
      )}
      {data.sinCorreo && (
        <p
          className="mt-3 inline-flex flex-wrap items-center gap-x-2 rounded border border-dex-muted/40 bg-black/30 px-2 py-1 text-xs"
          data-testid="sin-correo"
        >
          <strong>{t("detalle.sinCorreoTitulo")}</strong>
          <span className="text-dex-muted">
            (
            {t("detalle.sinCorreoAyuda", {
              correo: "madkoding@gmail.com",
            })}
            )
          </span>
        </p>
      )}
      {data.premium && (
        <p
          className="mt-3 flex flex-wrap items-center gap-2 text-xs text-dex-muted"
          data-testid="premium-info"
        >
          <PremiumBadge premium={data.premium} />
          <span className="font-mono">{data.premium.cert}</span>
          <span aria-hidden>•</span>
          <span>
            {t("detalle.premiumDesde", {
              fecha: data.premium.since,
            })}
          </span>
        </p>
      )}
    </>
  );
}

/** Historia impresa en la carta (OCR), con su confianza si se conoce. */
function HistoriaDeLaFicha({
  texto,
  confianza,
  acento,
}: Readonly<{ texto: string; confianza: number | null; acento: string }>) {
  const { t } = useI18n();
  return (
    <section className="mt-5 rounded-2xl border border-dex-line/70 bg-black/25 p-4">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <h2
          className="text-xs font-bold uppercase tracking-[0.16em]"
          style={{ color: acento }}
        >
          {t("detalle.historia")}
        </h2>
        {confianza !== null && (
          <span
            className="rounded-full border border-dex-line px-2 py-0.5 font-mono text-[10px] text-dex-muted"
            title={t("detalle.ocrAyuda")}
          >
            OCR {confianza}%
          </span>
        )}
      </header>
      <TextoTraducible
        texto={texto}
        className="whitespace-pre-line text-sm leading-relaxed text-dex-ink/85"
        acento={acento}
      />
    </section>
  );
}

/** Tipos: facciones + grupos + artistas. */
function TiposDeLaFicha({
  data,
  palette,
}: Readonly<{ data: Ficha; palette: ReturnType<typeof cardPalette> }>) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {data.factions.map((faction) => (
        <Link
          key={faction}
          // El slug real de la facción (`heaven-s-arbiter`): derivarlo de la etiqueta daba
          // `heaven's-arbiter` y el filtro no encontraba nada.
          href={`/?factions=${encodeURIComponent(
            data.factionIcons?.find((icon) => icon.label === faction)?.slug ??
              faction.toLowerCase().replace(/\s+/g, "-"),
          )}`}
          className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-black/85"
          style={{
            background: gradientCss(palette.accent, palette.secondary),
          }}
        >
          {faction}
        </Link>
      ))}
      {data.groups.map((group) => (
        <Link
          key={group}
          href={`/?groups=${encodeURIComponent(group.toLowerCase().replace(/\s+/g, "-"))}`}
          className="rounded-full border border-dex-line px-3 py-1 text-xs font-semibold text-dex-muted hover:text-dex-ink"
        >
          {group}
        </Link>
      ))}
      {data.artists.map((artist) => (
        <span
          key={artist}
          className="rounded-full border border-dex-line px-3 py-1 text-xs text-dex-muted"
        >
          {artist}
        </span>
      ))}
    </div>
  );
}

/** Navegación entre vecinos de la dex. */
function VecinosDeLaFicha({ neighbors }: Readonly<{ neighbors: Neighbors }>) {
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-dex-line pt-5 text-sm">
      {neighbors.prev ? (
        <Link
          href={`/v/${neighbors.prev.slug}`}
          className="text-dex-muted hover:text-dex-ink"
        >
          ← #{String(neighbors.prev.dexNumber).padStart(3, "0")}{" "}
          {neighbors.prev.name}
        </Link>
      ) : (
        <span />
      )}
      {neighbors.next ? (
        <Link
          href={`/v/${neighbors.next.slug}`}
          className="text-right text-dex-muted hover:text-dex-ink"
        >
          #{String(neighbors.next.dexNumber).padStart(3, "0")}{" "}
          {neighbors.next.name} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export default DetailPage;
