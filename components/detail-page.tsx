'use client';
/**
 * Detalle del VTuber: carta 3D grande + ficha, stats, habilidades y redes.
 * Reúne lo que en el origen estaba repartido entre index.html y 194 páginas
 * "terminal" copiadas a mano (con enlaces rotos), ahora desde una sola API.
 *
 * El `slug` llega por props (la página de ruta lo lee de los params del App
 * Router) en vez de por `useParams` de react-router: así el componente no
 * depende del enrutador y los tests pueden montarlo con cualquier slug.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { cardPalette, gradientCss, mixHex, rgba } from '@/lib/color';
import type { VtuberDetail, Neighbors } from '@/lib/types';
import { HoloCard } from '@/components/holo-card';
import { INTENSITY } from '@/components/card3d-config';
import { SkillList } from '@/components/skill-list';
import { StatBars } from '@/components/stat-bars';
import { ProfileGrid } from '@/components/profile-grid';
import { SocialLinks } from '@/components/social-links';

type Payload = (VtuberDetail & { neighbors: Neighbors }) | null;

export function DetailPage({ slug }: { slug: string }) {
  const [data, setData] = useState<Payload>(null);
  /**
   * Panel de ajuste en vivo, SOLO si la URL trae `?tune=1`. Se importa de forma
   * dinámica para que no entre en el bundle de quien solo quiere ver la ficha: es un
   * banco de trabajo, no una función del producto.
   */
  const [Tuner, setTuner] = useState<null | typeof import('@/components/card3d-tuner').Card3dTuner>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setData(null);
    api
      .detail(slug, controller.signal)
      .then((response) => setData(response))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'error desconocido');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [slug]);

  useEffect(() => {
    // `window` solo en un efecto: leerlo durante el render rompe el render del servidor.
    if (new URLSearchParams(window.location.search).get('tune') !== '1') return;
    void import('@/components/card3d-tuner').then((m) => setTuner(() => m.Card3dTuner));
  }, []);

  useEffect(() => {
    document.title = data ? `${data.name} · VTuberDex` : 'VTuberDex';
    return () => {
      document.title = 'VTuberDex';
    };
  }, [data]);

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6 lg:px-8" data-testid="detail-loading">
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

  if (error || !data) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-extrabold text-dex-ink">VTuber no encontrado</h1>
        <p className="mt-2 text-sm text-dex-muted">
          {error === 'no_encontrado' ? 'Ese slug no existe en el catálogo.' : error}
        </p>
        <Link href="/" className="mt-6 inline-block rounded-lg border border-dex-accent/60 px-4 py-2 text-sm text-dex-accent">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  const palette = cardPalette(data.themeColor, data.secondaryColor);
  const primary = data.countries[0] ?? null;

  return (
    <article className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-8">
      {Tuner ? <Tuner /> : null}

      <nav className="mb-5 flex items-center gap-3 text-xs text-dex-muted">
        <Link href="/" className="hover:text-dex-ink">
          ← Catálogo
        </Link>
        <span aria-hidden>/</span>
        <span className="font-mono">#{String(data.dexNumber).padStart(3, '0')}</span>
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
              background: `linear-gradient(160deg, ${palette.deep} 0%, ${mixHex(palette.accent, '#05060a', 0.92)} 42%, ${mixHex(palette.accent, '#080a10', 0.95)} 100%)`,
            }}
          >
            <HoloCard
              card={data}
              holo={INTENSITY.holo.detail}
              gloss={INTENSITY.gloss.detail}
              className="aspect-[5/7] w-full"
            />
          </div>

          {/*
            Aquí estaba el bloque del RADAR de atributos (una imagen raster del
            sitio). Se eliminó junto con su carpeta: `StatBars` dibuja los MISMOS
            datos desde la base, unas líneas más abajo, así que era información
            duplicada — y en formato que no se puede tematizar ni escalar.
          */}
        </div>

        {/* Datos */}
        <div className="min-w-0 space-y-6">
          <header className="rounded-2xl border border-dex-line p-5" style={{ background: gradientCss(rgba(palette.accent, 0.12), rgba(palette.secondary, 0.08)) }}>
            <div className="flex flex-wrap items-start gap-4">
              <span className="rounded-lg bg-black/50 px-3 py-1.5 font-mono text-sm font-bold text-white">
                #{String(data.dexNumber).padStart(3, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <h1 className="text-3xl font-extrabold leading-tight text-dex-ink sm:text-4xl">{data.name}</h1>
                <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-dex-muted">
                  {primary && (
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>{primary.flag?.trim() || '🏳️'}</span>
                      {data.countries.map((country) => country.name).join(' · ')}
                    </span>
                  )}
                  {!primary && <span>Sin país registrado</span>}
                  <span aria-hidden>•</span>
                  <span>{data.hasDetail ? 'Ficha completa' : 'Ficha básica'}</span>
                </p>
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

            {data.phrase && <p className="mt-4 max-w-3xl text-sm leading-relaxed text-dex-ink/90">{data.phrase}</p>}

            {/* Texto personalizado impreso en la carta (OCR). Suele ser una
                historia larga que NO está en el HTML: es el único sitio donde
                existe para las 574 fichas sin página de detalle. */}
            {data.cardText && (
              <section className="mt-5 rounded-2xl border border-dex-line/70 bg-black/25 p-4">
                <header className="mb-2 flex flex-wrap items-center gap-2">
                  <h2 className="text-xs font-bold uppercase tracking-[0.16em]" style={{ color: palette.accent }}>
                    Su historia
                  </h2>
                  {data.cardTextConfidence !== null && (
                    <span
                      className="rounded-full border border-dex-line px-2 py-0.5 font-mono text-[10px] text-dex-muted"
                      title="Fiabilidad de la lectura OCR del texto impreso en la carta"
                    >
                      OCR {data.cardTextConfidence}%
                    </span>
                  )}
                </header>
                <p className="whitespace-pre-line text-sm leading-relaxed text-dex-ink/85">{data.cardText}</p>
              </section>
            )}

            {/* Tipos: facciones + grupos + artistas */}
            <div className="mt-4 flex flex-wrap gap-2">
              {data.factions.map((faction) => (
                <Link
                  key={faction}
                  href={`/?factions=${encodeURIComponent(faction.toLowerCase().replace(/\s+/g, '-'))}`}
                  className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-black/85"
                  style={{ background: gradientCss(palette.accent, palette.secondary) }}
                >
                  {faction}
                </Link>
              ))}
              {data.groups.map((group) => (
                <Link
                  key={group}
                  href={`/?groups=${encodeURIComponent(group.toLowerCase().replace(/\s+/g, '-'))}`}
                  className="rounded-full border border-dex-line px-3 py-1 text-xs font-semibold text-dex-muted hover:text-dex-ink"
                >
                  {group}
                </Link>
              ))}
              {data.artists.map((artist) => (
                <span key={artist} className="rounded-full border border-dex-line px-3 py-1 text-xs text-dex-muted">
                  {artist}
                </span>
              ))}
            </div>
          </header>

          <div className="grid gap-6 xl:grid-cols-2">
            <ProfileGrid profile={data.profile} palette={palette} />
            <StatBars stats={data.stats} palette={palette} level={data.level} experience={data.experience} />
          </div>

          <SkillList skills={data.skills} palette={palette} />

          {data.socials.length > 0 && <SocialLinks socials={data.socials} palette={palette} />}

          {/* Navegación entre vecinos de la dex. */}
          <nav className="flex items-center justify-between gap-3 border-t border-dex-line pt-5 text-sm">
            {data.neighbors.prev ? (
              <Link href={`/v/${data.neighbors.prev.slug}`} className="text-dex-muted hover:text-dex-ink">
                ← #{String(data.neighbors.prev.dexNumber).padStart(3, '0')} {data.neighbors.prev.name}
              </Link>
            ) : (
              <span />
            )}
            {data.neighbors.next ? (
              <Link href={`/v/${data.neighbors.next.slug}`} className="text-right text-dex-muted hover:text-dex-ink">
                #{String(data.neighbors.next.dexNumber).padStart(3, '0')} {data.neighbors.next.name} →
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </div>
      </div>
    </article>
  );
}

export default DetailPage;
