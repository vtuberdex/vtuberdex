'use client';
/**
 * Calidad de la carta 3D según lo que el dispositivo puede sostener.
 *
 * QUÉ SE MIDE (señales reales del navegador, no un user-agent)
 * ------------------------------------------------------------
 *   · `navigator.hardwareConcurrency` — núcleos de CPU. El coste dominante NO es
 *     dibujar la carta, es GENERAR sus texturas en canvas 2D: cada carta hace
 *     cuatro canvases y dos de ellos recorren el lienzo entero en un bucle JS.
 *     Medido en la grilla a 1008px: **24 s de hilo bloqueado** en tareas largas.
 *     Con pocos núcleos ese trabajo es el que se nota.
 *   · `navigator.deviceMemory` — RAM declarada (GB). Un móvil de 2 GB no puede
 *     tener 8 contextos WebGL con texturas de 1008px.
 *   · `matchMedia('(pointer: coarse)')` — táctil. Va con pantalla pequeña y GPU
 *     de móvil, y ahí se muestra menos carta por pantalla.
 *   · `navigator.connection.saveData` — el usuario pidió ahorrar datos; es una
 *     señal explícita de que quiere menos trabajo, no solo menos red.
 *   · `prefers-reduced-motion` — accesibilidad. Aquí no es solo animación: la
 *     carta se inclina siguiendo el puntero en cada frame, y quien pide menos
 *     movimiento no debería recibir eso. Se sirve la vista 2D.
 *
 * POR QUÉ SIGUE HACIENDO FALTA CON UN SOLO CANVAS
 * -----------------------------------------------
 * El catálogo ya no abre un contexto WebGL por carta (el libro, `card-binder.tsx`,
 * dibuja las 8 en uno), así que el techo de contextos dejó de ser el problema. Lo que
 * queda es la otra mitad del coste: el DPR del canvas (multiplica la memoria del
 * búfer) y el ancho de las texturas que se generan por carta, y ahí la única señal
 * razonable está en el propio dispositivo. `maxContexts` se conserva como dato
 * descriptivo del nivel, aunque hoy nadie reparta contextos.
 *
 * NINGÚN MODO DEJA LA CARTA SIN VER
 * ---------------------------------
 * El peor nivel es la vista 2D con el arte real: se reduce el efecto, nunca el
 * contenido. Degradar a menos carta sería un fallo, no una optimización.
 */

export type CardQuality = 'full' | 'tile' | 'lite' | 'static';

export interface CardQualityPlan {
  tier: CardQuality;
  /** Ancho del lienzo de textura. */
  textureWidth: number;
  /** Techo de DPR para el canvas WebGL. */
  dpr: number;
  /** Contextos WebGL simultáneos que este dispositivo debería sostener. */
  maxContexts: number;
  /** Motivo, para poder depurarlo en consola sin adivinar. */
  reason: string;
}

/** Anchos de textura por nivel (el de detalle completo es 1008). */
const TEX_FULL = 1008;
const TEX_TILE = 512;
/** La grilla a la mitad del nivel `tile`: suficiente a 163px de ancho y la mitad de píxeles. */
const TEX_LITE = 256;

/**
 * Decide una vez por sesión: las señales del dispositivo no cambian mientras se
 * navega, y recalcularlo en cada tarjeta sería repetir el mismo trabajo 8 veces.
 */
let cached: CardQualityPlan | null = null;

export function pickCardQuality(): CardQualityPlan {
  if (cached) return cached;
  cached = compute();
  return cached;
}

function compute(): CardQualityPlan {
  // Sin `window` (SSR) se asume lo más liviano: la carta se monta en el cliente,
  // así que este valor no llega a pintarse, y no tenerlo no debe romper el render.
  if (typeof window === 'undefined') {
    return { tier: 'lite', textureWidth: TEX_LITE, dpr: 1, maxContexts: 4, reason: 'servidor (sin señales)' };
  }

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    return { tier: 'static', textureWidth: TEX_LITE, dpr: 1, maxContexts: 0, reason: 'prefers-reduced-motion' };
  }

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData ?? false;

  if (saveData) {
    return { tier: 'lite', textureWidth: TEX_LITE, dpr: 1, maxContexts: 4, reason: 'saveData activo' };
  }

  // Equipo modesto: pocos núcleos o poca memoria declarada. Es donde la
  // generación de texturas bloquea la interfaz de forma perceptible.
  if (cores <= 2 || memory <= 2) {
    return {
      tier: 'lite',
      textureWidth: TEX_LITE,
      dpr: 1,
      maxContexts: 4,
      reason: `equipo modesto (${cores} núcleos, ${memory} GB)`,
    };
  }

  // Móvil/tablet: pantalla táctil sin ser un equipo corto. Se mantiene la textura
  // de grilla y se baja el DPR, que es lo que multiplica la memoria de cada
  // contexto (y de ahí el número que el navegador aguanta).
  if (coarse) {
    return {
      tier: 'tile',
      textureWidth: TEX_TILE,
      dpr: 1,
      maxContexts: 6,
      reason: 'puntero táctil (probable móvil)',
    };
  }

  if (cores >= 8 && memory >= 8) {
    return {
      tier: 'full',
      textureWidth: TEX_FULL,
      dpr: 1.8,
      maxContexts: 12,
      reason: `equipo amplio (${cores} núcleos, ${memory} GB)`,
    };
  }

  return {
    tier: 'tile',
    textureWidth: TEX_TILE,
    dpr: 1,
    maxContexts: 8,
    reason: `escritorio estándar (${cores} núcleos, ${memory} GB)`,
  };
}

/** Para los tests: descarta la decisión memorizada entre casos. */
export function __resetCardQuality(): void {
  cached = null;
}
