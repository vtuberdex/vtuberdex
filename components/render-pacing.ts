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

export interface DprConfig {
  min: number;
  step: number;
  windowSize: number;
  slowMs: number;
  fastMs: number;
  /** Mediana por encima de esto = bajar DOS escalones de golpe. */
  severeMs: number;
  recoverWindows: number;
  outlierMs: number;
}

export interface DprController {
  /** Registra el intervalo (ms) entre dos frames ACTIVOS. Devuelve el DPR nuevo si cambia, si no `null`. */
  sample(frameMs: number): number | null;
  readonly dpr: number;
}

const mediana = (valores: number[]) => {
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.floor(orden.length / 2)];
};

/**
 * Controlador de DPR por mediana con histéresis. Baja un escalón en cuanto una ventana sale
 * lenta; sube solo tras `recoverWindows` ventanas rápidas seguidas, y nunca por encima de `max`.
 */
export function createDprController(max: number, cfg: DprConfig = RENDER.dpr): DprController {
  const techo = Math.max(max, cfg.min);
  let dpr = techo;
  let ventana: number[] = [];
  let rapidas = 0;

  return {
    get dpr() {
      return dpr;
    },
    sample(frameMs) {
      if (!(frameMs > 0) || frameMs > cfg.outlierMs) return null;
      ventana.push(frameMs);
      if (ventana.length < cfg.windowSize) return null;
      const m = mediana(ventana);
      ventana = [];

      if (m > cfg.slowMs) {
        rapidas = 0;
        const escalones = m > cfg.severeMs ? 2 : 1;
        const siguiente = Math.max(cfg.min, dpr - cfg.step * escalones);
        if (siguiente === dpr) return null;
        dpr = siguiente;
        return dpr;
      }
      if (m < cfg.fastMs && dpr < techo) {
        rapidas += 1;
        if (rapidas < cfg.recoverWindows) return null;
        rapidas = 0;
        dpr = Math.min(techo, dpr + cfg.step);
        return dpr;
      }
      rapidas = 0;
      return null;
    },
  };
}
