/**
 * Tests del color predominante que tiñe el foil del fondo.
 *
 * jsdom no tiene canvas 2D real, así que se sustituye `getContext` por uno que devuelve los píxeles
 * que cada caso necesita: lo que se prueba es la ELECCIÓN del color, no el dibujo.
 */
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DOMINANT } from '@/components/card3d-config';
import { colorPredominante } from '@/components/card-texture/predominante';

/** Rellena la cuadrícula con `colores` repartidos en tramos iguales. */
function conPixeles(colores: Array<[number, number, number]>) {
  const total = DOMINANT.grid * DOMINANT.grid;
  const data = new Uint8ClampedArray(total * 4);
  for (let i = 0; i < total; i += 1) {
    const [r, g, b] = colores[Math.min(colores.length - 1, Math.floor((i / total) * colores.length))];
    data.set([r, g, b, 255], i * 4);
  }
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => undefined,
    getImageData: () => ({ data }),
  } as unknown as CanvasRenderingContext2D);
}

const fuente = document.createElement('canvas');

afterEach(() => vi.restoreAllMocks());

describe('colorPredominante', () => {
  test('un fondo rojo da un rojo y plena confianza', () => {
    conPixeles([[200, 20, 50]]);
    const { rgb, amount } = colorPredominante(fuente);
    expect(rgb[0]).toBeGreaterThan(0.7);
    expect(rgb[1]).toBeLessThan(0.2);
    expect(amount).toBeGreaterThan(0.9);
  });

  test('un fondo gris NO tiene color dominante: se queda el arcoíris completo', () => {
    conPixeles([[140, 140, 140], [200, 200, 200]]);
    expect(colorPredominante(fuente).amount).toBe(0);
  });

  test('rojo y azul a partes iguales: no se inventa un morado y se desconfía', () => {
    conPixeles([[200, 20, 50], [30, 60, 210]]);
    const { rgb, amount } = colorPredominante(fuente);
    // Si fuera el promedio, rojo y azul estarían a medio camino; aquí es uno de los dos.
    expect(rgb[0] > 0.6 || rgb[2] > 0.6).toBe(true);
    expect(amount).toBeLessThan(0.5);
  });

  test('con el color mayoritario claro gana sobre el minoritario', () => {
    conPixeles([[200, 20, 50], [200, 20, 50], [200, 20, 50], [30, 60, 210]]);
    const { rgb, amount } = colorPredominante(fuente);
    expect(rgb[0]).toBeGreaterThan(0.7);
    expect(amount).toBeGreaterThan(0.5);
  });

  test('sin fuente no hay color', () => {
    expect(colorPredominante(null)).toEqual({ rgb: [0, 0, 0], amount: 0 });
  });
});
