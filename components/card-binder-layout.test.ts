/**
 * Geometría del libro de cartas, fijada sin navegador.
 *
 * jsdom no puede ver la escena WebGL, pero el fallo que más cuesta de depurar en un
 * paso de página 3D es geométrico: una carta que al terminar el giro NO cae en su
 * funda, o que atraviesa la hoja que la tapa. Las matrices son puras, así que se
 * comprueban aquí con números.
 */
import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import { BINDER } from '@/components/card3d-config';
import {
  CARD_H,
  CARD_W,
  CARDS_PER_SPREAD,
  advanceFlip,
  allSlotPositions,
  bookDimensions,
  easeFlip,
  fitCameraZ,
  isStaticCardVisible,
  planPlacements,
  sheetAngle,
  sheetCardLocalMatrix,
  sheetMatrix,
  slotPosition,
  slotSide,
  staticCardMatrix,
  worldPosition,
} from '@/components/card-binder-layout';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

describe('fundas del libro', () => {
  it('hay 8 slots: 4 a la izquierda del lomo y 4 a la derecha, en orden de lectura', () => {
    const positions = allSlotPositions();
    expect(positions).toHaveLength(CARDS_PER_SPREAD);
    positions.slice(0, 4).forEach((p) => expect(p.x).toBeLessThan(0));
    positions.slice(4).forEach((p) => expect(p.x).toBeGreaterThan(0));
    // Fila a fila: el slot 0 está arriba a la izquierda de su hoja y el 1 a su derecha.
    expect(positions[0].y).toBeGreaterThan(positions[2].y);
    expect(positions[0].x).toBeLessThan(positions[1].x);
    expect(positions[4].x).toBeLessThan(positions[5].x);
    expect(slotSide(3)).toBe('left');
    expect(slotSide(4)).toBe('right');
  });

  it('la hoja izquierda es el espejo exacto de la derecha', () => {
    // El slot 0 (arriba-izquierda de la izquierda) refleja al 5 (arriba-derecha de la derecha).
    const left = slotPosition(0);
    const right = slotPosition(5);
    expect(close(left.x, -right.x)).toBe(true);
    expect(close(left.y, right.y)).toBe(true);
  });

  it('ninguna funda se sale de su hoja ni pisa el lomo', () => {
    const { pageW, pageCenterX } = bookDimensions();
    const inner = pageCenterX - pageW / 2;
    const outer = pageCenterX + pageW / 2;
    for (const p of allSlotPositions()) {
      const ax = Math.abs(p.x);
      expect(ax - CARD_W / 2).toBeGreaterThanOrEqual(inner + BINDER.pocketPad - 1e-9);
      expect(ax + CARD_W / 2).toBeLessThanOrEqual(outer - BINDER.pocketPad + 1e-9);
    }
    expect(inner).toBeGreaterThanOrEqual(BINDER.spine / 2);
  });

  it('las cartas no se solapan entre sí', () => {
    const positions = allSlotPositions();
    for (let i = 0; i < positions.length; i += 1) {
      for (let j = i + 1; j < positions.length; j += 1) {
        const dx = Math.abs(positions[i].x - positions[j].x);
        const dy = Math.abs(positions[i].y - positions[j].y);
        expect(dx >= CARD_W + BINDER.gap - 1e-9 || dy >= CARD_H + BINDER.gap - 1e-9).toBe(true);
      }
    }
  });
});

describe('giro de la hoja', () => {
  it('la curva arranca en 0 y termina en 1, pasando por la mitad en pie', () => {
    expect(easeFlip(0)).toBe(0);
    expect(easeFlip(1)).toBe(1);
    expect(easeFlip(0.5)).toBe(0.5);
    expect(easeFlip(-1)).toBe(0);
    expect(easeFlip(2)).toBe(1);
  });

  it('al avanzar la hoja derecha se levanta HACIA la cámara (z > 0) y aterriza a la izquierda', () => {
    const start = slotPosition(5);
    const local = sheetCardLocalMatrix(start, 'front');
    const mid = new Matrix4().multiplyMatrices(sheetMatrix(sheetAngle(1, 0.5)), local);
    expect(worldPosition(mid).z).toBeGreaterThan(1);
    const end = new Matrix4().multiplyMatrices(sheetMatrix(sheetAngle(1, 1)), local);
    const landed = worldPosition(end);
    expect(close(landed.x, -start.x, 1e-9)).toBe(true);
    expect(close(landed.y, start.y)).toBe(true);
  });

  it('al retroceder la hoja izquierda también sube hacia la cámara', () => {
    const start = slotPosition(0);
    const local = sheetCardLocalMatrix(start, 'front');
    const mid = new Matrix4().multiplyMatrices(sheetMatrix(sheetAngle(-1, 0.5)), local);
    expect(worldPosition(mid).z).toBeGreaterThan(1);
  });

  it('una carta del DORSO cae exactamente en su funda de destino mirando a la cámara', () => {
    // Avanzar: la carta entrante del slot 0 viaja en el dorso de la hoja derecha.
    const target = slotPosition(0);
    const local = sheetCardLocalMatrix(target, 'back');
    // Al empezar está reflejada detrás de la hoja derecha: x opuesta, z negativa.
    const before = worldPosition(new Matrix4().multiplyMatrices(sheetMatrix(sheetAngle(1, 0)), local));
    expect(before.x).toBeGreaterThan(0);
    expect(before.z).toBeLessThan(0);
    // Al terminar está en su funda, por encima de la hoja, y su «frente» mira a +z.
    const end = new Matrix4().multiplyMatrices(sheetMatrix(sheetAngle(1, 1)), local);
    const landed = worldPosition(end);
    expect(close(landed.x, target.x, 1e-9)).toBe(true);
    expect(close(landed.y, target.y)).toBe(true);
    expect(close(landed.z, BINDER.sheetZ + BINDER.cardLift, 1e-9)).toBe(true);
    const normal = { x: end.elements[8], y: end.elements[9], z: end.elements[10] };
    expect(normal.z).toBeGreaterThan(0.999);
    // La misma funda, fija: la carta no se mueve al dejar de depender de la hoja.
    const fixed = worldPosition(staticCardMatrix(target));
    expect(close(fixed.x, landed.x, 1e-9)).toBe(true);
    expect(close(fixed.y, landed.y)).toBe(true);
    expect(Math.abs(fixed.z - landed.z)).toBeLessThanOrEqual(BINDER.sheetZ + 1e-9);
  });

  it('las cartas tapadas aparecen tras el umbral y las que van a taparse se esconden antes', () => {
    expect(isStaticCardVisible('none', 0)).toBe(true);
    expect(isStaticCardVisible('uncover', 0)).toBe(false);
    expect(isStaticCardVisible('uncover', -(BINDER.revealAngle + 0.01))).toBe(true);
    expect(isStaticCardVisible('cover', -Math.PI / 2)).toBe(true);
    expect(isStaticCardVisible('cover', -(Math.PI - BINDER.revealAngle + 0.01))).toBe(false);
  });

  it('el giro se detiene en pie mientras no hay datos y sigue cuando llegan', () => {
    let p = 0;
    for (let i = 0; i < 200; i += 1) p = advanceFlip(p, 0.016, false);
    expect(p).toBe(BINDER.holdProgress);
    p = advanceFlip(p, 0.016, true);
    expect(p).toBeGreaterThan(BINDER.holdProgress);
    for (let i = 0; i < 200; i += 1) p = advanceFlip(p, 0.016, true);
    expect(p).toBe(1);
  });

  it('dura lo que dice la config', () => {
    const frames = Math.ceil(BINDER.flipMs / 16);
    let p = 0;
    for (let i = 0; i < frames - 2; i += 1) p = advanceFlip(p, 0.016, true);
    expect(p).toBeLessThan(1);
    for (let i = 0; i < 3; i += 1) p = advanceFlip(p, 0.016, true);
    expect(p).toBe(1);
  });
});

describe('cámara', () => {
  it('encaja el libro completo en cualquier proporción (gana la dimensión más exigente)', () => {
    const { spreadW, pageH } = bookDimensions();
    const native = fitCameraZ(spreadW / pageH);
    // Más ancho que el libro: manda el alto, la distancia no cambia.
    expect(close(fitCameraZ(3), native, 1e-9)).toBe(true);
    // Más estrecho (móvil en vertical): hay que alejarse para que entre el ancho.
    expect(fitCameraZ(0.6)).toBeGreaterThan(native);
    expect(fitCameraZ(0)).toBeGreaterThan(0);
  });
});

describe('reparto de cartas durante el giro', () => {
  const cards = (from: number) => Array.from({ length: 8 }, (_, i) => ({ id: from + i }));

  it('sin giro, las 8 son fijas en orden de lectura', () => {
    const plan = planPlacements(cards(1), null);
    expect(plan).toHaveLength(8);
    plan.forEach((p, i) => {
      expect(p.slot).toBe(i);
      expect(p.role).toBe('static');
      expect(p.reveal).toBe('none');
    });
  });

  it('al avanzar: salientes derechas en la cara, entrantes izquierdas en el dorso', () => {
    const outgoing = cards(1);
    const incoming = cards(9);
    const plan = planPlacements(incoming, { dir: 1, outgoing });
    const roles = (role: string) => plan.filter((p) => p.role === role).map((p) => p.card.id);
    expect(roles('sheet-front')).toEqual([5, 6, 7, 8]);
    expect(roles('sheet-back')).toEqual([9, 10, 11, 12]);
    expect(plan.filter((p) => p.reveal === 'cover').map((p) => p.card.id)).toEqual([1, 2, 3, 4]);
    expect(plan.filter((p) => p.reveal === 'uncover').map((p) => p.card.id)).toEqual([13, 14, 15, 16]);
    // Las entrantes del dorso ocupan los slots de la izquierda (0..3): ahí aterrizan.
    plan.filter((p) => p.role === 'sheet-back').forEach((p) => expect(p.slot).toBeLessThan(4));
  });

  it('al retroceder es el espejo', () => {
    const plan = planPlacements(cards(1), { dir: -1, outgoing: cards(9) });
    const roles = (role: string) => plan.filter((p) => p.role === role).map((p) => p.card.id);
    expect(roles('sheet-front')).toEqual([9, 10, 11, 12]);
    expect(roles('sheet-back')).toEqual([5, 6, 7, 8]);
    plan.filter((p) => p.role === 'sheet-back').forEach((p) => expect(p.slot).toBeGreaterThanOrEqual(4));
  });

  it('una carta presente en ambas páginas se queda solo como entrante (sin keys duplicadas)', () => {
    const plan = planPlacements(cards(5), { dir: 1, outgoing: cards(1) });
    const ids = plan.map((p) => p.card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.find((p) => p.card.id === 5)?.role).toBe('sheet-back');
  });

  it('tolera una página entrante vacía (datos aún en vuelo)', () => {
    const plan = planPlacements([], { dir: 1, outgoing: cards(1) });
    expect(plan).toHaveLength(8);
    expect(plan.every((p) => p.card.id <= 8)).toBe(true);
  });
});
