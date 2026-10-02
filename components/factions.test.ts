/**
 * Tests de la capa de facciones en la carta holográfica.
 *
 * El reparto de emblemas ocurre en el shader (GLSL), así que no se puede ejercer
 * con jsdom. En su lugar se valida el CONTRATO entre el componente y el shader:
 * que existan los cuatro slots, que todos se usen de verdad, que las posiciones
 * estén repartidas (no apiladas) y que la mezcla sea de luz y no de pigmento.
 */
import { expect, test } from 'vitest';

import { cardFragmentShader } from '@/components/shaders';
import { FACTION } from '@/components/card3d-config';
import { CARD_TEXTURE_HEIGHT, CARD_TEXTURE_WIDTH, FACTION_SOCKET, HEADER, MAX_FACTION_EMBLEMS } from '@/components/card-texture/dimensiones';

test('el shader declara los dos slots de facción (máximo de facciones por VTuber)', () => {
  for (const i of [0, 1]) {
    expect(
      cardFragmentShader.includes(`uniform sampler2D uFactionMap${i};`),
      `debe declarar uFactionMap${i}`,
    ).toBeTruthy();
    expect(
      cardFragmentShader.includes(`texture2D(uFactionMap${i}, fUv)`),
      `debe MUESTREAR uFactionMap${i} (declararlo sin usarlo no dibuja nada)`,
    ).toBeTruthy();
  }
  // Ya no hay slots 2 y 3: dos samplers menos contra el límite de 16 del driver.
  for (const i of [2, 3]) {
    expect(cardFragmentShader.includes(`uFactionMap${i}`), `uFactionMap${i} ya no existe`).toBe(false);
  }
});

test('la máscara de slots permite 1..2 facciones', () => {
  expect(cardFragmentShader.includes('uniform vec2 uFactionCounts;'), 'máscara vec2').toBeTruthy();
  // El shader solo debe entrar si hay al menos una facción activa.
  expect(/uFactionCounts\.x \+ uFactionCounts\.y\s*>\s*0\.5/.test(cardFragmentShader), 'corta si no hay ninguna').toBeTruthy();
  for (const c of ['x', 'y']) {
    expect(cardFragmentShader.includes(`uFactionCounts.${c}`), `debe consultar uFactionCounts.${c}`).toBeTruthy();
  }
});

test('los emblemas están en la CABECERA, a la derecha del nombre y sin solaparse', () => {
  expect(FACTION.slots).toHaveLength(MAX_FACTION_EMBLEMS);
  const [izquierdo, derecho] = FACTION.slots;
  // Misma altura, y esa altura es la de la placa de cabecera (arriba del todo: UV y cerca de 1).
  expect(izquierdo.y).toBeCloseTo(derecho.y, 6);
  const centroPx = HEADER.top + HEADER.height / 2;
  expect(izquierdo.y).toBeCloseTo(1 - centroPx / CARD_TEXTURE_HEIGHT, 6);
  // Orden: el slot 0 queda a la izquierda del 1, y los dos en la mitad derecha de la carta.
  expect(izquierdo.x).toBeLessThan(derecho.x);
  expect(izquierdo.x).toBeGreaterThan(0.5);
  // No se pisan: la separación entre centros es mayor que el ancho de un emblema.
  expect(derecho.x - izquierdo.x).toBeGreaterThan(izquierdo.w);
  // Caben dentro de la placa (el borde derecho de la placa es W - pad).
  const bordeDerecho = (CARD_TEXTURE_WIDTH - HEADER.pad) / CARD_TEXTURE_WIDTH;
  expect(derecho.x + derecho.w / 2).toBeLessThanOrEqual(bordeDerecho);
  // Y dentro de su altura.
  const alto = HEADER.height / CARD_TEXTURE_HEIGHT;
  expect(derecho.h).toBeLessThan(alto);
});

test('el emblema es CUADRADO en píxeles aunque el UV de la carta no lo sea', () => {
  for (const slot of FACTION.slots) {
    expect(slot.w * CARD_TEXTURE_WIDTH).toBeCloseTo(slot.h * CARD_TEXTURE_HEIGHT, 6);
  }
});

test('los engarces de la textura y los slots del shader salen de la MISMA geometría', () => {
  // La textura pinta el engarce en `FACTION_SOCKET` y el shader dibuja el emblema en
  // `FACTION.slots`; si las dos cuentas divergen, el emblema queda fuera de su engarce.
  const [izquierdo, derecho] = FACTION.slots;
  const centroDerechoPx = CARD_TEXTURE_WIDTH - HEADER.pad - FACTION_SOCKET.inset - FACTION_SOCKET.size / 2;
  expect(derecho.x * CARD_TEXTURE_WIDTH).toBeCloseTo(centroDerechoPx, 6);
  expect((derecho.x - izquierdo.x) * CARD_TEXTURE_WIDTH).toBeCloseTo(FACTION_SOCKET.size + FACTION_SOCKET.gap, 6);
});

test('cada slot tiene su propio tinte, y el emblema es ESTÁTICO (sin latido)', () => {
  // El tinte debe depender del índice del slot; si no, los emblemas se ven como
  // el mismo sello repetido en vez de capas holográficas distintas.
  expect(/spectralFoil\([^)]*float\(i\)/.test(cardFragmentShader), 'el tinte usa el índice').toBeTruthy();
  // Se pidió que el emblema quedara fijo y legible: la intensidad no late con el tiempo.
  const bloque = cardFragmentShader.slice(
    cardFragmentShader.indexOf('CAPA 3: emblemas de FACCIÓN'),
    cardFragmentShader.indexOf('CAPA 4: HOLOGRAMA DE CONTRASTE'),
  );
  expect(bloque).not.toMatch(/sin\(\s*uTime/);
});

test('el emblema va pegado a su engarce y conserva su proporción', () => {
  // El engarce vive en la capa del título (índice 3): el emblema debe muestrearse con el
  // MISMO paralaje, o se despega del cuadrado al mover el puntero.
  expect(cardFragmentShader).toMatch(/parallax \* uParallaxFactors\[3\] - slot/);
  // Y el PNG se encaja «contain» con su proporción, centrado, en vez de estirarse.
  expect(cardFragmentShader).toContain('uniform vec2 uFactionAspect;');
  expect(cardFragmentShader).toMatch(/aspecto >= 1\.0 \? vec2\(1\.0, aspecto\) : vec2\(1\.0 \/ aspecto, 1\.0\)/);
});

test('las posiciones del shader salen de la config, no de literales sueltos', () => {
  // El shader se GENERA desde `FACTION.slots` (ver `shaders.ts`): si alguien mueve
  // una posición en la config, tiene que moverse también en el GLSL. Un literal
  // escrito a mano en el shader sería el camino para que las dos partes se
  // desincronicen sin que nada avise.
  for (const [i, slot] of FACTION.slots.entries()) {
    expect(
      cardFragmentShader.includes(`slots[${i}] = vec2(${slot.x}, ${slot.y});`),
      `el shader debe tomar la posición ${i} de FACTION.slots`,
    ).toBeTruthy();
    expect(
      cardFragmentShader.includes(`sizes[${i}] = vec2(${slot.w}, ${slot.h});`),
      `el shader debe tomar el tamaño ${i} de FACTION.slots`,
    ).toBeTruthy();
  }
});

test('los emblemas se mezclan como LUZ, no como pigmento', () => {
  // La mezcla debe ser aditiva sobre el arte. Si sustituyera el color, el
  // emblema "mancharía" la carta en lugar de leerse como holograma.
  // La mezcla es aditiva y puede llevar una máscara al final (para
  // suprimirla sobre el logo): lo que importa es que SUME sobre el arte.
  expect(/base \+= \(base \* facLayer[^;]*\* sinLogo/.test(cardFragmentShader), 'mezcla aditiva multiplicada').toBeTruthy();
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
  expect(FACTION.strength, 'intensidad suficiente para verse').toBeGreaterThanOrEqual(0.9);
});

test('la intensidad del holograma de facción es fija y razonable', () => {
  expect(typeof FACTION.strength).toBe('number');
  expect(FACTION.strength > 0 && FACTION.strength <= 1, 'entre 0 y 1').toBeTruthy();
});
