import { describe, expect, it } from 'vitest';
import { RENDER } from '@/components/card3d-config';
import * as pacing from '@/components/render-pacing';
import { nextSchedule, shouldRender } from '@/components/render-pacing';

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

describe('sin DPR adaptativo', () => {
  it('no hay controlador de resolución ni perillas para medir la cadencia', () => {
    // Se retiró: medía cada frame activo y cambiaba el DPR (realocaba el framebuffer) en mitad del uso.
    expect(Object.keys(pacing)).not.toContain('createDprController');
    expect(RENDER).not.toHaveProperty('dpr');
  });
});
