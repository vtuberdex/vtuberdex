/** La experiencia que resulta de los likes: la curva y sus bordes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BASE_NIVEL, PASO_NIVEL, PUNTOS_POR_NIVEL, XP_POR_LIKE, experienciaConLikes, umbralDeNivel } from '../src/experiencia.mjs';

test('una ficha sin experiencia parte del nivel 1 con la barra vacía', () => {
  assert.deepEqual(experienciaConLikes({}, 0), { level: 1, current: 0, max: BASE_NIVEL, total: 0, nivelesGanados: 0, likes: 0, xpPorLike: XP_POR_LIKE });
  assert.deepEqual(experienciaConLikes(null, 0).level, 1);
});

test('cada like suma XP_POR_LIKE a la barra', () => {
  const r = experienciaConLikes({ level: 3, current: 65, max: 500 }, 4);
  assert.deepEqual({ level: r.level, current: r.current, max: r.max }, { level: 3, current: 65 + 4 * XP_POR_LIKE, max: 500 });
});

test('al llenar la barra sube de nivel, la vacía y el siguiente nivel no pide MENOS', () => {
  // 100 de max con 10 XP por like: 10 likes llenan el nivel 1.
  const sube = experienciaConLikes({}, BASE_NIVEL / XP_POR_LIKE);
  assert.deepEqual({ level: sube.level, current: sube.current, max: sube.max }, { level: 2, current: 0, max: umbralDeNivel(2) });
  assert.equal(umbralDeNivel(2), BASE_NIVEL + PASO_NIVEL);
  // Una ficha del scrape con max 500 no baja a 250 al subir.
  const grande = experienciaConLikes({ level: 3, current: 490, max: 500 }, 1);
  assert.equal(grande.level, 4);
  assert.equal(grande.current, 0);
  assert.ok(grande.max >= 500);
});

test('puede subir varios niveles de una vez y el total de XP se conserva', () => {
  const likes = 200;
  const r = experienciaConLikes({}, likes);
  let gastado = r.current;
  for (let nivel = 1; nivel < r.level; nivel += 1) gastado += umbralDeNivel(nivel);
  assert.equal(gastado, likes * XP_POR_LIKE);
  assert.ok(r.level > 3);
  assert.ok(r.current < r.max);
});

test('entradas absurdas no cuelgan ni dan NaN', () => {
  for (const base of [{ level: -5, current: -10, max: 0 }, { level: 'x', current: NaN, max: null }, { level: 1, current: 0, max: 1 }]) {
    const r = experienciaConLikes(base, 1e9);
    assert.ok(Number.isFinite(r.level) && Number.isFinite(r.current) && r.max > 0, JSON.stringify(base));
  }
  assert.equal(experienciaConLikes({}, -3).likes, 0);
  assert.equal(experienciaConLikes({}, 'abc').likes, 0);
});

test('es monótona: más likes nunca baja de nivel', () => {
  let anterior = 0;
  for (let likes = 0; likes < 300; likes += 1) {
    const { level } = experienciaConLikes({ level: 2, current: 30, max: 150 }, likes);
    assert.ok(level >= anterior);
    anterior = level;
  }
});

test('el contador TOTAL nunca se reinicia aunque la barra se vacíe al subir', () => {
  let anterior = -1;
  for (let likes = 0; likes < 400; likes += 1) {
    const r = experienciaConLikes({}, likes);
    assert.equal(r.total, likes * XP_POR_LIKE);
    assert.ok(r.total > anterior || likes === 0);
    anterior = r.total;
  }
  // La barra volvió a cero al subir de nivel, pero el total sigue ahí.
  const sube = experienciaConLikes({}, BASE_NIVEL / XP_POR_LIKE);
  assert.equal(sube.current, 0);
  assert.equal(sube.total, BASE_NIVEL);
});

test('una ficha que ya traía nivel suma lo que valieron sus niveles anteriores al total', () => {
  const r = experienciaConLikes({ level: 3, current: 40, max: 200 }, 0);
  assert.equal(r.total, umbralDeNivel(1) + umbralDeNivel(2) + 40);
});

test('los puntos de habilidad salen solo de los niveles GANADOS con likes, no del nivel de partida', () => {
  assert.equal(experienciaConLikes({ level: 50, current: 0, max: 0 }, 0).nivelesGanados, 0);
  const r = experienciaConLikes({}, BASE_NIVEL / XP_POR_LIKE);
  assert.equal(r.nivelesGanados, 1);
  assert.equal(r.nivelesGanados * PUNTOS_POR_NIVEL, PUNTOS_POR_NIVEL);
});

test('cada nivel pide más que el anterior: sube más lento a medida que avanza', () => {
  for (let n = 1; n < 60; n += 1) assert.ok(umbralDeNivel(n + 1) > umbralDeNivel(n));
});

/* ------------------------------------------------- fórmula única (experienciaDeFicha) */

import { ANTIGUEDAD_TOPE_DIAS, RACHA_TOPE_MESES, XP_POR_DIA, XP_POR_MES_RACHA, diasEntre, experienciaDeFicha, multiplicadorPremium } from '../src/experiencia.mjs';
import { GRADOS } from '../src/premium.mjs';

test('sin datos una ficha es nivel 1 con la barra vacía, sin importar su base manual', () => {
  const r = experienciaDeFicha({});
  assert.deepEqual({ level: r.level, current: r.current, total: r.total }, { level: 1, current: 0, total: 0 });
});

test('la suma es likes + antigüedad + juego, y cada fuente sale en el desglose', () => {
  const r = experienciaDeFicha({ likes: 5, dias: 10, xpJuego: 20 });
  assert.equal(r.desglose.total, 5 * XP_POR_LIKE + 10 * XP_POR_DIA + 20);
  assert.equal(r.total, r.desglose.total);
});

test('la antigüedad tiene tope: pasado un año no sigue dando XP', () => {
  assert.equal(experienciaDeFicha({ dias: ANTIGUEDAD_TOPE_DIAS }).total, experienciaDeFicha({ dias: ANTIGUEDAD_TOPE_DIAS * 10 }).total);
});

test('el multiplicador premium sube 0,05 por grado hasta 1,50 en la BL y no existe sin premium ni degradado', () => {
  assert.equal(multiplicadorPremium(undefined), 1);
  assert.equal(multiplicadorPremium('3'), 1);
  assert.equal(multiplicadorPremium(GRADOS[0]), 1.05);
  assert.equal(multiplicadorPremium('BL'), 1.5);
  for (let i = 1; i < GRADOS.length; i += 1) assert.ok(multiplicadorPremium(GRADOS[i]) > multiplicadorPremium(GRADOS[i - 1]));
});

test('un premium gana más que una ficha normal con los mismos datos, y la racha suma aparte con tope', () => {
  const datos = { likes: 50, dias: 100 };
  const normal = experienciaDeFicha(datos);
  const premium = experienciaDeFicha({ ...datos, premium: { grade: '8', since: '2025-01-01', gradedAt: '2026-10-01' }, ahora: '2026-10-10' });
  assert.ok(premium.total > normal.total);
  assert.equal(premium.desglose.racha, RACHA_TOPE_MESES * XP_POR_MES_RACHA);
});

test('es monótona en cada fuente', () => {
  for (const campo of ['likes', 'dias', 'xpJuego']) {
    let anterior = -1;
    for (let n = 0; n < 500; n += 7) {
      const { total } = experienciaDeFicha({ [campo]: n });
      assert.ok(total >= anterior, campo);
      anterior = total;
    }
  }
});

test('diasEntre cuenta días enteros y tolera fechas rotas', () => {
  assert.equal(diasEntre('2026-09-20 21:32:45', new Date('2026-10-10T00:00:00Z')), 19);
  assert.equal(diasEntre('2026-09-20', '2026-10-10'), 20);
  assert.equal(diasEntre(null), 0);
  assert.equal(diasEntre('2999-01-01', '2026-10-10'), 0);
});
