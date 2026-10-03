import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RENDER } from '@/components/card3d-config';
import { useWebGLRecovery } from '@/components/webgl-recovery';

const perder = (canvas: HTMLCanvasElement) => {
  const evento = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(evento);
  return evento;
};

describe('useWebGLRecovery', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tras perder el contexto muestra el 2D y REMONTA un canvas nuevo (antes era permanente)', () => {
    const { result } = renderHook(() => useWebGLRecovery());
    const canvas = document.createElement('canvas');
    act(() => result.current.attach(canvas));
    expect(result.current.canRender).toBe(true);
    expect(result.current.canvasKey).toBe(0);

    let evento!: Event;
    act(() => {
      evento = perder(canvas);
    });
    expect(evento.defaultPrevented).toBe(true);
    expect(result.current.canRender).toBe(false);

    act(() => void vi.advanceTimersByTime(RENDER.recovery.cooldownMs));
    expect(result.current.canRender).toBe(true);
    expect(result.current.canvasKey).toBe(1);
  });

  it('el «lost» del canvas viejo (forceContextLoss al desmontar) no cuenta como un fallo nuevo', () => {
    const { result } = renderHook(() => useWebGLRecovery());
    const viejo = document.createElement('canvas');
    act(() => result.current.attach(viejo));
    act(() => void perder(viejo));
    act(() => void vi.advanceTimersByTime(RENDER.recovery.cooldownMs));
    const nuevo = document.createElement('canvas');
    act(() => result.current.attach(nuevo));

    act(() => void perder(viejo));
    expect(result.current.canRender).toBe(true);
    expect(result.current.canvasKey).toBe(1);
  });

  it('se rinde al 2D tras agotar los intentos seguidos', () => {
    const { result } = renderHook(() => useWebGLRecovery());
    for (let i = 0; i < RENDER.recovery.maxAttempts; i += 1) {
      const canvas = document.createElement('canvas');
      act(() => result.current.attach(canvas));
      act(() => void perder(canvas));
      act(() => void vi.advanceTimersByTime(RENDER.recovery.cooldownMs));
      expect(result.current.canRender).toBe(true);
    }
    const ultimo = document.createElement('canvas');
    act(() => result.current.attach(ultimo));
    act(() => void perder(ultimo));
    act(() => void vi.advanceTimersByTime(RENDER.recovery.cooldownMs));
    expect(result.current.canRender).toBe(false);
  });

  it('un contexto sano durante un buen rato devuelve los intentos', () => {
    const { result } = renderHook(() => useWebGLRecovery());
    for (let ronda = 0; ronda < RENDER.recovery.maxAttempts + 2; ronda += 1) {
      const canvas = document.createElement('canvas');
      act(() => result.current.attach(canvas));
      act(() => void perder(canvas));
      act(() => void vi.advanceTimersByTime(RENDER.recovery.cooldownMs));
      expect(result.current.canRender).toBe(true);
      act(() => void vi.advanceTimersByTime(RENDER.recovery.healthyMs));
    }
  });

  it('al desmontar no deja temporizadores vivos', () => {
    const { result, unmount } = renderHook(() => useWebGLRecovery());
    const canvas = document.createElement('canvas');
    act(() => result.current.attach(canvas));
    act(() => void perder(canvas));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
