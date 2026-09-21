/**
 * Tests de la capa de facciones en la carta holográfica.
 *
 * El reparto de emblemas ocurre en el shader (GLSL), así que no se puede ejercer
 * con jsdom. En su lugar se valida el CONTRATO entre el componente y el shader:
 * que existan los cuatro slots, que todos se usen de verdad, que las posiciones
 * estén repartidas (no apiladas) y que la mezcla sea de luz y no de pigmento.
 */
import { expect, test } from 'vitest';

import { cardFragmentShader } from '../features/card3d/shaders';
import { FACTION_STRENGTH } from '../features/card3d/HoloCard';

test('el shader declara los cuatro slots de facción', () => {
  for (const i of [0, 1, 2, 3]) {
    assert.ok(
      cardFragmentShader.includes(`uniform sampler2D uFactionMap${i};`),
      `debe declarar uFactionMap${i}`,
    );
    expect(cardFragmentShader.includes(`texture2D(uFactionMap${i}, fUv)`),
      `debe MUESTREAR uFactionMap${i} (declararlo sin usarlo no dibuja nada)`,).toBeTruthy();
  }
});

test('la máscara de slots permite 1..4 facciones', () => {
  assert.ok(cardFragmentShader.includes('uniform vec4 uFactionCounts;'), 'máscara vec4');
  // El shader solo debe entrar si hay al menos una facción activa.
  expect(/uFactionCounts\.x\s*>\s*0\.5/.test(cardFragmentShader), 'corta si no hay ninguna').toBeTruthy();
  // Y debe consultar los cuatro componentes de la máscara.
  for (const c of ['x', 'y', 'z', 'w']) {
    expect(cardFragmentShader.includes(`uFactionCounts.${c}`),
      `debe consultar uFactionCounts.${c}`,).toBeTruthy();
  }
});

test('las posiciones de los slots están repartidas, no apiladas', () => {
  // Se extraen los vec2 asignados a slots[] y se comprueba que están separados:
  // si dos emblemas caen casi en el mismo punto se pisarían entre sí.
  const matches = [...cardFragmentShader.matchAll(/slots\[(\d)\]\s*=\s*vec2\(([\d.]+),\s*([\d.]+)\)/g)];
  expect(matches.length, 'deben definirse las 4 posiciones').toBe(4);

  const puntos = matches
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([, , x, y]) => ({ x: Number(x), y: Number(y) }));

  for (let i = 0; i < puntos.length; i += 1) {
    for (let j = i + 1; j < puntos.length; j += 1) {
      const d = Math.hypot(puntos[i].x - puntos[j].x, puntos[i].y - puntos[j].y);
      expect(d > 0.25, `los slots ${i} y ${j} están a ${d.toFixed(2)}: demasiado juntos`).toBeTruthy();
    }
  }
  // Y todos dentro de la lámina.
  for (const p of puntos) {
    expect(p.x > 0.1 && p.x < 0.9, `x ${p.x} fuera de la lámina`).toBeTruthy();
    expect(p.y > 0.1 && p.y < 0.9, `y ${p.y} fuera de la lámina`).toBeTruthy();
  }
});

test('cada slot tiene su propio tinte y su propia fase de latido', () => {
  // El tinte debe depender del índice del slot; si no, los emblemas se ven como
  // el mismo sello repetido en vez de capas holográficas distintas.
  expect(/spectralFoil\([^)]*float\(i\)/.test(cardFragmentShader), 'el tinte usa el índice').toBeTruthy();
  expect(/sin\([^)]*float\(i\)/.test(cardFragmentShader), 'el latido usa el índice').toBeTruthy();
});

test('los emblemas se mezclan como LUZ, no como pigmento', () => {
  // La mezcla debe ser aditiva sobre el arte. Si sustituyera el color, el
  // emblema "mancharía" la carta en lugar de leerse como holograma.
  // La mezcla es aditiva y puede llevar un factor de máscara al final (para
  // suprimirla sobre el logo): lo que importa es que SUME sobre el arte.
  expect(/base \+= \(base \* facLayer[^;]*\*\s*sinLogo/.test(cardFragmentShader), 'mezcla aditiva multiplicada').toBeTruthy();
  expect(/base\s*=\s*facLayer/.test(cardFragmentShader), 'no debe sustituir el arte').toBe(false);
  // Se usa el alfa del emblema (transparencia real del PNG).
  expect(/fac\.a \* facStroke/.test(cardFragmentShader), 'usa el alfa del emblema').toBeTruthy();
});

test('el emblema se filtra por BRILLO, no solo por alfa', () => {
  // Los PNG de facción traen el interior en negro OPACO (~30-45% del área). Si se
  // usa solo el alfa, ese relleno casi negro se multiplica a sí mismo y el
  // holograma resulta invisible. Debe ponderarse por la luminancia del trazo.
  expect(/facStroke/.test(cardFragmentShader), 'existe un filtro de trazo').toBeTruthy();
  expect(/smoothstep\([^)]*facLum/.test(cardFragmentShader), 'el filtro usa la luminancia').toBeTruthy();
  // Y la intensidad no puede ser tan baja que se pierda sobre arte oscuro.
  expect(FACTION_STRENGTH, 'intensidad suficiente para verse').toBeGreaterThanOrEqual(0.9);
});

test('la intensidad del holograma de facción es fija y razonable', () => {
  expect(typeof FACTION_STRENGTH).toBe('number');
  expect(FACTION_STRENGTH > 0 && FACTION_STRENGTH <= 1, 'entre 0 y 1').toBeTruthy();
});
