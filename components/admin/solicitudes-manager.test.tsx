import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { SolicitudAdmin, VistaPreviaSolicitud } from '@/lib/api';
import { RechazosPanel, SolicitudesManager, tituloDe } from '@/components/admin/solicitudes-manager';

const mocks = vi.hoisted(() => ({
  solicitudes: vi.fn(),
  resolverSolicitud: vi.fn(),
  vistaPreviaSolicitud: vi.fn(),
  adminList: vi.fn(),
  rechazosDeSolicitudes: vi.fn(),
}));
vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, api: { ...mocks } };
});

const hace = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const sol = (id: number, tipo: SolicitudAdmin['tipo'], datos: Record<string, unknown>, extra: Partial<SolicitudAdmin> = {}): SolicitudAdmin => ({
  id,
  tipo,
  estado: 'pendiente',
  datos,
  contacto: { email: `persona${id}@example.com`, realName: `Persona ${id}` },
  terminosVersion: '2026-10-01',
  terminosAceptadosEn: hace(10),
  creado: hace(id * 10),
  resuelto: null,
  resueltoPor: null,
  nota: null,
  vtuberSlug: null,
  ...extra,
});

const COLA = [
  sol(1, 'inscripcion', { name: 'Nueva Estrella', country: 'chile', languages: ['es'], themeColor: '#336699', phrase: 'Hola', cardText: 'Una historia larga.', socials: [{ platform: 'twitch', url: 'https://twitch.tv/x' }] }),
  sol(2, 'modificacion', { ficha: '#486 CEJ PAPA LUCHON', phrase: 'Nueva frase' }),
  sol(3, 'baja', { ficha: '/v/alguien', prueba: 'soy el titular', motivo: 'ya no streameo' }),
];

const OK: VistaPreviaSolicitud = { tipo: 'inscripcion', estado: 'pendiente', puedeAprobar: true, problema: null, avisos: [], creara: { name: 'Nueva Estrella', slug: 'nueva-estrella', estado: 'draft' } };

beforeEach(() => {
  mocks.solicitudes.mockImplementation(async (_t: string, estado: string, tipo?: string) => ({
    items: COLA.filter((s) => (estado === 'todas' || s.estado === estado) && (!tipo || s.tipo === tipo)),
    pendientes: { inscripcion: 1, modificacion: 1, baja: 1 },
  }));
  mocks.vistaPreviaSolicitud.mockImplementation(async (_t: string, id: number) => {
    if (id === 2) {
      return {
        tipo: 'modificacion', estado: 'pendiente', puedeAprobar: true, problema: null, avisos: [],
        ficha: { id: 487, slug: 'cej-papa-luchon', name: 'CEJ Papá Luchón', dexNumber: 486, status: 'published', grado: '8' },
        cambios: [{ campo: 'Frase', antes: 'Antigua', despues: 'Nueva frase', nuevo: false }, { campo: 'Estatura', antes: '', despues: '1,70 m', nuevo: true }],
      } satisfies VistaPreviaSolicitud;
    }
    if (id === 3) return { tipo: 'baja', estado: 'pendiente', puedeAprobar: true, problema: null, avisos: ['«Marcar procesada» solo cierra la solicitud'], ficha: null } satisfies VistaPreviaSolicitud;
    return OK;
  });
  mocks.resolverSolicitud.mockResolvedValue({ solicitud: COLA[0] });
  mocks.adminList.mockResolvedValue({ items: [], total: 0, page: 1, pageCount: 1, perPage: 6 });
});
afterEach(() => vi.clearAllMocks());

const montar = () => {
  const notify = vi.fn();
  const onChanged = vi.fn();
  render(<SolicitudesManager token="t" notify={notify} onChanged={onChanged} />);
  return { notify, onChanged };
};
const detalle = async () => within(await screen.findByTestId('solicitud-detalle'));
/**
 * El detalle aparece ANTES de que termine la comprobación del servidor y, mientras comprueba, «Aprobar» está
 * deshabilitado a propósito (no se aprueba a ciegas). Las pruebas que actúan esperan a que termine.
 */
const listaParaActuar = async (nombreBoton: string | RegExp = /Aprobar|Marcar procesada/) => {
  await screen.findByTestId('solicitud-detalle');
  await waitFor(() => expect(screen.getByRole('button', { name: nombreBoton })).toBeEnabled());
};

describe('SolicitudesManager: la lista', () => {
  test('una línea por solicitud con su tipo, su nombre y hace cuánto llegó (no un muro de campos)', async () => {
    montar();
    const fila = await screen.findByTestId('solicitud-1');
    expect(fila).toHaveTextContent('Inscripción');
    expect(fila).toHaveTextContent('Nueva Estrella');
    expect(fila).toHaveTextContent(/hace \d+ min/);
    expect(screen.getByTestId('solicitud-2')).toHaveTextContent('#486 CEJ PAPA LUCHON');
    expect(screen.getByTestId('solicitud-3')).toHaveTextContent('Baja');
    // El resto de los campos NO está en la lista.
    expect(fila).not.toHaveTextContent('Una historia larga');
  });

  test('la primera queda seleccionada y su detalle a la vista; elegir otra cambia el detalle', async () => {
    montar();
    expect(await screen.findByRole('heading', { name: 'Nueva Estrella' })).toBeInTheDocument();
    expect(screen.getByTestId('solicitud-1')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByTestId('solicitud-3'));
    expect(await screen.findByRole('heading', { name: '/v/alguien' })).toBeInTheDocument();
    expect(screen.getByTestId('solicitud-3')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('solicitud-1')).not.toHaveAttribute('aria-current');
  });

  test('los filtros de estado y de tipo piden lo que corresponde, y el de pendientes lleva su contador', async () => {
    montar();
    await screen.findByTestId('solicitud-1');
    expect(screen.getByRole('button', { name: /Pendientes/ })).toHaveTextContent('3');
    fireEvent.click(screen.getByRole('button', { name: /^Modificaciones/ }));
    await waitFor(() => expect(mocks.solicitudes).toHaveBeenLastCalledWith('t', 'pendiente', 'modificacion'));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobadas' }));
    await waitFor(() => expect(mocks.solicitudes).toHaveBeenLastCalledWith('t', 'aprobada', 'modificacion'));
  });

  test('sin pendientes lo dice con buen ánimo', async () => {
    mocks.solicitudes.mockResolvedValue({ items: [], pendientes: { inscripcion: 0, modificacion: 0, baja: 0 } });
    montar();
    expect(await screen.findByTestId('solicitudes-vacio')).toHaveTextContent('Al día');
  });

  test('tituloDe: el nombre en una inscripción, la ficha pedida en el resto, y un respaldo', () => {
    expect(tituloDe(COLA[0])).toBe('Nueva Estrella');
    expect(tituloDe(COLA[1])).toBe('#486 CEJ PAPA LUCHON');
    expect(tituloDe(sol(9, 'baja', {}))).toBe('Solicitud #9');
  });
});

describe('SolicitudesManager: antes de aprobar se sabe qué pasará', () => {
  test('inscripción: dice qué ficha creará, en borrador, y con qué dirección', async () => {
    montar();
    const v = await screen.findByTestId('solicitud-veredicto');
    expect(v).toHaveTextContent('Lista para aprobar');
    expect(v).toHaveTextContent('Nueva Estrella');
    expect(v).toHaveTextContent('borrador');
    expect(v).toHaveTextContent('/v/nueva-estrella');
  });

  test('modificación: muestra QUÉ CAMBIA, con el valor de ahora y el propuesto', async () => {
    montar();
    fireEvent.click(await screen.findByTestId('solicitud-2'));
    const tabla = await screen.findByTestId('solicitud-cambios');
    expect(within(tabla).getByText('Frase').closest('tr')).toHaveTextContent('Antigua');
    expect(within(tabla).getByText('Frase').closest('tr')).toHaveTextContent('Nueva frase');
    expect(within(tabla).getByText('Estatura').closest('tr')).toHaveTextContent('(vacío)');
    expect(await screen.findByTestId('solicitud-veredicto')).toHaveTextContent('Aplicará 2 cambios a «CEJ Papá Luchón»');
  });

  test('los avisos del servidor se ven', async () => {
    montar();
    fireEvent.click(await screen.findByTestId('solicitud-3'));
    expect(await screen.findByText(/solo cierra la solicitud/)).toBeInTheDocument();
  });

  test('si la regla rechaza, explica por qué y NO deja aprobar', async () => {
    mocks.vistaPreviaSolicitud.mockResolvedValue({ ...OK, puedeAprobar: false, creara: undefined, problema: { codigo: 'pais_desconocido', mensaje: 'El país indicado no está en el catálogo.' } });
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent('El país indicado no está en el catálogo.');
    expect(screen.getByRole('button', { name: 'Aprobar y crear borrador' })).toBeDisabled();
  });

  test('si el servidor no ofrece la vista previa, la pantalla sigue siendo usable', async () => {
    mocks.vistaPreviaSolicitud.mockRejectedValue(new Error('no_disponible'));
    montar();
    await screen.findByRole('heading', { name: 'Nueva Estrella' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aprobar y crear borrador' })).toBeEnabled());
  });
});

describe('SolicitudesManager: la ficha no se encontró', () => {
  const sinFicha: VistaPreviaSolicitud = {
    tipo: 'modificacion', estado: 'pendiente', puedeAprobar: false, avisos: [],
    problema: { codigo: 'ficha_no_encontrada', mensaje: 'No se encontró la ficha «#486 CEJ PAPA LUCHON». Elige cuál es.' },
    candidatas: [{ id: 487, slug: 'cej-papa-luchon', name: 'CEJ Papá Luchón', dexNumber: 486, status: 'published', grado: '8' }],
  };
  const conFicha: VistaPreviaSolicitud = {
    tipo: 'modificacion', estado: 'pendiente', puedeAprobar: true, problema: null, avisos: [],
    ficha: { id: 487, slug: 'cej-papa-luchon', name: 'CEJ Papá Luchón', dexNumber: 486, status: 'published', grado: '8' },
    cambios: [{ campo: 'Frase', antes: 'a', despues: 'b', nuevo: false }],
  };

  test('se ELIGE la ficha entre las candidatas, se recalcula y se aprueba con esa ficha', async () => {
    mocks.vistaPreviaSolicitud.mockImplementation(async (_t: string, _id: number, ficha?: string) => (ficha ? conFicha : sinFicha));
    const { onChanged } = montar();
    fireEvent.click(await screen.findByTestId('solicitud-2'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Elige cuál es');
    const aprobar = screen.getByRole('button', { name: 'Aprobar y aplicar cambios' });
    expect(aprobar).toBeDisabled();

    const picker = within(await screen.findByTestId('solicitud-elegir-ficha'));
    fireEvent.click(picker.getByRole('button', { name: 'Es esta' }));
    await waitFor(() => expect(mocks.vistaPreviaSolicitud).toHaveBeenLastCalledWith('t', 2, 'cej-papa-luchon'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aprobar y aplicar cambios' })).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: 'Aprobar y aplicar cambios' }));
    await waitFor(() => expect(mocks.resolverSolicitud).toHaveBeenCalledWith('t', 2, 'aprobar', '', 'cej-papa-luchon'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  test('también se puede buscar la ficha', async () => {
    mocks.vistaPreviaSolicitud.mockResolvedValue({ ...sinFicha, candidatas: [] });
    mocks.adminList.mockResolvedValue({ items: [{ id: 5, slug: 'otra', name: 'Otra Ficha', dexNumber: 5, status: 'published', premium: null }], total: 1, page: 1, pageCount: 1, perPage: 6 });
    montar();
    fireEvent.click(await screen.findByTestId('solicitud-2'));
    const picker = within(await screen.findByTestId('solicitud-elegir-ficha'));
    fireEvent.change(picker.getByLabelText('Buscar la ficha de esta solicitud'), { target: { value: 'otra' } });
    expect(await picker.findByText('Otra Ficha')).toBeInTheDocument();
    expect(mocks.adminList.mock.calls.some((c) => c[1].q === 'otra')).toBe(true);
  });
});

describe('SolicitudesManager: resolver', () => {
  test('aprobar una inscripción avisa, refresca y manda la nota', async () => {
    const { notify, onChanged } = montar();
    await listaParaActuar('Aprobar y crear borrador');
    fireEvent.change(screen.getByLabelText('Nota de la solicitud 1'), { target: { value: 'todo en orden' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar y crear borrador' }));
    await waitFor(() => expect(mocks.resolverSolicitud).toHaveBeenCalledWith('t', 1, 'aprobar', 'todo en orden', undefined));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('ok', 'Ficha creada en borrador'));
    expect(onChanged).toHaveBeenCalled();
  });

  test('una baja se «marca procesada» (y no se aprueba)', async () => {
    montar();
    fireEvent.click(await screen.findByTestId('solicitud-3'));
    await screen.findByRole('heading', { name: '/v/alguien' });
    await listaParaActuar('Marcar procesada');
    fireEvent.click(screen.getByRole('button', { name: 'Marcar procesada' }));
    await waitFor(() => expect(mocks.resolverSolicitud).toHaveBeenCalledWith('t', 3, 'procesar', '', undefined));
  });

  test('rechazar pide confirmación: borra el contacto y no se deshace', async () => {
    const { notify } = montar();
    await listaParaActuar('Aprobar y crear borrador');
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    expect(mocks.resolverSolicitud).not.toHaveBeenCalled();
    expect(screen.getByTestId('solicitud-confirmar-rechazo')).toHaveTextContent('Se borrará el contacto');
    fireEvent.click(screen.getByRole('button', { name: 'No' }));
    expect(mocks.resolverSolicitud).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sí, rechazar' }));
    await waitFor(() => expect(mocks.resolverSolicitud).toHaveBeenCalledWith('t', 1, 'rechazar', '', undefined));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('ok', 'Solicitud rechazada'));
  });

  test('un error del servidor llega como aviso y la cola no se rompe', async () => {
    mocks.resolverSolicitud.mockRejectedValueOnce(new Error('ya_resuelta'));
    const { notify } = montar();
    await listaParaActuar('Aprobar y crear borrador');
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar y crear borrador' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('error', 'ya_resuelta'));
    expect(screen.getByTestId('solicitud-1')).toBeInTheDocument();
  });

  test('al cambiar de solicitud se limpia la nota y la confirmación de la anterior', async () => {
    montar();
    await listaParaActuar('Aprobar y crear borrador');
    fireEvent.change(screen.getByLabelText('Nota de la solicitud 1'), { target: { value: 'nota vieja' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechazar' }));
    fireEvent.click(screen.getByTestId('solicitud-3'));
    await screen.findByRole('heading', { name: '/v/alguien' });
    expect((screen.getByLabelText('Nota de la solicitud 3') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('solicitud-confirmar-rechazo')).not.toBeInTheDocument();
  });

  test('el contacto confidencial nace oculto (streaming) y al mostrarlo el correo es un enlace', async () => {
    montar();
    const d = await detalle();
    const contacto = d.getByTestId('solicitud-contacto');
    expect(contacto).toHaveTextContent('Contacto confidencial');
    expect(contacto).not.toHaveTextContent('persona1@example.com');
    expect(d.queryByRole('link', { name: 'persona1@example.com' })).toBeNull();
    fireEvent.click(within(contacto).getByRole('button', { name: /Mostrar correo/ }));
    expect(d.getByRole('link', { name: 'persona1@example.com' })).toHaveAttribute('href', 'mailto:persona1@example.com');
  });
});

describe('RechazosPanel', () => {
  test('se pide al abrirlo y muestra formulario, código y campos, sin datos personales', async () => {
    mocks.rechazosDeSolicitudes.mockResolvedValue({
      dias: 7,
      total: 3,
      porCodigo: [{ formulario: 'inscripcion', codigo: 'payload_invalido', status: 400, n: 3 }],
      porCampo: [{ formulario: 'inscripcion', campo: 'socials.0.url', n: 2 }],
      ultimo: null,
    });
    render(<RechazosPanel token="t" />);
    expect(mocks.rechazosDeSolicitudes).not.toHaveBeenCalled();
    const detalle = screen.getByTestId('rechazos-panel') as HTMLDetailsElement;
    detalle.open = true;
    fireEvent(detalle, new Event('toggle'));
    expect(await screen.findByText('payload_invalido', { exact: false })).toBeTruthy();
    expect(screen.getByText(/socials\.0\.url/)).toBeTruthy();
    expect(mocks.rechazosDeSolicitudes).toHaveBeenCalledWith('t', 7);
  });
});
