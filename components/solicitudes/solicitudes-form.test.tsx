/**
 * Los formularios públicos: la casilla de términos es obligatoria y lo que se envía lleva la
 * versión aceptada. La API se mockea; el foco es el contrato de la UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BajaForm } from '@/components/solicitudes/baja-form';
import { InscripcionForm } from '@/components/solicitudes/inscripcion-form';
import { ApiError, api } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';

beforeEach(() => {
  vi.spyOn(api, 'list').mockRejectedValue(new Error('sin red'));
});
afterEach(() => vi.restoreAllMocks());

describe('InscripcionForm', () => {
  it('no deja enviar sin aceptar los términos y enlaza a la página de términos', async () => {
    render(<InscripcionForm />);
    const enviar = screen.getByRole('button', { name: /enviar inscripción/i });
    expect(enviar).toBeDisabled();
    const enlace = screen.getAllByRole('link', { name: /términos y condiciones/i })[0];
    expect(enlace).toHaveAttribute('href', '/terminos');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    expect(enviar).toBeEnabled();
  });

  it('envía con la versión de los términos y confirma que queda en espera', async () => {
    const enviar = vi.spyOn(api, 'enviarInscripcion').mockResolvedValue({ ok: true, estado: 'pendiente', id: 1 });
    render(<InscripcionForm />);
    await userEvent.type(screen.getByLabelText(/nombre artístico/i), 'Luna');
    await userEvent.type(screen.getByLabelText(/^país/i), 'chile');
    await userEvent.click(screen.getByText('Español'));
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.type(screen.getByLabelText('Plataforma 1'), 'Twitch');
    await userEvent.type(screen.getByLabelText('Enlace 1'), 'https://twitch.tv/luna');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar inscripción/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({
      name: 'Luna',
      email: 'luna@example.com',
      languages: ['es'],
      aceptaTerminos: true,
      terminosVersion: TERMINOS_VERSION,
      website: '',
    });
    expect(await screen.findByTestId('inscripcion-enviada')).toHaveTextContent(/en espera de revisión/i);
  });

  it('muestra el error del servidor', async () => {
    vi.spyOn(api, 'enviarInscripcion').mockRejectedValue(new ApiError('ya hay una solicitud tuya en espera de revisión', 409));
    render(<InscripcionForm />);
    await userEvent.type(screen.getByLabelText(/nombre artístico/i), 'Luna');
    await userEvent.type(screen.getByLabelText(/^país/i), 'chile');
    await userEvent.click(screen.getByText('Español'));
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.type(screen.getByLabelText('Plataforma 1'), 'Twitch');
    await userEvent.type(screen.getByLabelText('Enlace 1'), 'https://twitch.tv/luna');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar inscripción/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/en espera de revisión/);
  });
});

describe('BajaForm', () => {
  it('avisa de lo que implica la baja y exige los mismos términos', async () => {
    render(<BajaForm />);
    expect(screen.getByTestId('baja-aviso-salida')).toHaveTextContent(/no elimina tu ficha/i);
    const enviar = screen.getByRole('button', { name: /solicitar la baja/i });
    expect(enviar).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    expect(enviar).toBeEnabled();
  });

  it('envía la baja con la versión de los términos', async () => {
    const enviar = vi.spyOn(api, 'enviarBaja').mockResolvedValue({ ok: true, estado: 'pendiente', id: 2 });
    render(<BajaForm />);
    await userEvent.type(screen.getByLabelText(/^ficha/i), '/v/luna');
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.type(screen.getByLabelText(/cómo comprobamos/i), 'una marca en mi canal');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /solicitar la baja/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({ ficha: '/v/luna', aceptaTerminos: true, terminosVersion: TERMINOS_VERSION });
    expect(await screen.findByTestId('baja-enviada')).toBeInTheDocument();
  });
});
