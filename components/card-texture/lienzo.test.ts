import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from './lienzo';

describe('createLayer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('crea las capas con willReadFrequently: leerlas de un canvas acelerado bloquea el hilo (tirón al girar la página)', () => {
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    createLayer(512);
    expect(getContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
  });
});
