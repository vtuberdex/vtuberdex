/**
 * Detalle del VTuber: carta 3D grande + ficha, stats, habilidades y redes.
 * Reúne lo que en el origen estaba repartido entre index.html y 194 páginas
 * "terminal" copiadas a mano (con enlaces rotos), ahora desde una sola API.
 */
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { api } from '../../lib/api';
import { cardPalette, gradientCss, mixHex, rgba } from '../../lib/color';
import type { VtuberDetail, Neighbors } from '../../lib/types';
import { HoloCard } from '../card3d/HoloCard';
import { SkillList } from './SkillList';
import { StatBars } from './StatBars';
import { ProfileGrid } from './ProfileGrid';
import { SocialLinks } from './SocialLinks';

type Payload = (VtuberDetail & { neighbors: Neighbors }) | null;

/**
 * Intensidad de las dos capas de la carta (no hay controles en la UI): reflejo
 * realista y holografía, ambas al 50%.
 *
 * La intensidad global se queda en 0.5: bajar el `uHolo` solo DEBILITABA la
 * holografía en conjunto sin quitarle saturación al color. El ajuste que hacía
 * falta es el peso de la capa en el shader (`holoLayer`), que controla cuánto de
 * ese color se suma al arte.
 */
export const GLOSS_INTENSITY = 0.5;
export const HOLO_INTENSITY = 0.5;

export function DetailPage() {
  const { slug = '' } = useParams();
  const [data, setData] = useState<Payload>(null);
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
        <Link to="/" className="mt-6 inline-block rounded-lg border border-dex-accent/60 px-4 py-2 text-sm text-dex-accent">
          Volver al catálogo
        </Link>
      </div>
    );
  }

  const palette = cardPalette(data.themeColor, data.secondaryColor);
  const primary = data.countries[0] ?? null;

  return (
    <article className="mx-auto max-w-[1400px] px-4 pb-20 pt-6 sm:px-6 lg:px-8">
      <nav className="mb-5 flex items-center gap-3 text-xs text-dex-muted">
        <Link to="/" className="hover:text-dex-ink">
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
            <HoloCard card={data} holo={HOLO_INTENSITY} gloss={GLOSS_INTENSITY} className="aspect-[5/7] w-full" />
          </div>

          {data.images.radar && (
            <figure className="mt-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
              <figcaption className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Radar de atributos</figcaption>
              <img src={data.images.radar} alt={`Radar de ${data.name}`} className="mx-auto max-h-64" loading="lazy" />
            </figure>
          )}
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
              {data.images.logo && (
                /**
                 * Logo del header de la ficha: ALTO FIJO, ANCHO relativo.
                 *
                 * Reglas (medidas, no estimadas):
                 *   - El bloque de texto del header mide 118px en desktop/laptop y
                 *     103px en móvil, así que el tope de "2x el header" es ~236px.
                 *   - El ALTO se fija ahí con un valor fluido que respeta el tope:
                 *     `clamp(96px, 22vw, 236px)`. Usar `em` no servía: el logo vive
                 *     dentro de un `flex`, donde su tamaño relativo no lo marca el
                 *     texto del header.
                 *   - El ANCHO es libre (`w-auto`), con un tope del 100% del
                 *     contenedor para que no desborde en móvil. Así un logo
                 *     apaisado crece a lo ancho y uno cuadrado se queda en 236.
                 *   - `object-contain` evita cualquier deformación.
                 * Antes era `h-auto w-full`: el alto lo decidía la proporción del
                 * archivo y llegaba a 251px, por encima del límite pedido.
                 */
                <img
                  src={data.images.logo}
                  alt={`Logo de ${data.name}`}
                  style={{ height: 'clamp(96px, 22vw, 236px)' }}
                  className="w-auto max-w-full object-contain drop-shadow-[0_6px_18px_rgba(0,0,0,0.6)]"
                />
              )}
            </div>

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
                  to={`/?factions=${encodeURIComponent(faction.toLowerCase().replace(/\s+/g, '-'))}`}
                  className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide text-black/85"
                  style={{ background: gradientCss(palette.accent, palette.secondary) }}
                >
                  {faction}
                </Link>
              ))}
              {data.groups.map((group) => (
                <Link
                  key={group}
                  to={`/?groups=${encodeURIComponent(group.toLowerCase().replace(/\s+/g, '-'))}`}
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
              <Link to={`/v/${data.neighbors.prev.slug}`} className="text-dex-muted hover:text-dex-ink">
                ← #{String(data.neighbors.prev.dexNumber).padStart(3, '0')} {data.neighbors.prev.name}
              </Link>
            ) : (
              <span />
            )}
            {data.neighbors.next ? (
              <Link to={`/v/${data.neighbors.next.slug}`} className="text-right text-dex-muted hover:text-dex-ink">
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
