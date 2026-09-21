/**
 * Tests del localizador de logos por BORDES.
 *
 * No se testea contra una imagen real (los fixtures binarios no son
 * deterministas en todos los entornos), sino contra rejillas sintéticas que
 * reproducen las dos estructuras que importan:
 *   - una "masa" con estructura interna (bordes) → debe ser el logo;
 *   - una zona plana grande (fondo del panel de historia) → debe ignorarse;
 *   - glifos finos sueltos (texto) → deben ignorarse frente a la masa.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findLogoBox } from '../src/logo-edges.mjs';

/** Crea una imagen RGBA de WxH con fondo plano oscuro. */
function makeCanvas(width, height, bg = [10, 10, 20]) {
  const channels = 4;
  const data = Buffer.alloc(width * height * channels);
  for (let i = 0; i < width * height; i += 1) {
    data[i * channels] = bg[0];
    data[i * channels + 1] = bg[1];
    data[i * channels + 2] = bg[2];
    data[i * channels + 3] = 255;
  }
  return { data, channels, width, height };
}

/** Pinta un rectángulo de damero (bordes fuertes, alterna dos colores). */
function paintChecker(canvas, x0, y0, w, h, a = [255, 0, 0], b = [255, 255, 0], size = 3) {
  const { data, channels, width } = canvas;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const odd = (Math.floor(x / size) + Math.floor(y / size)) % 2 === 0;
      const c = odd ? a : b;
      const i = (y * width + x) * channels;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
    }
  }
}

/** Pinta una zona PLANA (sin bordes): no debe detectarse como logo. */
function paintFlat(canvas, x0, y0, w, h, color = [90, 20, 30]) {
  const { data, channels, width } = canvas;
  for (let y = y0; y < y0 + h; y += 1) {
    for (let x = x0; x < x0 + w; x += 1) {
      const i = (y * width + x) * channels;
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
    }
  }
}

/** Pinta varios glifos pequeños y separados: el "texto" del panel. */
function paintGlyphs(canvas, x0, y0, count, color = [230, 230, 230]) {
  const { data, channels, width } = canvas;
  for (let g = 0; g < count; g += 1) {
    const gx = x0 + (g % 10) * 14;
    const gy = y0 + Math.floor(g / 10) * 12;
    for (let y = gy; y < gy + 5; y += 1) {
      for (let x = gx; x < gx + 7; x += 1) {
        const i = (y * width + x) * channels;
        data[i] = color[0];
        data[i + 1] = color[1];
        data[i + 2] = color[2];
      }
    }
  }
}

test('encuentra la masa con estructura y descarta el fondo plano', () => {
  const c = makeCanvas(720, 405);
  // Logo: masa con bordes fuertes, en la banda derecha.
  paintChecker(c, 330, 60, 200, 110);
  // Panel de historia: zona plana grande justo debajo.
  paintFlat(c, 320, 210, 380, 150);
  const r = findLogoBox(c.data, c.width, c.height, c.channels);
  assert.ok(r, 'debe encontrar el logo');
  // La caja debe cubrir la masa, no bajar hasta el panel.
  assert.ok(r.box.top <= 70, `top ${r.box.top} debe estar en la masa`);
  assert.ok(r.box.top + r.box.height <= 215, `la caja (${r.box.height}) no debe invadir el panel`);
  assert.ok(r.box.left >= 300 && r.box.left <= 340, `left ${r.box.left} dentro de la masa`);
});

test('prefiere la masa mayor y no el texto suelto', () => {
  const c = makeCanvas(720, 405);
  paintChecker(c, 330, 60, 200, 110);
  paintGlyphs(c, 330, 220, 30); // "texto" del panel, muchos glifos pequeños
  const r = findLogoBox(c.data, c.width, c.height, c.channels);
  assert.ok(r, 'debe encontrar el logo');
  assert.ok(r.box.top + r.box.height < 220, 'no debe incluir los glifos del texto');
});

test('devuelve null si solo hay fondo plano (sin logo)', () => {
  const c = makeCanvas(720, 405);
  paintFlat(c, 320, 40, 390, 300);
  const r = findLogoBox(c.data, c.width, c.height, c.channels);
  assert.equal(r, null, 'sin estructura no hay logo');
});

test('la caja nunca se sale de la imagen', () => {
  const c = makeCanvas(720, 405);
  paintChecker(c, 500, 20, 210, 120); // pegado al borde derecho
  const r = findLogoBox(c.data, c.width, c.height, c.channels);
  if (r) {
    assert.ok(r.box.left >= 0, 'left >= 0');
    assert.ok(r.box.top >= 0, 'top >= 0');
    assert.ok(r.box.left + r.box.width <= 720, 'no se pasa del ancho');
    assert.ok(r.box.top + r.box.height <= 405, 'no se pasa del alto');
  }
});

test('ignora la zona del badge del número (esquina superior derecha)', () => {
  const c = makeCanvas(720, 405);
  paintChecker(c, 330, 60, 200, 110);
  // El badge va en x>0.80 del ancho, y<0.17 del alto: aquí 576..720, 0..69.
  paintChecker(c, 600, 10, 110, 55);
  const r = findLogoBox(c.data, c.width, c.height, c.channels);
  assert.ok(r, 'debe encontrar el logo');
  assert.ok(r.box.left < 576, `la caja debe nacer antes del badge (left ${r.box.left})`);
});
