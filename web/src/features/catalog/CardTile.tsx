/**
 * Carta compacta para los resultados de búsqueda (CSS 3D, sin WebGL).
 *
 * En una grilla de 24 cartas, 24 contextos WebGL matarían el rendimiento; aquí
 * se usa perspectiva CSS + gradientes para el brillo, con el mismo lenguaje
 * visual (color de marca, número, país, tipos) que la carta WebGL.
 */
import { useId } from 'react';
import { Link } from 'react-router-dom';

import type { VtuberCard } from '../../lib/types';
import { cardPalette, gradientCss, rgba } from '../../lib/color';
import { CountryBadge } from '../../components/CountryBadge';

export interface CardTileProps {
  card: VtuberCard;
  /** Índice en la grilla: escalona la animación de entrada. */
  index?: number;
}

export function CardTile({ card, index = 0 }: CardTileProps) {
  const gradientId = useId();
  const palette = cardPalette(card.themeColor, card.secondaryColor);
  const primary = card.countries[0] ?? null;

  return (
    <Link
      to={`/v/${card.slug}`}
      data-testid="card-tile"
      data-dex={card.dexNumber}
      className="group relative block rounded-2xl border border-white/10 bg-dex-panel/70 p-[1px] transition-transform duration-200 ease-out hover:-translate-y-1.5 focus-visible:-translate-y-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dex-accent"
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
      aria-label={`${card.name}, VTuber número ${card.dexNumber}`}
    >
      {/* Borde luminoso con el color del VTuber. */}
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl opacity-60 transition-opacity group-hover:opacity-100"
        style={{ background: gradientCss(palette.accent, palette.secondary), filter: 'blur(9px)' }}
        aria-hidden
      />

      <article className="relative overflow-hidden rounded-2xl bg-dex-panel">
        {/* Cabecera: número + nombre + país. */}
        <header
          className="flex items-center gap-2 px-3 py-2"
          style={{ background: gradientCss(rgba(palette.accent, 0.92), rgba(palette.secondary, 0.7)) }}
        >
          <span className="rounded-md bg-black/55 px-2 py-0.5 font-mono text-[11px] font-bold text-white">
            #{String(card.dexNumber).padStart(3, '0')}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-extrabold uppercase tracking-wide text-black/90">
            {card.name}
          </h3>
          {primary && <CountryBadge country={primary} />}
        </header>

        {/* Arte con brillo holográfico que sigue al cursor. Se usa el PERSONAJE
            recortado, que llega normalizado al lienzo de carta (720x1008): al
            tener ya la proporción correcta, recortarlo aquí no deforma nada.
            La FICHA apaisada del sitio es el respaldo cuando no hay personaje
            (es legacy: una captura, no una carta) y solo aparece en ese caso. */}
        <div className="relative aspect-[5/6] overflow-hidden bg-black/45">
          {card.images.character || card.images.card ? (
            <img
              src={(card.images.character ?? card.images.card) as string}
              alt={card.name}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.06]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-dex-muted">Sin imagen</div>
          )}

          <div
            className="pointer-events-none absolute inset-0 opacity-0 mix-blend-screen transition-opacity duration-300 group-hover:opacity-70"
            style={{
              background: `linear-gradient(115deg, transparent 30%, ${rgba(palette.sheen, 0.55)} 48%, transparent 62%)`,
              backgroundSize: '220% 220%',
            }}
            aria-hidden
          />

          {card.images.logo && (
            /* Logo grande, abajo a la derecha y SIN fondo ni caja: va sobre el
               degradado oscuro del arte, que ya da contraste suficiente. */
            <img
              src={card.images.logo}
              alt=""
              aria-hidden
              loading="lazy"
              className="absolute bottom-2 right-2 h-auto w-auto max-h-[38%] max-w-[95%] object-contain object-right drop-shadow-[0_4px_10px_rgba(0,0,0,0.8)]"
            />
          )}

          <svg className="absolute bottom-0 left-0 h-3 w-full" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="1">
                <stop offset="0%" stopColor={palette.accent} />
                <stop offset="100%" stopColor={palette.secondary} />
              </linearGradient>
            </defs>
            <rect width="100" height="12" fill={`url(#${gradientId})`} opacity="0.85" />
          </svg>
        </div>

        {/* Pie: tipos y estado de la ficha. */}
        <footer className="flex flex-wrap items-center gap-1 px-3 py-2">
          {[...card.factions, ...card.groups].slice(0, 2).map((type) => (
            <span
              key={type}
              className="truncate rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black/85"
              style={{ background: gradientCss(palette.accent, palette.secondary) }}
            >
              {type}
            </span>
          ))}
          <span className="ml-auto font-mono text-[10px] text-dex-muted">
            {card.hasDetail ? `LV ${card.level ?? '-'} · ${card.powerScore ?? 0} PW` : 'básica'}
          </span>
        </footer>
      </article>
    </Link>
  );
}

export default CardTile;
