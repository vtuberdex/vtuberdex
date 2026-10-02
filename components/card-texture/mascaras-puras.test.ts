/**
 * La matemática de las máscaras es la MISMA en el worker y en el hilo principal: se
 * prueba la función pura, que es lo que ambos ejecutan.
 */
import { describe, expect, it } from 'vitest';

import { calcularMascara, mascaraCobertura, mascaraTintaYPiel } from '@/components/card-texture/mascaras-puras';

const px = (...pixeles: Array<[number, number, number, number]>) => new Uint8ClampedArray(pixeles.flat());

describe('mascaraTintaYPiel', () => {
  it('marca la tinta (oscuro) a tope, la piel a medias y deja el resto en 0', () => {
    const a = px([10, 10, 10, 255], [220, 170, 140, 255], [40, 200, 40, 255], [0, 0, 0, 0]);
    const o = new Uint8ClampedArray(a.length);
    mascaraTintaYPiel(a, o);
    expect(o[0]).toBeGreaterThan(220); // tinta: casi 255
    expect(o[3]).toBe(255);
    expect(o[4]).toBe(Math.round(0.55 * 255)); // piel: skinWeight
    expect(o[8]).toBe(0); // verde saturado: ni tinta ni piel
    expect(o[11]).toBe(0);
    expect(o[15]).toBe(0); // transparente: no se toca
  });
});

describe('mascaraCobertura', () => {
  it('blanco opaco donde el alfa supera 24, negro opaco si no', () => {
    const a = px([0, 0, 0, 200], [0, 0, 0, 10], [255, 255, 255, 25]);
    const o = new Uint8ClampedArray(a.length);
    mascaraCobertura(a, o);
    expect([...o]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('calcularMascara despacha por tipo', () => {
    const a = px([0, 0, 0, 200]);
    const o1 = new Uint8ClampedArray(4);
    const o2 = new Uint8ClampedArray(4);
    calcularMascara('cobertura', a, o1);
    calcularMascara('tinta', a, o2);
    expect(o1[0]).toBe(255);
    expect(o2[0]).toBe(255);
    expect(o2[3]).toBe(200);
  });
});
