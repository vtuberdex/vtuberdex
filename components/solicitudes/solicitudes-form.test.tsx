/**
 * Los formularios públicos: la casilla de términos es obligatoria y lo que se envía lleva la
 * versión aceptada. La API se mockea; el foco es el contrato de la UI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { BajaForm } from '@/components/solicitudes/baja-form';
import { InscripcionForm } from '@/components/solicitudes/inscripcion-form';
import { ModificacionForm } from '@/components/solicitudes/modificacion-form';
import { ApiError, api } from '@/lib/api';
import { TERMINOS_VERSION } from '@/lib/terminos';

// Teclear ~25 campos en jsdom con la suite entera en paralelo supera los 5 s por defecto sin que haya ningún defecto.
vi.setConfig({ testTimeout: 30_000 });

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

const CODIGO_INSCRIPCION = 'M'.repeat(43);

/** Paso 1: nombre artístico y correo → se pide el código. */
async function llenarPaso1() {
  vi.spyOn(api, 'pedirCodigoDeInscripcion').mockResolvedValue({ ok: true });
  await userEvent.type(screen.getByLabelText(/nombre artístico/i), 'Luna');
  await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
  await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
}

/** Paso 2: el código → se canjea por la sesión (y el borrador, si lo había). */
async function llenarPaso2(borrador: Awaited<ReturnType<typeof api.verificarCodigoDeInscripcion>>['borrador'] = null) {
  vi.spyOn(api, 'verificarCodigoDeInscripcion').mockResolvedValue({ ok: true, sesion: 'SESION'.repeat(8), borrador });
  await userEvent.type(await screen.findByLabelText(/código del correo/i), CODIGO_INSCRIPCION);
  await userEvent.click(screen.getByRole('button', { name: /confirmar el código/i }));
}

/** Paso 3: lo que faltaba del paso 1 original (idiomas y redes; color y frase son opcionales). */
async function llenarPaso3() {
  await userEvent.click(await screen.findByText('Español'));
  await userEvent.type(screen.getByLabelText('Plataforma 1'), 'Twitch');
  await userEvent.type(screen.getByLabelText('Enlace 1'), 'https://twitch.tv/luna');
  await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
}

/** Paso 4: imágenes y personaje. */
async function llenarPaso4() {
  for (const [etiqueta, valor] of CAMPOS_PASO_2) await userEvent.type(screen.getByLabelText(etiqueta), valor);
  await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
}

/** Paso 5: gustos. */
async function llenarPaso5() {
  for (const [etiqueta, valor] of CAMPOS_PASO_3) await userEvent.type(screen.getByLabelText(etiqueta), valor);
}

/** Llega hasta el paso 5 con el servidor simulado. */
async function llegarAlPaso5() {
  await llenarPaso1();
  await llenarPaso2();
  await llenarPaso3();
  await llenarPaso4();
}

describe('InscripcionForm', () => {
  beforeEach(() => {
    vi.spyOn(api, 'guardarBorradorDeInscripcion').mockResolvedValue({ ok: true, actualizado: '2026-10-06T12:00:00.000Z' });
  });

  it('el paso 1 pide SOLO el nombre artístico y el correo', () => {
    render(<InscripcionForm />);
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 1 de 5/i);
    expect(screen.getByLabelText(/nombre artístico/i)).toBeRequired();
    expect(screen.getByLabelText(/correo electrónico/i)).toBeRequired();
    // Color, idiomas, frase y redes ya no están aquí: van después de validar el correo.
    expect(screen.queryByLabelText(/color de marca/i)).toBeNull();
    expect(screen.queryByLabelText('Plataforma 1')).toBeNull();
    expect(screen.queryByRole('button', { name: /enviar inscripción/i })).toBeNull();
  });

  it('son 5 pasos: correo, código, ficha, personaje y gustos, con los obligatorios marcados', async () => {
    render(<InscripcionForm />);
    await llenarPaso1();
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 2 de 5/i);
    await llenarPaso2();
    expect(await screen.findByLabelText(/color de marca/i)).toBeInTheDocument();
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 3 de 5/i);
    await llenarPaso3();
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 4 de 5/i);
    // País y signo son opcionales; el resto, no.
    expect(screen.getByLabelText(/^país/i)).not.toBeRequired();
    expect(screen.getByLabelText(/^signo/i)).not.toBeRequired();
    for (const [etiqueta] of CAMPOS_PASO_2) expect(screen.getByLabelText(etiqueta)).toBeRequired();
    await llenarPaso4();
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 5 de 5/i);
    for (const [etiqueta] of CAMPOS_PASO_3) expect(screen.getByLabelText(etiqueta)).toBeRequired();
  });

  it('un código malo muestra el error y se queda en el paso 2', async () => {
    vi.spyOn(api, 'pedirCodigoDeInscripcion').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'verificarCodigoDeInscripcion').mockRejectedValue(new ApiError('Este código no es válido', 410));
    render(<InscripcionForm />);
    await userEvent.type(screen.getByLabelText(/nombre artístico/i), 'Luna');
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
    await userEvent.type(await screen.findByLabelText(/código del correo/i), CODIGO_INSCRIPCION);
    await userEvent.click(screen.getByRole('button', { name: /confirmar el código/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido/i);
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 2 de 5/i);
  });

  it('«Volver» desde el paso 2 conserva el nombre y el correo', async () => {
    render(<InscripcionForm />);
    await llenarPaso1();
    await userEvent.click(await screen.findByRole('button', { name: /volver/i }));
    expect(screen.getByLabelText(/nombre artístico/i)).toHaveValue('Luna');
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveValue('luna@example.com');
  });

  it('el enlace del correo abre el formulario en el paso 2 con el código puesto y lo borra de la barra', async () => {
    window.history.replaceState(null, '', `/inscripcion#t=${CODIGO_INSCRIPCION}`);
    render(<InscripcionForm />);
    expect(await screen.findByLabelText(/código del correo/i)).toHaveValue(CODIGO_INSCRIPCION);
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 2 de 5/i);
    expect(window.location.hash).toBe('');
  });

  it('no deja enviar sin aceptar los términos y enlaza a la página de términos', async () => {
    render(<InscripcionForm />);
    await llegarAlPaso5();
    const enviar = await screen.findByRole('button', { name: /enviar inscripción/i });
    expect(enviar).toBeDisabled();
    const enlace = screen.getAllByRole('link', { name: /términos y condiciones/i })[0];
    expect(enlace).toHaveAttribute('href', '/terminos');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    expect(enviar).toBeEnabled();
  });

  it('envía con la sesión (no el correo) y la versión de los términos, y queda en revisión', async () => {
    const enviar = vi.spyOn(api, 'enviarInscripcion').mockResolvedValue({ ok: true, estado: 'pendiente' });
    render(<InscripcionForm />);
    await llegarAlPaso5();
    await llenarPaso5();
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar inscripción/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({
      sesion: 'SESION'.repeat(8),
      name: 'Luna',
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
    expect(enviar.mock.calls[0][0]).not.toHaveProperty('email');
    expect(await screen.findByTestId('inscripcion-enviada')).toHaveTextContent(/inscripción recibida/i);
  });

  it('muestra el error del servidor', async () => {
    vi.spyOn(api, 'enviarInscripcion').mockRejectedValue(new ApiError('ya hay una solicitud tuya en espera de revisión', 409));
    render(<InscripcionForm />);
    await llegarAlPaso5();
    await llenarPaso5();
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar inscripción/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/en espera de revisión/);
  });

  it('si la sesión caducó al enviar, vuelve al paso 1 (el borrador sigue guardado)', async () => {
    vi.spyOn(api, 'enviarInscripcion').mockRejectedValue(new ApiError('La verificación de tu correo caducó', 410));
    render(<InscripcionForm />);
    await llegarAlPaso5();
    await llenarPaso5();
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar inscripción/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/caducó/i);
    expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 1 de 5/i);
  });

  describe('borrador', () => {
    it('guarda solo lo escrito, con la sesión, en cuanto se deja de teclear (desde el paso 3)', async () => {
      const guardar = vi.spyOn(api, 'guardarBorradorDeInscripcion').mockResolvedValue({ ok: true, actualizado: '2026-10-06T12:00:00.000Z' });
      render(<InscripcionForm />);
      await llenarPaso1();
      await llenarPaso2();
      await userEvent.type(await screen.findByLabelText(/^frase/i), 'Hola mundo');
      await waitFor(() => expect(guardar).toHaveBeenCalled(), { timeout: 4000 });
      const [sesion, datos] = guardar.mock.calls.at(-1)!;
      expect(sesion).toBe('SESION'.repeat(8));
      expect(datos).toMatchObject({ name: 'Luna', phrase: 'Hola mundo', paso: 3 });
      expect(datos).not.toHaveProperty('email');
      expect(datos).not.toHaveProperty('aceptaTerminos');
      expect(await screen.findByTestId('inscripcion-borrador')).toHaveTextContent(/borrador guardado/i);
    });

    it('no guarda nada antes de verificar el correo', async () => {
      const guardar = vi.spyOn(api, 'guardarBorradorDeInscripcion');
      render(<InscripcionForm />);
      await llenarPaso1();
      await new Promise((r) => setTimeout(r, 1500));
      expect(guardar).not.toHaveBeenCalled();
      expect(screen.queryByTestId('inscripcion-borrador')).toBeNull();
    });

    it('al volver con el mismo correo y un código nuevo se recupera el borrador y se sigue en su paso', async () => {
      render(<InscripcionForm />);
      await llenarPaso1();
      await llenarPaso2({
        actualizado: '2026-10-05T18:30:00.000Z',
        datos: {
          name: 'Luna Guardada',
          country: '',
          languages: ['es'],
          phrase: 'Frase guardada',
          cardText: 'Lore guardado',
          themeColor: '#336699',
          imageUrl: 'https://example.com/a.png',
          logoUrl: '',
          zodiac: '',
          height: '1,60 m',
          socials: [{ platform: 'Twitch', url: 'https://twitch.tv/luna' }],
          paso: 4,
        },
      });
      // Siguió en el paso donde se quedó, con lo guardado y el aviso.
      expect(await screen.findByLabelText(/^lore/i)).toHaveValue('Lore guardado');
      expect(screen.getByTestId('inscripcion-paso')).toHaveTextContent(/paso 4 de 5/i);
      expect(screen.getByLabelText(/^estatura/i)).toHaveValue('1,60 m');
      expect(screen.getByText(/recuperamos tu borrador/i)).toBeInTheDocument();
      // Y lo de los pasos anteriores también está: hacia atrás se ve lo que escribió.
      await userEvent.click(screen.getByRole('button', { name: /volver/i }));
      expect(await screen.findByLabelText(/^frase/i)).toHaveValue('Frase guardada');
      expect(screen.getByLabelText('Enlace 1')).toHaveValue('https://twitch.tv/luna');
    });

    it('si guardar falla, lo avisa pero lo escrito sigue en pantalla', async () => {
      vi.spyOn(api, 'guardarBorradorDeInscripcion').mockRejectedValue(new Error('sin red'));
      render(<InscripcionForm />);
      await llenarPaso1();
      await llenarPaso2();
      await userEvent.type(await screen.findByLabelText(/^frase/i), 'Hola');
      expect(await screen.findByText(/no se pudo guardar el borrador/i, undefined, { timeout: 4000 })).toBeInTheDocument();
      expect(screen.getByLabelText(/^frase/i)).toHaveValue('Hola');
    });
  });
});

describe('BajaForm', () => {
  it('avisa de lo que implica la baja y exige los mismos términos', async () => {
    render(<BajaForm />);
    expect(screen.getByTestId('baja-aviso-salida')).toHaveTextContent(/no elimina tu ficha/i);
    const enviar = screen.getByRole('button', { name: /enviarme el código/i });
    expect(enviar).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    expect(enviar).toBeEnabled();
  });

  it('no pide la ficha ni cómo comprobar la titularidad: solo correo y motivo', () => {
    render(<BajaForm />);
    expect(screen.queryByLabelText(/cómo comprobamos/i)).toBeNull();
    expect(screen.getByLabelText(/correo electrónico/i)).toBeRequired();
    expect(screen.getByLabelText(/motivo/i)).not.toBeRequired();
    // La ficha existe, pero escondida y opcional: es para quien no se inscribió con este correo.
    expect(screen.getByLabelText(/^ficha/i)).not.toBeRequired();
  });

  it('paso 1: pide el código; paso 2: se pega el código y se confirma la baja', async () => {
    const enviar = vi.spyOn(api, 'enviarBaja').mockResolvedValue({ ok: true, estado: 'sin_verificar' });
    const verificar = vi.spyOn(api, 'verificarSolicitud').mockResolvedValue({ ok: true, tipo: 'baja', resultado: 'baja_aplicada', fichas: ['Luna'] });
    render(<BajaForm />);
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.type(screen.getByLabelText(/motivo/i), 'ya no streameo');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({ email: 'luna@example.com', motivo: 'ya no streameo', aceptaTerminos: true, terminosVersion: TERMINOS_VERSION });
    expect(enviar.mock.calls[0][0]).not.toHaveProperty('prueba');

    // Paso 2: nada se confirma hasta que se escribe el código.
    expect(await screen.findByTestId('baja-paso-2')).toHaveTextContent(/luna@example\.com/);
    expect(verificar).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText(/código del correo/i), 'A'.repeat(43));
    await userEvent.click(screen.getByRole('button', { name: /confirmar la baja/i }));
    await waitFor(() => expect(verificar).toHaveBeenCalledWith('A'.repeat(43)));
    expect(await screen.findByTestId('verificar-hecho')).toHaveTextContent(/baja aplicada/i);
    expect(screen.getByTestId('verificar-hecho')).toHaveTextContent(/luna/i);
  });

  it('un código incorrecto muestra el error y deja reintentar', async () => {
    vi.spyOn(api, 'enviarBaja').mockResolvedValue({ ok: true, estado: 'sin_verificar' });
    vi.spyOn(api, 'verificarSolicitud').mockRejectedValue(new ApiError('Este enlace no es válido: caducó', 410));
    render(<BajaForm />);
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
    await userEvent.type(await screen.findByLabelText(/código del correo/i), 'B'.repeat(30));
    await userEvent.click(screen.getByRole('button', { name: /confirmar la baja/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido/i);
    expect(screen.getByLabelText(/código del correo/i)).toBeInTheDocument();
  });

  it('sin ficha asociada al correo lo dice, sin prometer nada', async () => {
    vi.spyOn(api, 'enviarBaja').mockResolvedValue({ ok: true, estado: 'sin_verificar' });
    vi.spyOn(api, 'verificarSolicitud').mockResolvedValue({ ok: true, tipo: 'baja', resultado: 'sin_ficha' });
    render(<BajaForm />);
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'otra@example.com');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
    await userEvent.type(await screen.findByLabelText(/código del correo/i), 'C'.repeat(30));
    await userEvent.click(screen.getByRole('button', { name: /confirmar la baja/i }));
    expect(await screen.findByTestId('verificar-hecho')).toHaveTextContent(/no encontramos ninguna ficha/i);
  });
});

describe('ModificacionForm', () => {
  const CODIGO = 'K'.repeat(43);

  /** Pasos 1 y 2: el correo y el código. `fichas` es lo que el servidor devuelve para ese correo. */
  async function verificarCorreo(fichas: Array<{ slug: string; name: string }> = [{ slug: 'luna', name: 'Luna' }]) {
    vi.spyOn(api, 'pedirCodigoDeModificacion').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'verificarCodigoDeModificacion').mockResolvedValue({ ok: true, permiso: 'PERMISO'.repeat(6), fichas });
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
    await userEvent.type(await screen.findByLabelText(/código del correo/i), CODIGO);
    await userEvent.click(screen.getByRole('button', { name: /confirmar el código/i }));
    await screen.findByTestId('modificacion-ficha');
  }

  it('el paso 1 pide SOLO el correo: ni ficha ni cómo comprobar la titularidad', () => {
    render(<ModificacionForm />);
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 1 de 4/i);
    expect(screen.getByLabelText(/correo electrónico/i)).toBeRequired();
    expect(screen.queryByLabelText(/^ficha/i)).toBeNull();
    expect(screen.queryByLabelText(/cómo comprobamos/i)).toBeNull();
  });

  it('paso 2: pide el código y no avanza hasta confirmarlo; con ficha única no la pregunta', async () => {
    render(<ModificacionForm />);
    await verificarCorreo();
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 3 de 4/i);
    expect(screen.getByTestId('modificacion-ficha')).toHaveTextContent(/vas a actualizar luna/i);
    expect(screen.queryByLabelText(/^ficha/i)).toBeNull();
    for (const etiqueta of [/^estatura/i, /^cumpleaños/i, /^lore/i, /^avatar/i, /^logo/i, /^país/i]) {
      expect(screen.getByLabelText(etiqueta)).not.toBeRequired();
    }
  });

  it('un código malo muestra el error y se queda en el paso 2', async () => {
    vi.spyOn(api, 'pedirCodigoDeModificacion').mockResolvedValue({ ok: true });
    vi.spyOn(api, 'verificarCodigoDeModificacion').mockRejectedValue(new ApiError('Este código no es válido', 410));
    render(<ModificacionForm />);
    await userEvent.type(screen.getByLabelText(/correo electrónico/i), 'luna@example.com');
    await userEvent.click(screen.getByRole('button', { name: /enviarme el código/i }));
    await userEvent.type(await screen.findByLabelText(/código del correo/i), CODIGO);
    await userEvent.click(screen.getByRole('button', { name: /confirmar el código/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es válido/i);
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 2 de 4/i);
  });

  it('con varias fichas en el correo se elige una; sin ninguna se escribe', async () => {
    const { unmount } = render(<ModificacionForm />);
    await verificarCorreo([
      { slug: 'luna', name: 'Luna' },
      { slug: 'sol', name: 'Sol' },
    ]);
    const lista = screen.getByLabelText(/cuál de tus fichas/i);
    expect(lista).toBeRequired();
    unmount();
    cleanup();
    render(<ModificacionForm />);
    await verificarCorreo([]);
    expect(screen.getByLabelText(/^ficha/i)).toBeRequired();
  });

  it('el enlace del correo abre el formulario en el paso 2 con el código puesto y lo borra de la barra', async () => {
    window.history.replaceState(null, '', `/modificacion#t=${CODIGO}`);
    render(<ModificacionForm />);
    expect(await screen.findByLabelText(/código del correo/i)).toHaveValue(CODIGO);
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 2 de 4/i);
    expect(window.location.hash).toBe('');
  });

  it('no deja enviar si no hay ningún cambio', async () => {
    const enviar = vi.spyOn(api, 'enviarModificacion').mockResolvedValue({ ok: true, estado: 'pendiente' });
    render(<ModificacionForm />);
    await verificarCorreo();
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/al menos un cambio/i);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('envía solo lo que se cambió, con el permiso (no el correo) y los términos, y queda en revisión', async () => {
    const enviar = vi.spyOn(api, 'enviarModificacion').mockResolvedValue({ ok: true, estado: 'pendiente' });
    render(<ModificacionForm />);
    await verificarCorreo();
    await userEvent.type(screen.getByLabelText(/^estatura/i), '1,70 m');
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 4 de 4/i);
    await userEvent.type(screen.getByLabelText(/^anime favorito/i), 'Frieren');
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    await waitFor(() => expect(enviar).toHaveBeenCalledOnce());
    expect(enviar.mock.calls[0][0]).toMatchObject({
      permiso: 'PERMISO'.repeat(6),
      ficha: 'luna',
      height: '1,70 m',
      favoriteAnime: 'Frieren',
      birthday: '',
      themeColor: '',
      socials: [],
      aceptaTerminos: true,
      terminosVersion: TERMINOS_VERSION,
    });
    expect(enviar.mock.calls[0][0]).not.toHaveProperty('email');
    expect(await screen.findByTestId('modificacion-enviada')).toHaveTextContent(/solicitud recibida/i);
  });

  it('si el permiso caducó, vuelve al paso 1 con el aviso', async () => {
    vi.spyOn(api, 'enviarModificacion').mockRejectedValue(new ApiError('La verificación de tu correo caducó', 410));
    render(<ModificacionForm />);
    await verificarCorreo();
    await userEvent.type(screen.getByLabelText(/^estatura/i), '1,70 m');
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: /he leído y acepto/i }));
    await userEvent.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/caducó/i);
    expect(screen.getByTestId('modificacion-paso')).toHaveTextContent(/paso 1 de 4/i);
  });
});
