/**
 * Tests del libro de cartas por su CONTRATO de DOM.
 *
 * jsdom no tiene WebGL: `test/setup.ts` sustituye el `<Canvas>` de R3F por una caja inerte
 * (NO hay vista 2D de respaldo: el producto asume GPU). Lo que se fija aquí es lo que el
 * usuario puede hacer sin ver la escena: pasar de página con flechas, botones y gesto; y que
 * las cartas sigan siendo enlaces accesibles. La geometría del giro 3D la fija
 * `card-binder-layout.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CardBinder } from '@/components/card-binder';
import { BINDER } from '@/components/card3d-config';
import { makeCard } from '@/test/fixtures';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const eightCards = () =>
  Array.from({ length: 8 }, (_, i) => makeCard({ id: 100 + i, dexNumber: 100 + i, slug: `v-${i}`, name: `VTuber ${i}` }));

const renderBinder = (props: Partial<React.ComponentProps<typeof CardBinder>> = {}) => {
  const onPage = vi.fn();
  render(<CardBinder items={eightCards()} page={2} pageCount={5} loading={false} onPage={onPage} {...props} />);
  return { onPage };
};

describe('CardBinder', () => {
  it('monta el canvas 3D tras hidratar y NO dibuja ninguna vista 2D de respaldo', async () => {
    renderBinder();
    expect(await screen.findByTestId('r3f-canvas')).toBeInTheDocument();
    expect(screen.queryByTestId('binder-page')).toBeNull();
    expect(screen.queryByTestId('binder-fallback')).toBeNull();
    expect(screen.queryByTestId('card-tile')).toBeNull();
  });

  it('las cartas siguen siendo enlaces accesibles, en orden de lectura', () => {
    renderBinder();
    const links = screen.getAllByTestId('binder-link');
    expect(links).toHaveLength(8);
    expect(links[0]).toHaveAttribute('href', '/v/v-0');
    expect(links[4]).toHaveAttribute('href', '/v/v-4');
    expect(links[0]).toHaveTextContent('VTuber 0, VTuber número 100');
  });

  it('con menos de 8 cartas lista solo las que hay', () => {
    renderBinder({ items: eightCards().slice(0, 2) });
    expect(screen.getAllByTestId('binder-link')).toHaveLength(2);
  });

  it('anuncia la página actual', () => {
    renderBinder();
    expect(screen.getByText(/Página 2 de 5/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Libro de cartas, página 2 de 5' })).toBeInTheDocument();
  });

  it('los botones pasan a la página anterior y siguiente', async () => {
    const user = userEvent.setup();
    const { onPage } = renderBinder();
    await user.click(screen.getByLabelText('Página siguiente'));
    expect(onPage).toHaveBeenCalledWith(3);
    await user.click(screen.getByLabelText('Página anterior'));
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it('deshabilita los extremos', () => {
    renderBinder({ page: 1, pageCount: 1 });
    expect(screen.getByLabelText('Página anterior')).toBeDisabled();
    expect(screen.getByLabelText('Página siguiente')).toBeDisabled();
  });

  it('las flechas del teclado pasan de página', () => {
    const { onPage } = renderBinder();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onPage).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onPage).toHaveBeenLastCalledWith(1);
    expect(onPage).toHaveBeenCalledTimes(2);
  });

  it('las flechas NO actúan mientras se escribe en un campo ni en los extremos', () => {
    const { onPage } = renderBinder({ page: 5 });
    const input = document.createElement('input');
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: 'ArrowLeft' });
    expect(onPage).not.toHaveBeenCalled();
    // En la última página, avanzar no hace nada.
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onPage).not.toHaveBeenCalled();
    input.remove();
  });

  it('un gesto horizontal pasa de página: a la izquierda avanza, a la derecha retrocede', () => {
    const { onPage } = renderBinder();
    const region = screen.getByRole('region');
    const surface = region.firstElementChild as HTMLElement;
    const swipe = (from: number, to: number, dy = 0) => {
      fireEvent.pointerDown(surface, { clientX: from, clientY: 100, pointerId: 1, button: 0 });
      fireEvent.pointerUp(surface, { clientX: to, clientY: 100 + dy, pointerId: 1 });
    };
    swipe(300, 300 - BINDER.swipeMinPx - 10);
    expect(onPage).toHaveBeenLastCalledWith(3);
    swipe(100, 100 + BINDER.swipeMinPx + 10);
    expect(onPage).toHaveBeenLastCalledWith(1);
    // Un toque corto no es un gesto, y un movimiento vertical tampoco (eso es scroll).
    swipe(200, 204);
    swipe(200, 200 - BINDER.swipeMinPx - 10, 400);
    expect(onPage).toHaveBeenCalledTimes(2);
  });
});

/**
 * Modo celular (`single`): cada página son 4 cartas en UNA hoja; pasar de página gira esa
 * hoja. El catálogo decide el modo por viewport (`useSingleSheet`) y pide 4 por página.
 */
describe('CardBinder en celular (una hoja de 4)', () => {
  const fourCards = () => eightCards().slice(0, 4);

  it('muestra una sola hoja con las 4 cartas de la página', () => {
    renderBinder({ items: fourCards(), single: true, page: 2, pageCount: 10 });
    expect(screen.getByTestId('card-binder')).toHaveAttribute('data-single', 'true');
    const links = screen.getAllByTestId('binder-link');
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute('href', '/v/v-0');
    expect(screen.getByText(/Página 2 de 10/)).toBeInTheDocument();
  });

  it('botones, teclado y gesto pasan de página de 4 en 4 (una página = una hoja)', async () => {
    const user = userEvent.setup();
    const { onPage } = renderBinder({ items: fourCards(), single: true, page: 2, pageCount: 10 });
    await user.click(screen.getByLabelText('Página siguiente'));
    expect(onPage).toHaveBeenLastCalledWith(3);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(onPage).toHaveBeenLastCalledWith(1);
    const surface = screen.getByRole('region').firstElementChild as HTMLElement;
    fireEvent.pointerDown(surface, { clientX: 300, clientY: 100, pointerId: 1, button: 0 });
    fireEvent.pointerUp(surface, { clientX: 300 - BINDER.swipeMinPx - 10, clientY: 100, pointerId: 1 });
    expect(onPage).toHaveBeenLastCalledWith(3);
    expect(onPage).toHaveBeenCalledTimes(3);
  });

  it('en la primera página se deshabilita «anterior»', () => {
    renderBinder({ items: fourCards(), single: true, page: 1, pageCount: 10 });
    expect(screen.getByLabelText('Página anterior')).toBeDisabled();
    expect(screen.getByLabelText('Página siguiente')).toBeEnabled();
  });
});
