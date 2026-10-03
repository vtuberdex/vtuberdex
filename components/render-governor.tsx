'use client';
/**
 * Gobierna CUÁNDO el `<Canvas>` dibuja. Va dentro del canvas, que debe llevar `frameloop="demand"`.
 *
 * Tres ahorros, y ninguno cambia cómo se ve la carta:
 *   1. PAUSA total fuera de pantalla (IntersectionObserver sobre el canvas) o con la pestaña
 *      oculta: cero frames. Es el equivalente 3D de no renderizar lo que no está en el DOM visible.
 *   2. RITMO: tope `RENDER.activeFps` con interacción y `RENDER.idleFps` en reposo, en vez de 60
 *      continuos con el libro quieto. La agenda es fija (`nextSchedule`), no «desde el último frame».
 *   3. DPR ADAPTATIVO: si la cadencia real de los frames activos no sostiene el ritmo, baja la
 *      resolución un escalón (y la recupera). Lo decide el dispositivo, no una lista de equipos.
 *
 * POR QUÉ NO `PerformanceMonitor` de drei: cuenta TODOS los frames, y en reposo (20 fps a
 * propósito) leería «rendimiento pobre» y bajaría la resolución sin motivo. Aquí solo se miden
 * los intervalos entre frames activos (ver `render-pacing.ts`).
 *
 * TRAMPA DEL RELOJ: en `demand` el reloj de three sigue corriendo durante la pausa, así que el
 * primer frame al volver traería un `delta` de minutos y `advanceFlip` (que integra por delta)
 * saltaría el giro entero. Al reanudar se descarta con `clock.getDelta()`.
 */
import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import { RENDER } from '@/components/card3d-config';
import { createDprController, nextSchedule, shouldRender } from '@/components/render-pacing';

export interface RenderGovernorProps {
  /** ¿Hay una animación en curso que no pasa por el puntero (giro de página, carga)? */
  busy?: () => boolean;
  /** Cualquier cambio de este valor cuenta como actividad (p. ej. llegaron cartas nuevas). */
  wake?: unknown;
  /** fps en reposo; por defecto `RENDER.idleFps`. */
  idleFps?: number;
  /** DPR de partida y techo. */
  dprMax: number;
  /** Se llama con el DPR nuevo; el dueño del `<Canvas>` debe pasárselo como prop `dpr`. */
  onDpr?: (dpr: number) => void;
}

const SEÑALES = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart'] as const;

export function RenderGovernor({ busy, wake, idleFps = RENDER.idleFps, dprMax, onDpr }: RenderGovernorProps) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const clock = useThree((s) => s.clock);

  const busyRef = useRef(busy);
  busyRef.current = busy;
  const onDprRef = useRef(onDpr);
  onDprRef.current = onDpr;
  const despertar = useRef<() => void>(() => undefined);

  useEffect(() => {
    const canvas = gl.domElement;
    const dpr = createDprController(dprMax);
    const ritmo = { ...RENDER, idleFps };
    let raf = 0;
    let ultimo = -Infinity;
    let programado = -Infinity;
    let ultimoActivo = false;
    let activoHasta = 0;
    let enPantalla = true;

    const tick = (ahora: number) => {
      raf = requestAnimationFrame(tick);
      const activo = busyRef.current?.() === true || ahora < activoHasta;
      if (!shouldRender(ahora, programado, activo, ritmo)) return;
      // Durante un giro/carga NO se mide: ahí el hilo está saturado por las texturas y bajar el
      // DPR a mitad del giro realoca el framebuffer (un tirón extra y la imagen se ve cambiar).
      if (activo && ultimoActivo && ultimo > 0 && busyRef.current?.() !== true) {
        const siguiente = dpr.sample(ahora - ultimo);
        if (siguiente !== null) onDprRef.current?.(siguiente);
      }
      ultimoActivo = activo;
      programado = nextSchedule(ahora, programado, activo, ritmo);
      ultimo = ahora;
      invalidate();
    };

    const pausado = () => document.hidden || !enPantalla;
    const parar = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const sincronizar = () => {
      if (pausado()) return parar();
      if (raf) return;
      clock.getDelta();
      ultimo = -Infinity;
      programado = -Infinity;
      ultimoActivo = false;
      raf = requestAnimationFrame(tick);
    };
    const alActividad = () => {
      activoHasta = performance.now() + RENDER.activeMs;
      sincronizar();
    };
    despertar.current = alActividad;

    const observador =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver((entradas) => {
            enPantalla = entradas.some((e) => e.isIntersecting);
            if (enPantalla) activoHasta = performance.now() + RENDER.activeMs;
            sincronizar();
          });
    observador?.observe(canvas);
    document.addEventListener('visibilitychange', sincronizar);
    for (const tipo of SEÑALES) window.addEventListener(tipo, alActividad, { passive: true });

    alActividad();
    return () => {
      parar();
      observador?.disconnect();
      document.removeEventListener('visibilitychange', sincronizar);
      for (const tipo of SEÑALES) window.removeEventListener(tipo, alActividad);
    };
  }, [gl, invalidate, clock, dprMax, idleFps]);

  useEffect(() => {
    despertar.current();
  }, [wake]);

  return null;
}
