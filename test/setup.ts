import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { createElement } from 'react';

// jsdom no tiene WebGL y el producto ya no tiene vista 2D de respaldo: el libro y la ficha
// montan SIEMPRE un `<Canvas>`. Aquí es una caja inerte (los hijos son mallas de three, no
// DOM): los tests fijan lo que el usuario hace sin ver la escena. La escena y el shader los
// cubren sus propios tests (layout, shaders) y la sonda en navegador.
vi.mock('@react-three/fiber', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@react-three/fiber')>()),
  Canvas: () => createElement('div', { 'data-testid': 'r3f-canvas' }),
}));

// jsdom no implementa WebGL: los componentes 3D se prueban por su contrato
// (props/render del contenedor) y el shader se valida como string.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as unknown as HTMLCanvasElement['getContext'];

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

if (!window.scrollTo) {
  window.scrollTo = vi.fn();
}

/**
 * jsdom no trae `IntersectionObserver`. Ya no lo usa el catálogo (la grilla que
 * repartía contextos WebGL por visibilidad se reemplazó por el libro de un solo
 * canvas), pero el stub se conserva por si alguna librería lo pide al montar.
 *
 * Es deliberadamente INERTE: nunca dispara el callback. Los tests que quieran
 * simular la entrada en pantalla pueden capturar la instancia y llamar al callback.
 */
if (!globalThis.IntersectionObserver) {
  class FakeIntersectionObserver implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = '';
    readonly thresholds: ReadonlyArray<number> = [];
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe(): void {
      void this.callback;
    }
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  globalThis.IntersectionObserver = FakeIntersectionObserver as unknown as typeof IntersectionObserver;
}

afterEach(() => {
  cleanup();
});
