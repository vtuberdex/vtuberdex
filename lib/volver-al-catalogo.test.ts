import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CLAVE_CATALOGO, guardarCatalogo, rutaDelCatalogo } from './volver-al-catalogo';

beforeEach(() => window.sessionStorage.clear());
afterEach(() => window.sessionStorage.clear());

describe('volver al catálogo', () => {
  it('sin pasado en el catálogo, vuelve a la raíz', () => {
    expect(rutaDelCatalogo()).toBe('/');
  });

  it('devuelve la página y los filtros donde se estaba', () => {
    guardarCatalogo('page=3&countries=chile&sort=dex');
    expect(rutaDelCatalogo()).toBe('/?page=3&countries=chile&sort=dex');
  });

  it('un querystring vacío (página 1 sin filtros) es la raíz', () => {
    guardarCatalogo('');
    expect(rutaDelCatalogo()).toBe('/');
  });

  it('un valor manipulado no puede sacar al visitante del sitio', () => {
    for (const malo of ['//evil.com', 'https://evil.com', '/\\evil.com', 'a b', 'x\ny', '<script>']) {
      window.sessionStorage.setItem(CLAVE_CATALOGO, malo);
      expect(rutaDelCatalogo(), malo).toBe('/');
    }
  });
});
