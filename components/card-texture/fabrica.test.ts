/**
 * Fábrica de texturas: cola con prioridades, calidad adaptativa y caché acotada.
 *
 * jsdom no tiene canvas 2D (`getContext` devuelve null), así que la generación en sí
 * produce lienzos vacíos; lo que se fija aquí es la POLÍTICA: qué se hace primero, cuándo
 * se baja de calidad y qué se retiene.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { TEXTURAS } from '@/components/card3d-config';
import {
  __estadoCache,
  __pendientes,
  __reiniciarFabrica,
  anclar,
  buscarEnCache,
  encolarTrabajo,
  guardarEnCache,
  type TexturasDeCarta,
} from '@/components/card-texture/fabrica';
import { makeCard } from '@/test/fixtures';

afterEach(() => __reiniciarFabrica());

const lienzo = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const texturas = (width: number, completa = true): TexturasDeCarta => {
  const h = Math.round(width * 1.4);
  const vacia = lienzo(1, 1);
  return {
    dominant: { rgb: [0, 0, 0], amount: 0 },
    layers: [lienzo(width, h), lienzo(width, h), vacia, lienzo(width, h), vacia, vacia, lienzo(width, h)],
    edge: lienzo(width, h),
    logoMask: lienzo(width, h),
    logoSticker: lienzo(width, h),
    width,
    completa,
  };
};

describe('cola con prioridades', () => {
  it('los trabajos de prioridad alta corren antes que los de baja, de uno en uno', async () => {
    const orden: string[] = [];
    const baja = encolarTrabajo(() => { orden.push('baja'); }, 'baja');
    const alta1 = encolarTrabajo(() => { orden.push('alta1'); });
    const alta2 = encolarTrabajo(() => { orden.push('alta2'); });
    expect(__pendientes().alta + __pendientes().baja).toBeGreaterThan(0);
    await Promise.all([baja, alta1, alta2]);
    expect(orden.indexOf('baja')).toBeGreaterThan(orden.indexOf('alta2'));
    expect(orden).toEqual(['alta1', 'alta2', 'baja']);
  });

  it('un trabajo que falla no bloquea a los siguientes', async () => {
    const ok: string[] = [];
    await Promise.all([
      encolarTrabajo(() => { throw new Error('boom'); }),
      encolarTrabajo(() => { ok.push('sigue'); }),
    ]);
    expect(ok).toEqual(['sigue']);
  });
});

describe('sin calidad adaptativa', () => {
  it('el ancho de las texturas es fijo: no hay API para medir ni para bajarlo', async () => {
    const modulo = await import('@/components/card-texture/fabrica');
    expect(Object.keys(modulo)).not.toEqual(expect.arrayContaining(['anchoEfectivo']));
    expect(Object.keys(modulo)).not.toEqual(expect.arrayContaining(['registrarMedicion']));
    expect(TEXTURAS.ancho).toBe(512);
    expect(TEXTURAS).not.toHaveProperty('anchos');
    expect(TEXTURAS).not.toHaveProperty('lentoMs');
  });
});

describe('caché de texturas', () => {
  it('guarda solo texturas completas y las encuentra por carta (al ancho pedido o a otro)', () => {
    const card = makeCard();
    guardarEnCache(card, texturas(512, false));
    expect(buscarEnCache(card, 512)).toBeNull();
    guardarEnCache(card, texturas(512));
    expect(buscarEnCache(card, 512)?.width).toBe(512);
    expect(buscarEnCache(card, 384)?.width).toBe(512);
    // Otra URL de imagen (reemplazo del mantenedor con `?v=`) es otra entrada.
    const otra = makeCard({ images: { ...card.images, character: 'images/character/gkuro-monochrome.webp?v=2' } });
    expect(buscarEnCache(otra, 512)).toBeNull();
  });

  it('respeta el presupuesto de píxeles desalojando lo más viejo, salvo lo anclado', () => {
    const porCarta = 6 * 512 * Math.round(512 * 1.4);
    const caben = Math.floor(TEXTURAS.cacheMaxPixels / porCarta);
    const primera = makeCard({ id: 1 });
    guardarEnCache(primera, texturas(512));
    const soltar = anclar(primera, 512);
    for (let id = 2; id <= caben + 3; id += 1) guardarEnCache(makeCard({ id }), texturas(512));
    expect(__estadoCache().pixeles).toBeLessThanOrEqual(TEXTURAS.cacheMaxPixels + porCarta);
    // La primera sigue (anclada); la segunda cayó (la más vieja sin anclar).
    expect(buscarEnCache(primera, 512)).not.toBeNull();
    expect(buscarEnCache(makeCard({ id: 2 }), 512)).toBeNull();
    // Al soltar el ancla (la consulta anterior la rejuveneció: LRU), con suficientes
    // inserciones nuevas cae como cualquier otra.
    soltar();
    for (let id = 100; id < 100 + caben + 3; id += 1) guardarEnCache(makeCard({ id }), texturas(512));
    expect(buscarEnCache(primera, 512)).toBeNull();
  });
});
