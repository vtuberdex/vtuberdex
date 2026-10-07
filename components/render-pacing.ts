/**
 * Lógica PURA del ritmo de render (sin three ni DOM), para poder probarla: el componente que
 * la usa (`render-governor.tsx`) solo la cablea al bucle de R3F, y ese bucle no corre en jsdom.
 */
import { RENDER } from '@/components/card3d-config';

export interface PacingConfig {
  activeFps: number;
  idleFps: number;
  toleranceMs: number;
}

/**
 * ¿Toca dibujar un frame ahora? `scheduledAt` es el instante PROGRAMADO del último frame (`nextSchedule`).
 * Activo → `activeFps` (0 = sin tope: un frame por rAF, la cadencia nativa del monitor); en
 * reposo → `idleFps` (0 = no dibujar).
 */
export function shouldRender(
  now: number,
  scheduledAt: number,
  active: boolean,
  cfg: PacingConfig = RENDER,
): boolean {
  const fps = fpsFor(active, cfg);
  if (fps <= 0) return active;
  return now - scheduledAt >= 1000 / fps - cfg.toleranceMs;
}

/** fps vigentes: el reposo nunca supera el tope activo (si lo hay). 0 = sin tope (activo) / apagado (reposo). */
function fpsFor(active: boolean, cfg: PacingConfig): number {
  if (active) return cfg.activeFps;
  return cfg.activeFps > 0 ? Math.min(cfg.idleFps, cfg.activeFps) : cfg.idleFps;
}

/**
 * Instante «programado» del frame que acaba de dibujarse. Avanza en pasos FIJOS de 1000/fps en vez
 * de tomar el instante real: así el promedio es exactamente `fps` aunque el rAF no divida el tope
 * (24 en 60 Hz = 33/50 ms alternados) y no se acumula deriva. Si se quedó atrás más de un paso
 * (pestaña pausada, hipo del hilo) se reancla a `now` en vez de una ráfaga para ponerse al día.
 */
export function nextSchedule(now: number, scheduledAt: number, active: boolean, cfg: PacingConfig = RENDER): number {
  const fps = fpsFor(active, cfg);
  if (fps <= 0) return now;
  const paso = 1000 / fps;
  const siguiente = scheduledAt + paso;
  return now - siguiente > paso ? now : siguiente;
}
