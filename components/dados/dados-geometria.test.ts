import { Vector3 } from 'three';

import {
  CARAS,
  TIPOS_DE_DADO,
  alturaDeApoyo,
  direccionDelResultado,
  expresionDe,
  formaDe,
  geometriaBiselada,
  orientacionFinal,
  tirar,
  uvEnCara,
} from '@/components/dados/dados-geometria';

describe('dados: forma y numeración', () => {
  it.each(TIPOS_DE_DADO)('%s tiene sus caras planas y numeradas del 1 al N sin repetir', (tipo) => {
    const forma = formaDe(tipo);
    expect(forma.caras).toHaveLength(CARAS[tipo]);
    for (const cara of forma.caras) {
      // Todos los vértices de la cara en su plano (las cometas del d10 solo son planas con el zigzag justo).
      for (const p of cara.vertices) expect(Math.abs(p.clone().sub(cara.centro).dot(cara.normal))).toBeLessThan(1e-6);
    }
    if (tipo !== 'd4') {
      expect(forma.caras.map((c) => c.numero).sort((a, b) => a - b)).toEqual(Array.from({ length: CARAS[tipo] }, (_, i) => i + 1));
    } else {
      expect(forma.verticesNumerados.map((v) => v.numero)).toEqual([1, 2, 3, 4]);
    }
  });

  it.each(['d6', 'd8', 'd10', 'd12', 'd20'] as const)('en el %s las caras opuestas suman N+1', (tipo) => {
    const { caras } = formaDe(tipo);
    for (const cara of caras) {
      const opuesta = caras.find((o) => o.normal.dot(cara.normal) < -0.9999)!;
      expect(cara.numero + opuesta.numero).toBe(CARAS[tipo] + 1);
    }
  });
});

describe('dados: el resultado queda arriba', () => {
  it.each(TIPOS_DE_DADO)('%s: cada resultado, con cualquier giro, deja su cara (o vértice) mirando arriba', (tipo) => {
    for (let r = 1; r <= CARAS[tipo]; r++) {
      const q = orientacionFinal(tipo, r, r * 0.77);
      const arriba = direccionDelResultado(tipo, r).applyQuaternion(q);
      expect(arriba.dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.9999);
      // Y la más alta de las caras es justamente esa (el d4 se lee en el vértice de arriba).
      if (tipo !== 'd4') {
        const masAlta = formaDe(tipo).caras.reduce((best, c) => (c.normal.clone().applyQuaternion(q).y > best.normal.clone().applyQuaternion(q).y ? c : best));
        expect(masAlta.numero).toBe(r);
      }
      expect(alturaDeApoyo(tipo, q)).toBeGreaterThan(0);
    }
  });
});

describe('dados: malla', () => {
  it.each(TIPOS_DE_DADO)('%s: malla biselada con UV dentro del atlas', (tipo) => {
    const g = geometriaBiselada(tipo);
    const uv = g.getAttribute('uv');
    expect(uv.count).toBe(g.getAttribute('position').count);
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getX(i)).toBeLessThanOrEqual(1);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
      expect(uv.getY(i)).toBeLessThanOrEqual(1);
    }
  });

  it('el número no sale espejado: «arriba» de la cara va a v creciente y la derecha a u creciente', () => {
    const cara = formaDe('d6').caras[0];
    const [u0, v0] = uvEnCara('d6', 0, cara.centro);
    const [, vArriba] = uvEnCara('d6', 0, cara.centro.clone().add(cara.arriba.clone().multiplyScalar(0.2)));
    const derecha = new Vector3().crossVectors(cara.arriba, cara.normal);
    const [uDerecha] = uvEnCara('d6', 0, cara.centro.clone().add(derecha.multiplyScalar(0.2)));
    expect(vArriba).toBeGreaterThan(v0);
    expect(uDerecha).toBeGreaterThan(u0);
  });
});

describe('dados: azar', () => {
  it('tirar da enteros en [1, caras] y rechaza los valores que sesgarían el módulo', () => {
    const valores = [0xffff_ffff, 7]; // el primero cae en la zona de rechazo de un d6
    let i = 0;
    const falso = (b: Uint32Array) => {
      b[0] = valores[i++];
      return b;
    };
    expect(tirar(6, falso)).toBe((7 % 6) + 1);
    expect(i).toBe(2);
    for (let k = 0; k < 500; k++) {
      const r = tirar(20);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(20);
    }
  });

  it('expresionDe agrupa la bandeja', () => {
    expect(expresionDe(['d6', 'd20', 'd6'])).toBe('2d6 + 1d20');
  });
});
