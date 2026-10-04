/**
 * Los formularios públicos: la casilla de términos es obligatoria y lo que se envía lleva la
 * versión aceptada. La API se mockea; el foco es el contrato de la UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BajaForm } from '@/components/solicitudes/baja-form';
import { InscripcionForm } from '@/components/solicitudes/inscripcion-form';
import { ModificacionForm } from '@/components/solicitudes/modificacion-form';
import { ApiError, api } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';

beforeEach(() => {
  vi.spyOn(api, 'list').mockRejectedValue(new Error('sin red'));
});
afterEach(() => vi.restoreAllMocks());

const CAMPOS_PASO_2: Array<[RegExp, string]> = [
  [/^estatura/i, '1,60 m'],
  [/^cumpleaños/i, '12 de marzo'],
  [/^modelo/i, 'Riko'],
  [/^hashtag de arte/i, '#Luna'],
  [/^lore/i, 'Una historia'],
  [/^avatar/i, 'https://example.com/a.png'],
  [/^logo/i, 'https://example.com/l.png'],
];

const CAMPOS_PASO_3: Array<[RegExp, string]> = [
  [/^comida favorita/i, 'Pizza'],
  [/^comida que te desagrada/i, 'Brócoli'],
  [/^videojuego favorito/i, 'Zelda'],
  [/^serie favorita/i, 'Dark'],
  [/^música favorita/i, 'Rock'],
  [/^anime favorito/i, 'Frieren'],
  [/^animal favorito/i, 'Gato'],
  [/^color favorito/i, 'Verde'],
];

async function llenarPaso1() {
  await userEvent.type(screen.getByLabelText(/nombre artístico/i), 'Luna');
  await userEvent.click(screen.getByText('Español'));
  await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
  await userEvent.type(screen.getByLabelText('Plataforma 1'), 'Twitch');
  await userEvent.type(screen.getByLabelText('Enlace 1'), 'https://twitch.tv/luna');
  await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
}

async function llenarPaso2() {
  for (const [etiqueta, valor] of CAMPOS_PASO_2) await userEvent.type(screen.getByLabelText(etiqueta), valor);
  await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
}

async function llenarPaso3() {
  for (const [etiqueta, valor] of CAMPOS_PASO_3) await userEvent.type(screen.getByLabelText(etiqueta), valor);
}

describe('InscripcionForm', () => {
  it('son 3 pasos y los obligatorios de cada uno están marcados', async () => {
    render(<InscripcionForm />);
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 1 de 3/i);
    expect(screen.queryByRole('button', { name: /enviar inscripción/i })).toBeNull();
    await llenarPaso1();
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 2 de 3/i);
    // País y signo son opcionales; el resto, no.
    expect(screen.getByLabelText(/^país/i)).not.toBeRequired();
    expect(screen.getByLabelText(/^signo/i)).not.toBeRequired();
    for (const [etiqueta] of CAMPOS_PASO_2) expect(screen.getByLabelText(etiqueta)).toBeRequired();
    await llenarPaso2();
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 3 de 3/i);
    for (const [etiqueta] of CAMPOS_PASO_3) expect(screen.getByLabelText(etiqueta)).toBeRequired();
  });

  it('«Volver» conserva lo escrito en el paso 1', async () => {
    render(<InscripcionForm />);
    await llenarPaso1();
    await userEvent.click(screen.getByRole('button', { name: /volver/i }));
    expect(screen.getByLabelText(/nombre artístico/i)).toHaveValue('Luna');
  });

  it('no deja enviar sin aceptar los términos y enlaza a la página de términos', async () => {
    render(<InscripcionForm />);
    await llenarPaso1();
    await llenarPaso2();
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
    await llenarPaso1();
    await llenarPaso2();
    await llenarPaso3();
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar inscripción/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({
      name: 'Luna',
      email: 'luna@example.com',
      languages: ['es'],
      height: '1,60 m',
      favoriteAnime: 'Frieren',
      modeler: 'Riko',
      cardText: 'Una historia',
      imageUrl: 'https://example.com/a.png',
      logoUrl: 'https://example.com/l.png',
      aceptaTerminos: true,
      terminosVersion: TERMINOS_VERSION,
      website: '',
    });
    expect(await screen.findByTestId('inscripcion-enviada')).toHaveTextContent(/en espera de revisión/i);
  });

  it('muestra el error del servidor', async () => {
    vi.spyOn(api, 'enviarInscripcion').mockRejectedValue(new ApiError('ya hay una solicitud tuya en espera de revisión', 409));
    render(<InscripcionForm />);
    await llenarPaso1();
    await llenarPaso2();
    await llenarPaso3();
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

describe('ModificacionForm', () => {
  async function identificar() {
    await userEvent.type(screen.getByLabelText(/^ficha/i), '/v/luna');
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.type(screen.getByLabelText(/cómo comprobamos/i), 'una marca en mi canal');
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
  }

  it('solo pide identificar la ficha: nada de lo ya registrado es obligatorio', async () => {
    render(<ModificacionForm />);
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 1 de 3/i);
    await identificar();
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 2 de 3/i);
    for (const etiqueta of [/^estatura/i, /^cumpleaños/i, /^lore/i, /^avatar/i, /^logo/i, /^país/i]) {
      expect(screen.getByLabelText(etiqueta)).not.toBeRequired();
    }
    expect(screen.queryByLabelText(/nombre artístico/i)).toBeNull();
  });

  it('no deja enviar si no hay ningún cambio', async () => {
    const enviar = vi.spyOn(api, 'enviarModificacion').mockResolvedValue({ ok: true, estado: 'pendiente', id: 1 });
    render(<ModificacionForm />);
    await identificar();
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos un cambio/i);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('envía solo lo que se cambió, con los términos, y confirma que queda en espera', async () => {
    const enviar = vi.spyOn(api, 'enviarModificacion').mockResolvedValue({ ok: true, estado: 'pendiente', id: 1 });
    render(<ModificacionForm />);
    await identificar();
    await userEvent.type(screen.getByLabelText(/^estatura/i), '1,70 m');
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    await userEvent.type(screen.getByLabelText(/^anime favorito/i), 'Frieren');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({
      ficha: '/v/luna',
      email: 'luna@example.com',
      height: '1,70 m',
      favoriteAnime: 'Frieren',
      birthday: '',
      themeColor: '',
      socials: [],
      aceptaTerminos: true,
      terminosVersion: TERMINOS_VERSION,
    });
    expect(await screen.findByTestId('modificacion-enviada')).toHaveTextContent(/en espera de revisión/i);
  });
});
