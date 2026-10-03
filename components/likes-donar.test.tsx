/** Botón de like (uno por día) y botón de donación de PayPal en la ficha. */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { DonatePayPal } from '@/components/donate-paypal';
import { LikeButton } from '@/components/like-button';
import { PAYPAL_DONATE_URL, PAYPAL_PAYMENT_ID, codigoDeReferencia, idDeCodigo } from '@/lib/donar';
import type { PremiumInfo } from '@/lib/types';

const mocks = vi.hoisted(() => ({ likeEstado: vi.fn(), darLike: vi.fn() }));
vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, api: { ...mocks } };
});
const { ApiError } = await import('@/lib/api');

afterEach(() => vi.clearAllMocks());

const resumen = (extra = {}) => ({ likes: 4, liked: false, level: 1, experience: { current: 40, max: 100 }, xpPorLike: 10, ...extra });
const premium = (grade: PremiumInfo['grade']): PremiumInfo => ({ grade, since: '2026-05-01', gradedAt: '2026-09-01', cert: 'VTD-000017' });

describe('DonatePayPal', () => {
  test('lleva a la donación de PayPal en una pestaña nueva, sin opener', () => {
    render(<DonatePayPal />);
    const enlace = screen.getByRole('link', { name: /Donar con PayPal/ });
    expect(enlace).toHaveAttribute('href', PAYPAL_DONATE_URL);
    expect(PAYPAL_DONATE_URL).toBe(`https://www.paypal.com/ncp/payment/${PAYPAL_PAYMENT_ID}`);
    expect(PAYPAL_DONATE_URL).toBe('https://www.paypal.com/ncp/payment/TQ6SU2TZL6ZEU');
    expect(enlace).toHaveAttribute('target', '_blank');
    expect(enlace.getAttribute('rel')).toContain('noopener');
    expect(enlace.querySelector('svg')).not.toBeNull(); // el logo
    expect(screen.getByTestId('donate-paypal')).toHaveTextContent('Si quieres gradear y subir de nivel esta carta puedes donar a nuestro PayPal');
  });

  test('muestra el código de la carta para escribirlo en la nota del pago, y lo copia', async () => {
    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: escribir }, configurable: true });
    render(<DonatePayPal card={{ id: 17, name: 'madKoding' }} />);
    expect(screen.getByTestId('donate-code')).toHaveTextContent('VTD-000017');
    expect(screen.getByTestId('donate-reference')).toHaveTextContent('nota del pago');
    expect(screen.getByTestId('donate-reference')).toHaveTextContent('madKoding');
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copiado ✓' })).toBeInTheDocument());
    expect(escribir).toHaveBeenCalledWith('VTD-000017');
  });

  test('si no se puede copiar, avisa y el código sigue a la vista', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('denegado')) }, configurable: true });
    render(<DonatePayPal card={{ id: 17, name: 'madKoding' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copiar código' }));
    await waitFor(() => expect(screen.getByText(/No se pudo copiar/)).toBeInTheDocument());
    expect(screen.getByTestId('donate-code')).toBeInTheDocument();
  });

  test('en una carta premium habla de subir de grado, y en la Black Label no aparece', () => {
    const { rerender } = render(<DonatePayPal premium={premium('9')} />);
    expect(screen.getByTestId('donate-paypal')).toHaveTextContent('sube de grado');
    rerender(<DonatePayPal premium={premium('BL')} />);
    expect(screen.queryByTestId('donate-paypal')).not.toBeInTheDocument();
  });
});

describe('código de referencia', () => {
  test('es el número de certificado de la carta y se puede leer de vuelta', () => {
    expect(codigoDeReferencia(17)).toBe('VTD-000017');
    expect(codigoDeReferencia(100_001)).toBe('VTD-100001');
    expect(idDeCodigo('VTD-000017')).toBe(17);
    expect(idDeCodigo('  vtd-17 ')).toBe(17);
    expect(idDeCodigo('VTD-100001')).toBe(100_001);
  });

  test('lo que no es un código no da id', () => {
    for (const texto of ['', 'madkoding', 'VTD-', 'VTD-0', 'VTD-12a', '17', 'XVTD-17', 'VTD-1234567890']) expect(idDeCodigo(texto), texto).toBeNull();
  });
});

describe('LikeButton', () => {
  test('con el like disponible, dar like lo registra y suma al total', async () => {
    mocks.likeEstado.mockResolvedValue(resumen());
    mocks.darLike.mockResolvedValue(resumen({ likes: 5, liked: true, experience: { current: 50, max: 100 } }));
    const onChange = vi.fn();
    render(<LikeButton slug="x" likes={4} onChange={onChange} />);
    const boton = screen.getByTestId('like-button');
    expect(boton).toBeDisabled(); // mientras no se sabe el estado no parece disponible
    await waitFor(() => expect(boton).toBeEnabled());
    expect(screen.getByTestId('like-message')).toHaveTextContent('1 like por día');

    fireEvent.click(boton);
    await waitFor(() => expect(screen.getByTestId('like-count')).toHaveTextContent('5'));
    expect(mocks.darLike).toHaveBeenCalledWith('x');
    expect(boton).toBeDisabled();
    expect(boton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('like-message')).toHaveTextContent('+10 de experiencia');
    // El padre recibe la experiencia nueva para mover la barra.
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ likes: 5, experience: { current: 50, max: 100 } }));
  });

  test('si ya dio like hoy llega deshabilitado y no deja pulsar', async () => {
    mocks.likeEstado.mockResolvedValue(resumen({ liked: true }));
    render(<LikeButton slug="x" likes={4} />);
    await waitFor(() => expect(screen.getByTestId('like-message')).toHaveTextContent('Vuelve mañana'));
    expect(screen.getByTestId('like-button')).toBeDisabled();
    fireEvent.click(screen.getByTestId('like-button'));
    expect(mocks.darLike).not.toHaveBeenCalled();
  });

  test('un 409 del servidor deja el botón bloqueado y explica por qué', async () => {
    mocks.likeEstado.mockResolvedValue(resumen());
    mocks.darLike.mockRejectedValue(new ApiError('Ya le diste like a este VTuber hoy. Vuelve mañana.', 409));
    render(<LikeButton slug="x" likes={4} />);
    await waitFor(() => expect(screen.getByTestId('like-button')).toBeEnabled());
    fireEvent.click(screen.getByTestId('like-button'));
    await waitFor(() => expect(screen.getByTestId('like-message')).toHaveTextContent('Ya le diste like'));
    expect(screen.getByTestId('like-button')).toBeDisabled();
  });

  test('sin estado fiable (servicio caído) no deja votar a ciegas', async () => {
    mocks.likeEstado.mockRejectedValue(new Error('503'));
    render(<LikeButton slug="x" likes={4} />);
    await waitFor(() => expect(screen.getByTestId('like-message')).toHaveTextContent('no están disponibles'));
    expect(screen.getByTestId('like-button')).toBeDisabled();
    expect(screen.getByTestId('like-count')).toHaveTextContent('4');
  });
});
