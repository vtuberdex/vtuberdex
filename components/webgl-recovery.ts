'use client';
/**
 * Recuperación de un contexto WebGL perdido.
 *
 * EL FALLO QUE ARREGLA: el libro y la carta del detalle escuchaban `webglcontextlost` y hacían
 * `setLost(true)` para siempre. El navegador pierde contextos con cierta normalidad (presión de
 * memoria de GPU, reinicio del proceso de GPU, demasiados contextos vivos) y la app lo convertía
 * en un fallo PERMANENTE: la vista 2D hasta recargar la página.
 *
 * LA REGLA: al perderse, se desmonta el canvas, se espera un respiro y se monta uno NUEVO
 * (cambia `canvasKey`). No se intenta seguir en sitio tras `webglcontextrestored`: el PMREM y los
 * render targets no sobreviven y el metal saldría negro.
 *
 * LA TRAMPA: desmontar un `<Canvas>` hace que R3F llame a `forceContextLoss()`, y eso DISPARA
 * `webglcontextlost` en el canvas viejo. Sin filtrar, cada remonte provocaría otro «fallo» y el
 * contador se agotaría solo. Por eso solo vale el evento del canvas VIGENTE (`vigente`), y se
 * suelta en cuanto se acepta o se desmonta.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { RENDER } from '@/components/card3d-config';

type Estado = { key: number; status: 'ok' | 'recovering' | 'failed' };

export interface WebGLRecovery {
  /** `false` mientras se espera el remonte o si se agotaron los intentos: no montar el `<Canvas>`. */
  canRender: boolean;
  /** Se agotaron los remontes seguidos: ya no se reintenta solo. */
  failed: boolean;
  /** Pasarla como `key` del `<Canvas>`: cambia en cada remonte. */
  canvasKey: number;
  /** Llamar desde `onCreated` con `gl.domElement`. */
  attach: (canvas: HTMLCanvasElement) => void;
}

export function useWebGLRecovery(cfg: typeof RENDER.recovery = RENDER.recovery): WebGLRecovery {
  const [estado, setEstado] = useState<Estado>({ key: 0, status: 'ok' });
  const vigente = useRef<HTMLCanvasElement | null>(null);
  const intentos = useRef(0);
  const temporizadores = useRef<{ espera?: ReturnType<typeof setTimeout>; sano?: ReturnType<typeof setTimeout> }>({});

  const limpiar = useCallback(() => {
    clearTimeout(temporizadores.current.espera);
    clearTimeout(temporizadores.current.sano);
  }, []);

  const alPerderse = useCallback(() => {
    vigente.current = null;
    limpiar();
    setEstado((s) => ({ key: s.key, status: 'recovering' }));
    temporizadores.current.espera = setTimeout(() => {
      if (intentos.current >= cfg.maxAttempts) {
        setEstado((s) => ({ key: s.key, status: 'failed' }));
        return;
      }
      intentos.current += 1;
      setEstado((s) => ({ key: s.key + 1, status: 'ok' }));
      temporizadores.current.sano = setTimeout(() => {
        intentos.current = 0;
      }, cfg.healthyMs);
    }, cfg.cooldownMs);
  }, [cfg, limpiar]);

  const attach = useCallback(
    (canvas: HTMLCanvasElement) => {
      vigente.current = canvas;
      canvas.addEventListener('webglcontextlost', (event) => {
        if (vigente.current !== canvas) return;
        event.preventDefault();
        alPerderse();
      });
    },
    [alPerderse],
  );

  useEffect(
    () => () => {
      vigente.current = null;
      limpiar();
    },
    [limpiar],
  );

  return { canRender: estado.status === 'ok', failed: estado.status === 'failed', canvasKey: estado.key, attach };
}
