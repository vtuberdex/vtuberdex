import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DadosPanel } from '@/components/admin/dados-panel';
import { DADOS } from '@/components/dados/dados-geometria';

const ESPERA = DADOS.duracionMs + DADOS.variacionMs + 200;

describe('DadosPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Azar fijo para que los resultados sean predecibles.
    const fijo = (b: Uint32Array) => {
      b[0] = 4; // 4 % caras + 1 → d6: 5, d20: 5, d4: 1
      return b;
    };
    vi.spyOn(crypto, 'getRandomValues').mockImplementation(fijo as unknown as typeof crypto.getRandomValues);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('arma la bandeja, tira y muestra el resultado cuando los dados terminan de rodar', () => {
    render(<DadosPanel />);
    expect(screen.getByTestId('r3f-canvas')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ d20' }));
    const tirarBoton = screen.getByRole('button', { name: 'Tirar 2d6 + 1d20' });
    fireEvent.click(tirarBoton);
    // Mientras ruedan, no se adelanta el número ni se puede tirar otra vez.
    expect(screen.getByTestId('dados-resultado')).toHaveTextContent('Rodando…');
    expect(screen.queryByTestId('dados-total')).toBeNull();
    expect(screen.getByRole('button', { name: 'Rodando…' })).toBeDisabled();
    act(() => vi.advanceTimersByTime(ESPERA));
    expect(screen.getByTestId('dados-total')).toHaveTextContent('15');
    expect(screen.getByTestId('dados-resultado')).toHaveTextContent('d6: 5 · d6: 5 · d20: 5');
    expect(within(screen.getByTestId('dados-historial')).getByText('15')).toBeInTheDocument();
  });

  it('quitar o agregar un dado descarta la tirada anterior', () => {
    render(<DadosPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Tirar 2d6' }));
    act(() => vi.advanceTimersByTime(ESPERA));
    expect(screen.getByTestId('dados-total')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar d6' })[0]);
    expect(screen.queryByTestId('dados-total')).toBeNull();
    expect(screen.getByRole('button', { name: 'Tirar 1d6' })).toBeEnabled();
  });

  it('el atajo de la Ultimate tira esos dados y dice cuánto vale cada ataque', () => {
    render(<DadosPanel />);
    fireEvent.click(screen.getByRole('button', { name: '2d4' }));
    act(() => vi.advanceTimersByTime(ESPERA));
    expect(screen.getByTestId('dados-total')).toHaveTextContent('2');
    expect(screen.getByTestId('dados-resultado')).toHaveTextContent('X = 2: 2 ataques de la mitad del ataque.');
  });

  it('no deja pasar del máximo de dados', () => {
    render(<DadosPanel />);
    for (let i = 0; i < DADOS.maximo; i++) {
      const boton = screen.getByRole('button', { name: '+ d8' });
      if (boton.hasAttribute('disabled')) break;
      fireEvent.click(boton);
    }
    expect(screen.getAllByRole('button', { name: /^Quitar / })).toHaveLength(DADOS.maximo);
    expect(screen.getByRole('button', { name: '+ d8' })).toBeDisabled();
  });
});
