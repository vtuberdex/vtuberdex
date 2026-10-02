/**
 * Guard del LAYOUT de la carta 3D.
 *
 * POR QUE UN GUARD DE TEXTO, Y NO UN TEST DE COMPONENTE
 * ----------------------------------------------------
 * El fallo que esto fija es un lazo de MEDIDA, y ningún runner lo ve: jsdom no
 * calcula layout (`getBoundingClientRect` devuelve ceros), así que montar el
 * componente pasaría con el bug dentro; `tsc` y el build no leen CSS; y la sonda
 * que sí lo midió necesita un navegador de verdad, cosa que CI no tiene. Lo único
 * comprobable aquí es la CONDICIÓN que rompe el lazo: el canvas tiene que estar
 * fuera del flujo, con caja posicionada, dentro de una raíz `relative`.
 *
 * MEDIDO (ficha, 390x844 tras redimensionar desde 1440x900 SIN recargar):
 *   · canvas en el flujo     -> 414 px CSS / búfer 745 px: clavado en el tamaño
 *     anterior, porque su `width` inline hace de suelo de `min-content` y el
 *     contenedor no puede encoger; a 320 px de viewport seguía en 694 px y la
 *     página desbordaba.
 *   · canvas posicionado     -> 332 px CSS / búfer 597 px: idéntico a la carga en
 *     frío del mismo tamaño.
 *
 * Si alguien vuelve a poner el canvas en el flujo (p. ej. «simplificando» la caja
 * posicionada), este test cae antes de que el fallo llegue al navegador.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** La suite corre desde la raíz del paquete (vitest), así que la ruta es la del repo. */
const fuente = readFileSync(path.resolve(process.cwd(), 'components/holo-card.tsx'), 'utf8');

/** Bloque JSX devuelto por `HoloCard`. */
const render = fuente.slice(fuente.indexOf('return (\n    <div className={className ?'));

describe('layout del canvas', () => {
  it('la raíz de HoloCard es `relative`', () => {
    expect(render).toContain('data-testid="holo-card"');
    expect(render).toMatch(/className=\{className \? `relative \$\{className\}` : 'relative'\}/);
  });

  it('el canvas vive en una caja posicionada, fuera del flujo', () => {
    const caja = render.indexOf('<div className="absolute inset-0">');
    const canvas = render.indexOf('<Canvas');
    expect(caja).toBeGreaterThan(-1);
    // Entre la caja y el canvas no puede cerrarse la caja: el canvas va DENTRO.
    expect(canvas).toBeGreaterThan(caja);
    expect(render.slice(caja, canvas)).not.toContain('</div>');
  });

  it('la vista 2D de respaldo ocupa la raíz posicionada', () => {
    expect(render).toContain('fallback={<CardFallback card={card} className="absolute inset-0" />}');
  });

  it('el canvas no se declara con tamaño propio (la medida la fija el contenedor)', () => {
    // Un `style` o una clase de tamaño en el Canvas devolvería el lazo: el contenedor
    // pasaría a depender de la medida que el canvas escribe.
    const canvas = render.indexOf('<Canvas');
    const cierre = render.indexOf('</Canvas>');
    const bloque = render.slice(canvas, cierre);
    expect(bloque).not.toMatch(/style=\{\{/);
    expect(bloque).not.toMatch(/\bwidth:|\bheight:/);
  });
});

/**
 * El libro del catálogo monta su propio `<Canvas>` y sufre el MISMO lazo de medida: su
 * contenedor fija el alto por `aspect-ratio`, y si el canvas entrara en el flujo el
 * ancho inline que escribe three.js impediría encoger al rotar el móvil.
 */
const fuenteLibro = readFileSync(path.resolve(process.cwd(), 'components/card-binder.tsx'), 'utf8');

describe('layout del canvas del libro', () => {
  it('el canvas del libro vive en una caja posicionada dentro de una raíz `relative`', () => {
    const caja = fuenteLibro.indexOf('<div className="absolute inset-0">');
    const canvas = fuenteLibro.indexOf('<Canvas');
    expect(caja).toBeGreaterThan(-1);
    expect(canvas).toBeGreaterThan(caja);
    expect(fuenteLibro.slice(caja, canvas)).not.toContain('</div>');
    // La raíz que lo contiene es la superficie de gestos, posicionada.
    expect(fuenteLibro).toMatch(/className="relative select-none"/);
  });

  it('el canvas del libro no se declara con tamaño propio', () => {
    const canvas = fuenteLibro.indexOf('<Canvas');
    const cierre = fuenteLibro.indexOf('>', fuenteLibro.indexOf('onCreated', canvas));
    const bloque = fuenteLibro.slice(canvas, cierre);
    expect(bloque).not.toMatch(/style=\{\{/);
    expect(bloque).not.toMatch(/\bwidth:|\bheight:/);
  });
});
