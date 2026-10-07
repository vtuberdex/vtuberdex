import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ABRIENDO_MAX_MS, limpiarAbriendo, marcarAbriendo, useAbriendoDetalle } from '@/lib/abriendo-detalle';

describe('abriendo-detalle', () => {
  afterEach(() => {
    act(() => limpiarAbriendo());
    vi.useRealTimers();
  });

  it('el hook refleja marcar y limpiar', () => {
    const { result } = renderHook(() => useAbriendoDetalle());
    expect(result.current).toBe(false);
    act(() => marcarAbriendo());
    expect(result.current).toBe(true);
    act(() => limpiarAbriendo());
    expect(result.current).toBe(false);
  });

  it('se baja solo si la navegación nunca llega a la ficha', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAbriendoDetalle());
    act(() => marcarAbriendo());
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(ABRIENDO_MAX_MS + 1));
    expect(result.current).toBe(false);
  });

  it('sobrevive a que quien lo marcó se desmonte (es lo que hace el catálogo al navegar)', () => {
    const catalogo = renderHook(() => useAbriendoDetalle());
    const layout = renderHook(() => useAbriendoDetalle());
    act(() => marcarAbriendo());
    catalogo.unmount();
    expect(layout.result.current).toBe(true);
  });
});
