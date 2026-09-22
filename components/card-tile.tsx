'use client';
/**
 * Carta de la grilla del catálogo.
 *
 * Muestra la MISMA carta holográfica 3D del detalle (`HoloCard` con WebGL): el
 * marco, el número, el nombre, el país con su bandera, los tipos, el nivel, el
 * poder, el logo, el canto metálico y el barrido holográfico los dibuja la textura
 * de `card-texture.ts` y lo encienden los shaders.
 *
 * SIN MARCO EXTERIOR
 * ------------------
 * Antes la tarjeta envolvía la carta en una cabecera y un pie propios (número,
 * nombre, país, chips de tipo, LV/PW) que REPETÍAN lo que la carta ya dibuja en su
 * textura: el mismo número y el mismo nombre aparecían dos veces, y el marco
 * ocupaba más alto que la propia carta. Ahora la carta ES la tarjeta; fuera solo
 * queda el `<Link>` que la hace navegable.
 *
 * VISIBILIDAD
 * -----------
 * Montar 24 cartas WebGL a la vez no es posible: el navegador no sostiene más de
 * 16 contextos (medido) y destruye los más antiguos, así que las primeras —las más
 * visibles— se quedaban con el canvas muerto. Además 24 tarjetas dejan 24
 * estructuras completas en el DOM aunque el usuario vea cinco.
 *
 * De eso se encarga `card-visibility.ts`, con UN observer compartido para toda la
 * rejilla: monta solo lo que está cerca de pantalla, desmonta lo demás, y reparte
 * los contextos entre las cartas más visibles. Esta tarjeta solo pinta el estado
 * que ese módulo le comunica.
 */
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

import type { VtuberCard } from '@/lib/types';
import { HoloCard } from '@/components/holo-card';
import { observeCard } from '@/components/card-visibility';
import { pickCardQuality } from '@/components/card-quality';
import { INTENSITY } from '@/components/card3d-config';

export interface CardTileProps {
  card: VtuberCard;
  /** Índice en la grilla: escalona la animación de entrada. */
  index?: number;
}

export function CardTile({ card, index = 0 }: CardTileProps) {
  const tileRef = useRef<HTMLAnchorElement>(null);
  /**
   * Plan de calidad del dispositivo (núcleos, memoria, táctil, ahorro de datos,
   * movimiento reducido). Se lee UNA vez y se guarda en estado: las señales no
   * cambian mientras se navega, y leerlas en el render lo repetiría en cada
   * re-render de cada una de las 8 tarjetas.
   */
  const [quality] = useState(() => pickCardQuality());
  // Arranca montado: el HTML inicial trae el contenido (es estático y no debe
  // depender de JS) y el reparto lo poda enseguida si está fuera de pantalla.
  const [mounted, setMounted] = useState(true);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const element = tileRef.current;
    if (!element) return;
    return observeCard(element, (state) => {
      setMounted(state.near);
      setLive(state.live);
    });
  }, []);

  return (
    <Link
      ref={tileRef}
      href={`/v/${card.slug}`}
      data-testid="card-tile"
      data-dex={card.dexNumber}
      data-3d={live ? 'true' : 'false'}
      data-mounted={mounted ? 'true' : 'false'}
      data-quality={quality.tier}
      className="group relative block rounded-2xl transition-transform duration-200 ease-out hover:-translate-y-1.5 focus-visible:-translate-y-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dex-accent"
      style={{ animationDelay: `${Math.min(index, 12) * 22}ms` }}
      aria-label={`${card.name}, VTuber número ${card.dexNumber}`}
    >
      {/*
        El brillo de marca lo pinta la ESCENA 3D, no la tarjeta: es un plano mayor
        que la carta, por detrás de ella, cuyo shader enciende solo el anillo
        exterior (ver `glowFragmentShader`). Así queda un halo alrededor de la
        silueta con el color del VTuber y sin teñir el arte.

        Se probaron tres caminos antes, todos medidos y descartados: un halo en CSS
        detrás de la tarjeta (teñía el fondo de la rejilla y se leía como panel
        rectangular), un disco emisivo en la escena (mancha suelta, no pegada al
        canto) y un contorno pintado en el shader de la CARA (caía encima del arte,
        porque la cara está recortada a la silueta).
      */}

      {/*
        La carta 3D, a proporción REAL de carta coleccionable (1008x1411 = 1.4),
        la misma que usa el detalle: la textura entra sin deformarse.

        El hueco se reserva con `aspect-[5/7]` en el contenedor, así que aunque el
        contenido esté desmontado (fuera de pantalla) la página no encoge ni el
        scroll da saltos. El `aria-label` del enlace ya nombra la carta, de modo que
        la tarjeta sigue siendo accesible sin el marco visible.

        Sin fondo ni halo propios: el color y la luz los pone la escena 3D (la luz
        trasera del `Rig`), que es lo único que puede leerse como un objeto con
        volumen en vez de como un rectángulo de color.
      */}
      <div className="relative aspect-[5/7] overflow-hidden rounded-2xl">
        {mounted && quality.tier !== 'static' && (
          <HoloCard
            card={card}
            active={live}
            quality={quality.tier}
            textureWidth={quality.textureWidth}
            dprCap={quality.dpr}
            holo={INTENSITY.holo.tile}
            gloss={INTENSITY.gloss.tile}
            className="h-full w-full"
          />
        )}
        {mounted && quality.tier === 'static' && (
          // `prefers-reduced-motion`: la carta se inclina siguiendo el puntero en
          // cada frame, y quien pide menos movimiento no debe recibirlo. Se sirve
          // el arte en 2D — se reduce el efecto, nunca el contenido.
          <HoloCard card={card} active={false} className="h-full w-full" />
        )}
      </div>
    </Link>
  );
}

export default CardTile;
