import { describe, expect, it } from 'vitest';
import { RENDER } from '@/components/card3d-config';
import { createDprController, nextSchedule, shouldRender } from '@/components/render-pacing';

describe('shouldRender', () => {
  it('activo sin tope: dibuja en CADA rAF, también a 144 Hz (un tope fijo daba cadencia desigual)', () => {
    const cfg = { activeFps: 0, idleFps: 20, toleranceMs: 2 };
    let ultimo = -Infinity;
    const gaps: number[] = [];
    for (let i = 0; i < 144; i += 1) {
      const t = i * (1000 / 144);
      if (shouldRender(t, ultimo, true, cfg)) {
        if (ultimo > 0) gaps.push(t - ultimo);
        ultimo = t;
      }
    }
    expect(gaps.length).toBe(142);
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
  });

  it('un tope fijo a 60 en un monitor de 144 Hz SÍ da pasos desiguales (la causa del jitter)', () => {
    const cfg = { activeFps: 60, idleFps: 20, toleranceMs: 2 };
    let ultimo = -Infinity;
    const gaps: number[] = [];
    for (let i = 0; i < 144; i += 1) {
      const t = i * (1000 / 144);
      if (shouldRender(t, ultimo, true, cfg)) {
        if (ultimo > 0) gaps.push(t - ultimo);
        ultimo = t;
      }
    }
    expect(new Set(gaps.map((g) => Math.round(g))).size).toBeGreaterThan(0);
    expect(Math.min(...gaps)).toBeGreaterThan(20); // ~48 fps, no 60
  });

  it('con tope 60 en un monitor de 60 Hz no se salta frames por el jitter del rAF', () => {
    const cfg = { activeFps: 60, idleFps: 20, toleranceMs: 2 };
    let ultimo = -Infinity;
    let dibujados = 0;
    for (let i = 0; i < 60; i += 1) {
      const t = i * (1000 / 60) + (i % 2 ? 0.8 : -0.8);
      if (shouldRender(t, ultimo, true, cfg)) {
        ultimo = t;
        dibujados += 1;
      }
    }
    expect(dibujados).toBe(60);
  });

  it('en reposo baja a idleFps', () => {
    let ultimo = -Infinity;
    let dibujados = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) {
      if (shouldRender(t, ultimo, false)) {
        ultimo = t;
        dibujados += 1;
      }
    }
    expect(dibujados).toBeGreaterThanOrEqual(RENDER.idleFps - 3);
    expect(dibujados).toBeLessThanOrEqual(RENDER.idleFps + 1);
  });

  it('el primer frame siempre se dibuja y fps 0 apaga el render', () => {
    expect(shouldRender(0, -Infinity, false)).toBe(true);
    expect(shouldRender(5000, 0, false, { activeFps: 60, idleFps: 0, toleranceMs: 2 })).toBe(false);
  });
});

describe('tope de 24 fps con agenda fija (nextSchedule)', () => {
  const cfg24 = { activeFps: 24, idleFps: 20, toleranceMs: 2 };
  const simular = (hz: number, segundos = 5) => {
    let programado = -Infinity;
    const ts: number[] = [];
    for (let i = 0; i < hz * segundos; i += 1) {
      const t = i * (1000 / hz);
      if (shouldRender(t, programado, true, cfg24)) {
        ts.push(t);
        programado = nextSchedule(t, programado, true, cfg24);
      }
    }
    return ts;
  };
  const fps = (ts: number[], segundos = 5) => ts.length / segundos;

  it('el tope por defecto es 60', () => {
    expect(RENDER.activeFps).toBe(60);
  });

  it.each([60, 75, 120, 144, 165])('promedia 24 fps en un monitor de %i Hz (sin deriva)', (hz) => {
    expect(fps(simular(hz))).toBeGreaterThan(23.5);
    expect(fps(simular(hz))).toBeLessThanOrEqual(24.4);
  });

  it('en 120 y 144 Hz la cadencia es perfectamente pareja (24 divide el monitor)', () => {
    for (const hz of [120, 144]) {
      const ts = simular(hz);
      const gaps = ts.slice(1).map((t, i) => t - ts[i]);
      expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(0.01);
    }
  });

  it('en 60 Hz alterna 2 y 3 ticks (33/50 ms) y nunca otra cosa', () => {
    const ts = simular(60);
    const gaps = new Set(ts.slice(1).map((t, i) => Math.round(t - ts[i])));
    expect([...gaps].sort()).toEqual([33, 50]);
  });

  it('comparar con el último frame REAL (sin agenda) daría ~20 fps en 60 Hz: la razón de la agenda', () => {
    let ultimo = -Infinity;
    let n = 0;
    for (let i = 0; i < 300; i += 1) {
      const t = i * (1000 / 60);
      if (shouldRender(t, ultimo, true, cfg24)) {
        ultimo = t;
        n += 1;
      }
    }
    expect(n / 5).toBeLessThan(21);
  });

  it('tras una pausa no hay ráfaga para ponerse al día: se reancla', () => {
    const tras = nextSchedule(10_000, 0, true, cfg24);
    expect(tras).toBe(10_000);
  });

  it('el reposo nunca supera el tope activo', () => {
    const cfg = { activeFps: 24, idleFps: 30, toleranceMs: 2 };
    expect(nextSchedule(0, 0, false, cfg)).toBeCloseTo(1000 / 24);
  });
});

describe('createDprController', () => {
  const alimentar = (ctl: ReturnType<typeof createDprController>, ms: number, n: number) => {
    let ultimo: number | null = null;
    for (let i = 0; i < n; i += 1) ultimo = ctl.sample(ms) ?? ultimo;
    return ultimo;
  };
  const ventana = RENDER.dpr.windowSize;

  it('baja un escalón con una mediana lenta y respeta el mínimo', () => {
    const ctl = createDprController(1.8);
    expect(alimentar(ctl, 30, ventana)).toBeCloseTo(1.5);
    for (let i = 0; i < 10; i += 1) alimentar(ctl, 30, ventana);
    expect(ctl.dpr).toBe(RENDER.dpr.min);
  });

  it('con una mediana MUY lenta baja dos escalones de golpe (agresivo)', () => {
    const ctl = createDprController(1.8);
    expect(alimentar(ctl, 70, ventana)).toBeCloseTo(1.2);
  });

  it('reacciona con una ventana corta (24 frames, ~0,4 s a 60 fps)', () => {
    expect(RENDER.dpr.windowSize).toBeLessThanOrEqual(24);
    const ctl = createDprController(1.8);
    for (let i = 0; i < RENDER.dpr.windowSize - 1; i += 1) expect(ctl.sample(30)).toBeNull();
    expect(ctl.sample(30)).not.toBeNull();
  });

  it('no baja con frames sanos a 60 fps', () => {
    const ctl = createDprController(1.8);
    expect(alimentar(ctl, 16.7, ventana * 3)).toBeNull();
    expect(ctl.dpr).toBe(1.8);
  });

  it('un monitor de 144 Hz con tope de 60 (pasos 20,8/20,8/13,9 ms) NO pierde resolución', () => {
    const ctl = createDprController(1.8);
    const pasos = [20.8, 20.8, 13.9];
    for (let i = 0; i < ventana * 6; i += 1) ctl.sample(pasos[i % 3]);
    expect(ctl.dpr).toBe(1.8);
  });

  it('ignora los hipos del hilo principal (no son carga del render)', () => {
    const ctl = createDprController(1.8);
    expect(alimentar(ctl, RENDER.dpr.outlierMs + 50, ventana * 3)).toBeNull();
    expect(ctl.dpr).toBe(1.8);
  });

  it('una mediana buena con unos pocos picos no cuenta como lenta', () => {
    const ctl = createDprController(1.8);
    for (let i = 0; i < ventana; i += 1) ctl.sample(i % 5 === 0 ? 60 : 16);
    expect(ctl.dpr).toBe(1.8);
  });

  it('recupera con calma: tras varias ventanas rápidas seguidas y nunca por encima del techo', () => {
    const ctl = createDprController(1.8);
    alimentar(ctl, 30, ventana);
    expect(ctl.dpr).toBeCloseTo(1.5);
    expect(alimentar(ctl, 12, ventana * (RENDER.dpr.recoverWindows - 1))).toBeNull();
    expect(alimentar(ctl, 12, ventana)).toBeCloseTo(1.8);
    alimentar(ctl, 12, ventana * 10);
    expect(ctl.dpr).toBe(1.8);
  });

  it('una ventana lenta en medio reinicia la cuenta de recuperación', () => {
    const ctl = createDprController(1.8);
    alimentar(ctl, 30, ventana);
    alimentar(ctl, 12, ventana * 2);
    alimentar(ctl, 30, ventana);
    expect(alimentar(ctl, 12, ventana * 2)).toBeNull();
  });
});
