'use client';
/**
 * Carta del catálogo en 2D: el enlace a la ficha con el arte del personaje.
 *
 * ANTES montaba su propio `HoloCard` (un canvas WebGL por carta) y `card-visibility.ts`
 * repartía los contextos entre las tarjetas visibles porque el navegador no sostiene
 * más de 16. Eso ya no existe: la carta 3D del catálogo vive en el libro
 * (`card-binder.tsx`), que dibuja las 8 en UN solo canvas. Esta tarjeta queda como la
 * vista de RESPALDO del libro (sin WebGL, `prefers-reduced-motion`, contexto perdido) y
 * como el nodo del DOM que un lector de pantalla puede seguir.
 *
 * SIN MARCO EXTERIOR: el número, el nombre y el país los dibuja la carta (en 3D su
 * textura; aquí la vista 2D con el arte y el número). Fuera solo queda el `<Link>` que
 * la hace navegable, con el `aria-label` que nombra la carta.
 */
import Link from 'next/link';

import type { VtuberCard } from '@/lib/types';
import { CardFallback } from '@/components/holo-card';

export interface CardTileProps {
  card: VtuberCard;
  /** Índice en la hoja: escalona la animación de entrada. */
  index?: number;
}

export function CardTile({ card, index = 0 }: CardTileProps) {
  return (
    <Link
      href={`/v/${card.slug}`}
      data-testid="card-tile"
      data-dex={card.dexNumber}
      className="group relative block rounded-2xl transition-transform duration-200 ease-out hover:-translate-y-1.5 focus-visible:-translate-y-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dex-accent"
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
      aria-label={`${card.name}, VTuber número ${card.dexNumber}`}
    >
      {/*
        Proporción REAL de carta coleccionable (1008x1411 = 1.4), la misma del libro y
        del detalle: el arte entra sin deformarse y la hoja del respaldo mide lo mismo
        que la hoja 3D.
      */}
      <div className="relative aspect-[5/7] overflow-hidden rounded-2xl">
        <CardFallback card={card} className="h-full w-full" />
      </div>
    </Link>
  );
}

export default CardTile;
