import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { MiFicha } from '@/components/mi-ficha/mi-ficha';
import { ApiError, type VistaMiFicha } from '@/lib/api';

const mocks = vi.hoisted(() => ({ miFicha: vi.fn(), repartirPuntos: vi.fn(), pedirEnlaceDeMiFicha: vi.fn() }));
vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, api: { ...mocks } };
});

const vista = (disponibles: number, rango = 0): VistaMiFicha => ({
  slug: 'luna',
  name: 'Luna',
  level: 3,
  levelsGained: 2,
  likes: 30,
  experience: { current: 40, max: 200, total: 1234 },
  puntos: {
    ganados: 6,
    repartidos: 6 - disponibles,
    disponibles,
    rangoMaximo: 5,
    puntosPorNivel: 3,
    habilidades: [{ clave: 'active:rayo', name: 'Rayo', category: 'active', type: null, effect: null, rango }],
  },
});

beforeEach(() => {
  window.history.replaceState(null, '', '/mi-ficha#t=abc');
});
afterEach(() => {
  vi.clearAllMocks();
});

describe('MiFicha', () => {
  test('sin enlace pide el correo, y responde igual haya o no ficha', async () => {
    window.history.replaceState(null, '', '/mi-ficha');
    mocks.pedirEnlaceDeMiFicha.mockResolvedValue({ ok: true });
    render(<MiFicha />);
    fireEvent.change(await screen.findByLabelText(/correo/i), { target: { value: 'luna@example.com' } });
    fireEvent.submit(screen.getByTestId('mificha-pedir'));
    await waitFor(() => expect(mocks.pedirEnlaceDeMiFicha).toHaveBeenCalledWith('luna@example.com'));
    expect(await screen.findByText(/Si ese correo tiene una ficha/)).toBeTruthy();
  });

  test('muestra nivel, el EXP TOTAL, los puntos para repartir y las habilidades', async () => {
    mocks.miFicha.mockResolvedValue({ ok: true, fichas: [{ slug: 'luna', name: 'Luna' }], ficha: vista(4) });
    render(<MiFicha />);
    expect((await screen.findByTestId('mificha-disponibles')).textContent).toBe('4');
    expect(screen.getByTestId('mificha-total').textContent).toMatch(/1.?234/);
    expect(screen.getByText('Nivel 3')).toBeTruthy();
    expect(screen.getAllByTestId('mificha-habilidad')).toHaveLength(1);
    expect(mocks.miFicha).toHaveBeenCalledWith('abc', undefined);
  });

  test('«Subir» gasta un punto y lo celebra', async () => {
    mocks.miFicha.mockResolvedValue({ ok: true, fichas: [{ slug: 'luna', name: 'Luna' }], ficha: vista(4) });
    mocks.repartirPuntos.mockResolvedValue({ ok: true, ficha: vista(3, 1) });
    render(<MiFicha />);
    fireEvent.click(await screen.findByRole('button', { name: /Subir: Rayo/ }));
    await waitFor(() => expect(screen.getByTestId('mificha-disponibles').textContent).toBe('3'));
    expect(mocks.repartirPuntos).toHaveBeenCalledWith('abc', 'luna', 'subir', 'active:rayo');
    expect(screen.getByText(/rango 1/)).toBeTruthy();
  });

  test('sin puntos los botones quedan desactivados y se explica cómo ganar más', async () => {
    mocks.miFicha.mockResolvedValue({ ok: true, fichas: [{ slug: 'luna', name: 'Luna' }], ficha: vista(0, 2) });
    render(<MiFicha />);
    const boton = await screen.findByRole('button', { name: /Subir: Rayo/ });
    expect((boton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Ganas 3 puntos con cada nivel/)).toBeTruthy();
  });

  test('devolver los puntos pide confirmación antes', async () => {
    mocks.miFicha.mockResolvedValue({ ok: true, fichas: [{ slug: 'luna', name: 'Luna' }], ficha: vista(2) });
    mocks.repartirPuntos.mockResolvedValue({ ok: true, ficha: vista(6) });
    render(<MiFicha />);
    fireEvent.click(await screen.findByRole('button', { name: 'Repartir de nuevo' }));
    expect(mocks.repartirPuntos).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Sí, devolverlos' }));
    await waitFor(() => expect(mocks.repartirPuntos).toHaveBeenCalledWith('abc', 'luna', 'reiniciar', undefined));
  });

  test('un enlace caducado ofrece pedir otro en el mismo sitio', async () => {
    mocks.miFicha.mockRejectedValue(new ApiError('caducó', 410));
    render(<MiFicha />);
    expect(await screen.findByText(/caducó o ya no sirve/)).toBeTruthy();
    expect(screen.getByTestId('mificha-pedir')).toBeTruthy();
  });
});
