/**
 * Deterioro de las cartas degradadas: la parte PURA (qué se rompe y dónde). Pintarlo necesita un
 * canvas que jsdom no tiene; lo que se fija aquí es lo que decide cuánto y dónde se rompe.
 */
import { describe, expect, test } from 'vitest';

import { corromperTexto, planDeDeterioro, semillaDeCarta } from '@/lib/degradado';
import { GRADOS, GRADOS_DEGRADADOS } from '@/lib/premium';
import { refuerzoDeGrado } from '@/components/premium-boost';

const W = 1008;
const H = 1411;
const plan = (grado: string, id = 17) => planDeDeterioro(grado, id, W, H);

describe('plan de deterioro', () => {
  test('una carta premium (o normal) no se toca', () => {
    for (const grado of [...GRADOS, null, undefined]) {
      const p = planDeDeterioro(grado, 3, W, H);
      expect(p.severidad).toBe(0);
      expect(p.mordidas).toHaveLength(0);
      expect(p.rayones).toHaveLength(0);
      expect(p.bloque).toBe(1);
    }
  });

  test('es determinista: la misma carta y grado se rompen por los mismos sitios', () => {
    expect(plan('4')).toEqual(plan('4'));
    expect(plan('4', 18)).not.toEqual(plan('4', 17));
    expect(semillaDeCarta(17, '4')).not.toBe(semillaDeCarta(17, '3'));
  });

  test('el daño crece del 7 al 1 en todos los efectos', () => {
    const planes = GRADOS_DEGRADADOS.map((g) => plan(g));
    planes.slice(1).forEach((actual, i) => {
      const previo = planes[i];
      expect(actual.severidad).toBeGreaterThan(previo.severidad);
      expect(actual.mordidas.length).toBeGreaterThanOrEqual(previo.mordidas.length);
      expect(actual.rayones.length).toBeGreaterThanOrEqual(previo.rayones.length);
      expect(actual.bloque).toBeGreaterThanOrEqual(previo.bloque);
      expect(actual.ruido).toBeGreaterThan(previo.ruido);
      expect(actual.gris).toBeGreaterThan(previo.gris);
    });
    // El 7 es «algo de degradado»: se nota poco; el 1 es otra cosa.
    expect(plan('7').bloque).toBe(1);
    expect(plan('1').bloque).toBeGreaterThan(20);
    expect(plan('1').pixelar).toBe(true);
    expect(plan('1').mordidas.length).toBeGreaterThan(plan('7').mordidas.length + 10);
  });

  test('los trozos que faltan están pegados a un borde de la carta', () => {
    for (const mordida of plan('2').mordidas) {
      const alBorde = mordida.puntos.some(([x, y]) => x <= 0 || y <= 0 || x >= W || y >= H);
      expect(alBorde).toBe(true);
      for (const [x, y] of mordida.puntos) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(W + 1);
        expect(y).toBeGreaterThanOrEqual(-1);
        expect(y).toBeLessThanOrEqual(H + 1);
      }
    }
  });
});

describe('texto corrompido', () => {
  test('sin daño el texto queda igual', () => {
    expect(corromperTexto('LUNA TEST', 0, 1)).toBe('LUNA TEST');
  });

  test('en el grado 1 no se entiende ninguna letra, pero se conservan espacios y dígitos', () => {
    const roto = corromperTexto('LUNA 42 TEST', 1, 9);
    expect(roto).toHaveLength('LUNA 42 TEST'.length);
    expect(roto).not.toMatch(/[A-Z]/);
    expect(roto.split(' ').map((p) => p.length)).toEqual([4, 2, 4]);
    expect(roto).toContain('42');
  });

  test('el 7 casi no toca el nombre y los grados siguientes lo rompen cada vez más', () => {
    const base = 'MADKODING ESTUDIO';
    const rotas = GRADOS_DEGRADADOS.map((g) => {
      const roto = corromperTexto(base, plan(g).severidad, 5);
      return [...roto].filter((c, i) => c !== base[i]).length;
    });
    expect(rotas[0]).toBeLessThanOrEqual(2);
    expect(rotas[rotas.length - 1]).toBe(base.replace(/\s/g, '').length);
    rotas.slice(1).forEach((n, i) => expect(n).toBeGreaterThanOrEqual(rotas[i]));
  });

  test('es determinista', () => {
    expect(corromperTexto('ABCDEFGH', 0.6, 3)).toBe(corromperTexto('ABCDEFGH', 0.6, 3));
  });
});

describe('brillo de una carta degradada', () => {
  test('una carta rota brilla menos que una normal, y cada vez menos', () => {
    const brillos = GRADOS_DEGRADADOS.map((g) => refuerzoDeGrado(g as never).holo);
    brillos.forEach((b) => expect(b).toBeLessThan(1));
    brillos.slice(1).forEach((b, i) => expect(b).toBeLessThanOrEqual(brillos[i]));
    expect(brillos[brillos.length - 1]).toBeGreaterThan(0);
  });
});
