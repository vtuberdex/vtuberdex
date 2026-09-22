import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

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
 * jsdom no trae `IntersectionObserver`, y las tarjetas de la grilla lo usan para
 * pedir su contexto WebGL al entrar en pantalla (ver `card-visibility.ts`).
 *
 * El stub es deliberadamente INERTE: nunca dispara el callback, así que en los
 * tests una tarjeta se queda en su vista 2D — que es el estado estable y sin
 * WebGL que interesa comprobar aquí. Los tests que quieran simular la entrada en
 * pantalla pueden capturar la instancia y llamar al callback a mano.
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
