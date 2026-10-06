import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VerificarCorreo } from './verificar-correo';
import { ApiError, api } from '@/lib/api';

beforeEach(() => {
  window.history.replaceState(null, '', '/verificar');
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('VerificarCorreo', () => {
  it('no gasta el token al abrir la página: hace falta pulsar el botón', async () => {
    window.history.replaceState(null, '', '/verificar#t=abc');
    const verificar = vi.spyOn(api, 'verificarSolicitud').mockResolvedValue({ ok: true, tipo: 'inscripcion', resultado: 'en_revision' });
    render(<VerificarCorreo />);
    const boton = await screen.findByRole('button', { name: /confirmar mi correo/i });
    expect(verificar).not.toHaveBeenCalled();
    await userEvent.click(boton);
    await waitFor(() => expect(verificar).toHaveBeenCalledWith('abc'));
    expect(await screen.findByTestId('verificar-hecho')).toHaveTextContent(/correo confirmado/i);
  });

  it('borra el token de la barra de direcciones', async () => {
    window.history.replaceState(null, '', '/verificar#t=secreto');
    render(<VerificarCorreo />);
    await screen.findByRole('button', { name: /confirmar mi correo/i });
    expect(window.location.hash).toBe('');
  });

  it('una baja aplicada lo dice con claridad', async () => {
    window.history.replaceState(null, '', '/verificar#t=abc');
    vi.spyOn(api, 'verificarSolicitud').mockResolvedValue({ ok: true, tipo: 'baja', resultado: 'baja_aplicada' });
    render(<VerificarCorreo />);
    await userEvent.click(await screen.findByRole('button', { name: /confirmar mi correo/i }));
    expect(await screen.findByTestId('verificar-hecho')).toHaveTextContent(/baja aplicada/i);
  });

  it('un enlace caducado muestra el error y deja reintentar', async () => {
    window.history.replaceState(null, '', '/verificar#t=abc');
    vi.spyOn(api, 'verificarSolicitud').mockRejectedValue(new ApiError('Este enlace no es válido: caducó', 410));
    render(<VerificarCorreo />);
    await userEvent.click(await screen.findByRole('button', { name: /confirmar mi correo/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido/i);
  });

  it('sin token en la dirección avisa de que el enlace está incompleto', async () => {
    render(<VerificarCorreo />);
    expect(await screen.findByTestId('verificar-sin-token')).toHaveTextContent(/incompleto/i);
  });
});
