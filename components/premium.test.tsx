/**
 * Cartas premium: la placa de acrílico (geometría, material, hoja interior con la etiqueta) y el
 * mantenedor que las gestiona.
 *
 * jsdom no tiene WebGL, así que la ESCENA no se puede montar: se fija lo que sí es verificable sin
 * navegador — que la carta cabe en su ventana y la placa en su funda, que el cuerpo mide lo que
 * debe (el bisel de un `ExtrudeGeometry` expande el contorno), que cada uniforme del acrílico está
 * declarado en el shader, y qué texto lleva la etiqueta. La imagen real se mira en el navegador.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { BINDER, GEOMETRY, PREMIUM } from '@/components/card3d-config';
import { PremiumBadge } from '@/components/premium-badge';
import { SIN_REFUERZO, factorDeGrado, refuerzoDeGrado } from '@/components/premium-boost';
import { ajustarFuente, barrasDeCertificado, dibujarHojaInterior } from '@/components/premium-label';
import { slabLayout } from '@/components/premium-layout';
import { crearCuerpo, crearMaterialDeAcrilico, formaRedondeada } from '@/components/premium-slab';
import { PremiumManager } from '@/components/admin/premium-manager';
import { GRADOS, hoy } from '@/lib/premium';
import type { PremiumInfo } from '@/lib/types';
import { makeCard } from '@/test/fixtures';

const CARD_W = GEOMETRY.cardWidth;
const CARD_H = GEOMETRY.cardWidth * GEOMETRY.aspect;
const PAD = BINDER.pocketPad;

const premium = (overrides: Partial<PremiumInfo> = {}): PremiumInfo => ({
  grade: '10',
  since: '2026-05-01',
  gradedAt: '2026-09-01',
  cert: 'VTD-000017',
  ...overrides,
});

describe('layout de la placa', () => {
  const layout = slabLayout(CARD_W, CARD_H, PAD);

  test('el alto de la placa es el de la funda: no se sale de su casilla en el libro', () => {
    expect(layout.height).toBeCloseTo(CARD_H + 2 * PAD, 10);
    // La funda mide carta + 2 x holgura de ancho; la placa es más estrecha y cabe.
    expect(layout.width).toBeLessThan(CARD_W + 2 * PAD);
  });

  test('la carta escalada cabe EXACTO en la ventana (mismo ancho, misma proporción)', () => {
    expect(CARD_W * layout.cardScale).toBeCloseTo(layout.window.w, 10);
    expect(CARD_H * layout.cardScale).toBeCloseTo(layout.window.h, 10);
    expect(layout.cardScale).toBeLessThan(1);
  });

  test('etiqueta arriba, ventana abajo, sin solaparse y dentro de la placa', () => {
    const arribaDeVentana = layout.window.y + layout.window.h / 2;
    const abajoDeEtiqueta = layout.label.y - layout.label.h / 2;
    expect(abajoDeEtiqueta).toBeGreaterThan(arribaDeVentana);
    const techo = layout.height / 2;
    expect(layout.label.y + layout.label.h / 2).toBeLessThan(techo);
    expect(layout.window.y - layout.window.h / 2).toBeGreaterThan(-techo);
    // El margen inferior y superior son el mismo: la composición queda centrada.
    const margenSuperior = techo - (layout.label.y + layout.label.h / 2);
    const margenInferior = layout.window.y - layout.window.h / 2 + techo;
    expect(margenInferior).toBeCloseTo(margenSuperior, 10);
    expect(margenSuperior).toBeCloseTo(layout.margin, 10);
  });
});

describe('cuerpo de acrílico', () => {
  const layout = slabLayout(CARD_W, CARD_H, PAD);

  test('mide lo que la placa: el bisel NO la agranda', () => {
    // Un ExtrudeGeometry con bisel expande el contorno hacia fuera; sin insetar la forma, el
    // cuerpo sería mayor que la funda por el grosor del bisel.
    const geometria = crearCuerpo(layout);
    geometria.computeBoundingBox();
    const caja = geometria.boundingBox!;
    expect(caja.max.x - caja.min.x).toBeCloseTo(layout.width, 4);
    expect(caja.max.y - caja.min.y).toBeCloseTo(layout.height, 4);
    geometria.dispose();
  });

  test('ocupa de z = -back a z = +front: la carta (z≈0) queda DENTRO del cuerpo', () => {
    const geometria = crearCuerpo(layout);
    geometria.computeBoundingBox();
    const caja = geometria.boundingBox!;
    expect(caja.min.z).toBeCloseTo(-PREMIUM.body.back, 4);
    expect(caja.max.z).toBeCloseTo(PREMIUM.body.front, 4);
    const caraDeLaCarta = PREMIUM.cardZ + (GEOMETRY.cardDepth / 2 + GEOMETRY.faceZGap) * layout.cardScale;
    expect(caraDeLaCarta).toBeGreaterThan(caja.min.z);
    expect(caraDeLaCarta).toBeLessThan(caja.max.z);
    expect(PREMIUM.insertZ).toBeGreaterThan(caja.min.z);
    expect(PREMIUM.insertZ).toBeLessThan(caraDeLaCarta);
    geometria.dispose();
  });

  test('la forma redondeada es cerrada y de las medidas pedidas', () => {
    const puntos = formaRedondeada(2, 3, 0.25).getPoints(8);
    const xs = puntos.map((p) => p.x);
    const ys = puntos.map((p) => p.y);
    expect(Math.min(...xs)).toBeCloseTo(-1, 6);
    expect(Math.max(...xs)).toBeCloseTo(1, 6);
    expect(Math.min(...ys)).toBeCloseTo(-1.5, 6);
    expect(Math.max(...ys)).toBeCloseTo(1.5, 6);
  });
});

describe('material de acrílico', () => {
  const layout = slabLayout(CARD_W, CARD_H, PAD);

  test('es transparente y NO escribe profundidad (si no, taparía la carta de detrás)', () => {
    const material = crearMaterialDeAcrilico(layout);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    material.dispose();
  });

  test('cada uniforme que crea la CPU está declarado en el shader, y al revés', () => {
    const material = crearMaterialDeAcrilico(layout);
    const declarados = [...material.fragmentShader.matchAll(/uniform\s+\w+\s+(\w+);/g)].map((m) => m[1]);
    expect(declarados.sort()).toEqual(Object.keys(material.uniforms).sort());
    // Y se LEEN: un uniforme declarado que nadie usa sería código muerto subido a la GPU.
    for (const nombre of declarados) {
      const usos = material.fragmentShader.split(nombre).length - 1;
      expect(usos, nombre).toBeGreaterThanOrEqual(2);
    }
    material.dispose();
  });

  test('las perillas llegan desde la config (ningún número del efecto escrito a mano en el shader)', () => {
    const material = crearMaterialDeAcrilico(layout);
    expect(material.uniforms.uFresnel.value).toBe(PREMIUM.acrylic.fresnel);
    expect(material.uniforms.uBandCenter.value).toBe(PREMIUM.acrylic.bandCenter);
    expect(material.uniforms.uHalf.value.x).toBeCloseTo(layout.width / 2, 10);
    expect(material.uniforms.uHalf.value.y).toBeCloseTo(layout.height / 2, 10);
    material.dispose();
  });

  test('sin backticks sueltos (cerrarían el template literal del shader)', () => {
    const material = crearMaterialDeAcrilico(layout);
    expect(material.fragmentShader).not.toContain('`');
    expect(material.vertexShader).not.toContain('`');
    material.dispose();
  });
});

/** Un contexto 2D de mentira que anota lo que se escribe, para comprobar la etiqueta sin navegador. */
function contextoGrabador() {
  const textos: string[] = [];
  let rellenos = 0;
  const objetivo: Record<string, unknown> = {};
  const ctx = new Proxy(objetivo, {
    get(destino, propiedad: string) {
      if (propiedad === 'fillText') return (texto: string) => void textos.push(texto);
      if (propiedad === 'fillRect') return () => void (rellenos += 1);
      if (propiedad === 'measureText') return (texto: string) => ({ width: texto.length * 5 });
      if (propiedad === 'createLinearGradient') return () => ({ addColorStop: () => undefined });
      if (propiedad in destino) return destino[propiedad];
      return () => undefined;
    },
    set(destino, propiedad: string, valor) {
      destino[propiedad] = valor;
      return true;
    },
  });
  return { ctx, textos, rellenos: () => rellenos };
}

describe('hoja interior y etiqueta', () => {
  const layout = slabLayout(CARD_W, CARD_H, PAD);
  const card = makeCard({ id: 17, dexNumber: 16, name: 'madKoding' });
  const datos = (p: PremiumInfo) => ({ name: card.name, dexNumber: card.dexNumber, country: 'Chile', premium: p });

  beforeEach(() => vi.restoreAllMocks());

  test('sin contexto 2D (jsdom) devuelve el lienzo en blanco en vez de romper', () => {
    const lienzo = dibujarHojaInterior(layout, datos(premium()));
    expect(lienzo.width).toBe(PREMIUM.insert.pxWidth);
    expect(lienzo.height).toBe(Math.round(layout.height * (PREMIUM.insert.pxWidth / layout.width)));
  });

  test('una etiqueta normal lleva marca, nombre, número, país, certificado, año y nota', () => {
    const grabador = contextoGrabador();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(grabador.ctx as never);
    dibujarHojaInterior(layout, datos(premium({ grade: '10' })));
    expect(grabador.textos).toEqual(
      expect.arrayContaining(['VTUBERDEX', 'PREMIUM', 'MADKODING', expect.stringMatching(/^#016 · Chile · \d+ meses seguidos$/), '10', 'GEM MINT', 'VTD-000017 · 2026']),
    );
    expect(grabador.textos).not.toContain('BLACK LABEL');
    expect(grabador.rellenos(), 'banda, divisor y barras del código').toBeGreaterThan(3);
  });

  test('la Black Label es una etiqueta distinta: «BLACK LABEL», 10 pristino', () => {
    const grabador = contextoGrabador();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(grabador.ctx as never);
    dibujarHojaInterior(layout, datos(premium({ grade: 'BL' })));
    expect(grabador.textos).toEqual(expect.arrayContaining(['BLACK LABEL', '10', 'PRISTINE']));
    expect(grabador.textos).not.toContain('PREMIUM');
  });

  test('un grado intermedio muestra su nota tal cual', () => {
    const grabador = contextoGrabador();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(grabador.ctx as never);
    dibujarHojaInterior(layout, datos(premium({ grade: '8.5' })));
    expect(grabador.textos).toEqual(expect.arrayContaining(['8.5', 'NM/MT+']));
  });

  test('un nombre larguísimo se recorta en vez de salirse de la etiqueta', () => {
    const grabador = contextoGrabador();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(grabador.ctx as never);
    dibujarHojaInterior(layout, { ...datos(premium()), name: 'Un VTuber con un nombre absurdamente largo que no cabe'.repeat(3) });
    const nombre = grabador.textos.find((texto) => texto.startsWith('UN VTUBER'))!;
    expect(nombre.endsWith('…')).toBe(true);
    expect(nombre.length * 5).toBeLessThanOrEqual(PREMIUM.insert.pxWidth);
  });

  test('todos los grados tienen su banda de color', () => {
    for (const grado of GRADOS) expect(PREMIUM.label.bands[grado], grado).toHaveLength(2);
  });
});

describe('utilidades de la etiqueta', () => {
  test('ajustarFuente baja de a un píxel hasta que cabe, sin pasar del mínimo', () => {
    expect(ajustarFuente((px) => px * 10, 200, 30, 8)).toBe(20);
    expect(ajustarFuente((px) => px * 10, 5000, 30, 8)).toBe(30);
    expect(ajustarFuente((px) => px * 1000, 10, 30, 8)).toBe(8);
  });

  test('el código de barras sale del certificado y no cambia', () => {
    expect(barrasDeCertificado('VTD-000017')).toEqual(barrasDeCertificado('VTD-000017'));
    expect(barrasDeCertificado('VTD-000017')).not.toEqual(barrasDeCertificado('VTD-000018'));
    for (const ancho of barrasDeCertificado('VTD-123456')) expect(ancho).toBeGreaterThanOrEqual(1);
  });
});

describe('PremiumBadge', () => {
  test('dice el nombre y el grado, y distingue la Black Label', () => {
    const { rerender } = render(<PremiumBadge premium={premium({ grade: '9' })} />);
    expect(screen.getByTestId('premium-badge')).toHaveTextContent('MINT 9');
    expect(screen.getByTestId('premium-badge')).toHaveAttribute('data-grade', '9');
    rerender(<PremiumBadge premium={premium({ grade: 'BL' })} />);
    expect(screen.getByTestId('premium-badge')).toHaveTextContent('BLACK LABEL');
    expect(screen.getByTestId('premium-badge')).toHaveAttribute('title', expect.stringContaining('VTD-000017'));
  });
});

/* ------------------------------------------------------------------ mantenedor */

const mocks = vi.hoisted(() => ({ adminList: vi.fn(), updateVtuber: vi.fn(), adminDetail: vi.fn() }));
vi.mock('@/lib/api', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api')>();
  return { ...actual, api: { ...mocks } };
});

describe('PremiumManager', () => {
  const fila = (id: number, name: string, p: PremiumInfo | null, extra = {}) =>
    makeCard({ id, dexNumber: id, slug: name.toLowerCase(), name, premium: p, ...extra });
  const hoyMismoMes = hoy();
  const tabla = {
    premium: [
      fila(17, 'madKoding', premium({ grade: '9', gradedAt: '2026-01-05' })),
      fila(40, 'Maxima', premium({ grade: 'BL', cert: 'VTD-040' }), { status: 'draft' }),
    ],
    busqueda: [fila(50, 'Mari', null), fila(51, 'Madre', premium({ grade: '8' }))],
  };

  beforeEach(() => {
    mocks.adminList.mockImplementation(async (_token: string, params: { premium?: boolean }) => {
      const items = params.premium ? tabla.premium : tabla.busqueda;
      return { items, total: items.length, page: 1, perPage: 100, pageCount: 1 };
    });
    mocks.updateVtuber.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());

  const montar = () => {
    const notify = vi.fn();
    const onChanged = vi.fn();
    render(<PremiumManager token="t" notify={notify} onChanged={onChanged} />);
    return { notify, onChanged };
  };
  /** La fila de una carta por su nombre (el orden por defecto es «grado mayor primero»). */
  const filaDe = async (nombre: string) => {
    const filas = await screen.findAllByTestId('premium-row');
    const fila = filas.find((f) => within(f).queryByText(nombre));
    if (!fila) throw new Error(`no hay fila para ${nombre}`);
    return fila;
  };
  const abrirMas = async (nombre: string) => {
    const f = await filaDe(nombre);
    fireEvent.click(within(f).getByRole('button', { name: `Más opciones de ${nombre}` }));
    return within(await screen.findByTestId('premium-mas'));
  };
  const abrirAlta = async () => {
    await screen.findAllByTestId('premium-row');
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva premium' }));
  };

  test('lista una línea por carta con su grado, número y último cambio', async () => {
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    expect(filas).toHaveLength(2);
    expect(mocks.adminList.mock.calls[0][1]).toMatchObject({ premium: true });
    // Orden por defecto: la de mayor grado primero (Black Label, luego el 9).
    expect(filas[0]).toHaveTextContent('Maxima');
    expect(within(filas[1]).getByTestId('premium-badge')).toHaveAttribute('data-grade', '9');
    expect(filas[1]).toHaveTextContent('#017');
    expect(filas[1]).toHaveTextContent('2026-01-05');
    // Una carta en borrador avisa de que el público no la ve.
    expect(filas[0]).toHaveTextContent('borrador');
  });

  test('el detalle (certificado, antigüedad) está en «Más», no ensucia cada línea', async () => {
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    expect(filas[1]).not.toHaveTextContent('VTD-');
    const mas = await abrirMas('madKoding');
    expect(mas.getByText(/Certificado/)).toHaveTextContent('VTD-000017');
    expect(mas.getByText(/Premium desde 2026-05-01/)).toBeInTheDocument();
  });

  test('«Subir a …» manda el grado siguiente de la escala', async () => {
    const { notify, onChanged } = montar();
    fireEvent.click(within(await filaDe('madKoding')).getByRole('button', { name: 'Subir a 9.5' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: { grade: '9.5' } }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('sube a')));
    expect(onChanged).toHaveBeenCalled();
    // Y vuelve a pedir la lista para mostrar el grado nuevo.
    await waitFor(() => expect(mocks.adminList.mock.calls.filter((c) => c[1].premium).length).toBeGreaterThanOrEqual(2));
  });

  test('después del 10 el siguiente paso es la Black Label, y en la BL no hay más', async () => {
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '10' }));
    montar();
    expect(within(await filaDe('madKoding')).getByRole('button', { name: 'Subir a Black Label' })).toBeEnabled();
    expect(within(await filaDe('Maxima')).getByRole('button', { name: 'Grado máximo' })).toBeDisabled();
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '9', gradedAt: '2026-01-05' }));
  });

  test('avisa en la línea si ya subió este mes (y por revisar si no), pero deja subir', async () => {
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '9', gradedAt: hoyMismoMes }));
    montar();
    const f = await filaDe('madKoding');
    expect(f).toHaveTextContent('subió este mes');
    expect(within(f).getByRole('button', { name: 'Subir a 9.5' })).toBeEnabled();
    expect(await filaDe('Maxima')).toHaveTextContent('grado máximo');
    // El aviso largo está en «Más».
    expect((await abrirMas('madKoding')).getByTestId('reason')).toHaveTextContent('Ya cambió de grado este mes');
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '9', gradedAt: '2026-01-05' }));
  });

  test('una carta que no subió este mes aparece «por revisar»', async () => {
    montar();
    expect(await filaDe('madKoding')).toHaveTextContent('por revisar');
  });

  test('«Fijar grado» (en «Más») corrige a mano cualquier grado de la escala', async () => {
    montar();
    const mas = await abrirMas('madKoding');
    fireEvent.change(mas.getByLabelText('Grado de madKoding'), { target: { value: '10' } });
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: { grade: '10' } }));
  });

  test('degradar desde la fila usa el grado de deterioro elegido', async () => {
    montar();
    const mas = await abrirMas('madKoding');
    fireEvent.change(mas.getByLabelText('Grado de deterioro de madKoding'), { target: { value: '3' } });
    fireEvent.click(mas.getByRole('button', { name: 'Degradar' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: { grade: '3' } }));
  });

  test('el deterioro arranca en el grado más leve, no en la baja', async () => {
    montar();
    const mas = await abrirMas('madKoding');
    const selector = mas.getByLabelText('Grado de deterioro de madKoding') as HTMLSelectElement;
    expect(selector.value).not.toBe('1');
    fireEvent.click(mas.getByRole('button', { name: 'Degradar' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledTimes(1));
    expect(mocks.updateVtuber.mock.calls[0][2]).not.toEqual({ premium: { grade: '1' } });
  });

  test('dar de baja (grado 1) pide confirmación: la ficha deja de ser pública', async () => {
    montar();
    const mas = await abrirMas('madKoding');
    fireEvent.change(mas.getByLabelText('Grado de deterioro de madKoding'), { target: { value: '1' } });
    fireEvent.click(mas.getByRole('button', { name: 'Dar de baja (grado 1)' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    expect(mas.getByTestId('premium-confirmar-baja')).toHaveTextContent('dejará de tener página pública');
    fireEvent.click(mas.getByRole('button', { name: 'No' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    fireEvent.click(mas.getByRole('button', { name: 'Dar de baja (grado 1)' }));
    fireEvent.click(mas.getByRole('button', { name: 'Sí, dar de baja' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: { grade: '1' } }));
  });

  test('quitar el premium pide confirmación y manda null', async () => {
    montar();
    const mas = await abrirMas('madKoding');
    fireEvent.click(mas.getByRole('button', { name: 'Quitar premium' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    fireEvent.click(mas.getByRole('button', { name: 'No' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    fireEvent.click(mas.getByRole('button', { name: 'Quitar premium' }));
    fireEvent.click(mas.getByRole('button', { name: 'Sí, quitar' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: null }));
  });

  test('solo una fila tiene «Más» abierto a la vez', async () => {
    montar();
    await abrirMas('madKoding');
    await abrirMas('Maxima');
    expect(screen.getAllByTestId('premium-mas')).toHaveLength(1);
  });

  test('el alta está cerrada mientras haya cartas, y se abre con «+ Nueva premium»', async () => {
    montar();
    await screen.findAllByTestId('premium-row');
    expect(screen.queryByTestId('premium-alta')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ Nueva premium' }));
    expect(screen.getByTestId('premium-alta')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByTestId('premium-alta')).not.toBeInTheDocument();
  });

  test('da de alta una ficha con el grado inicial elegido y no ofrece las que ya son premium', async () => {
    montar();
    await abrirAlta();
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'ma' } });
    const candidatas = await screen.findByTestId('premium-candidates');
    await waitFor(() => expect(within(candidatas).getByText('Mari')).toBeInTheDocument());
    // «Madre» ya es premium: no se ofrece.
    expect(within(candidatas).queryByText('Madre')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Grado inicial'), { target: { value: '9' } });
    fireEvent.click(within(candidatas).getByRole('button', { name: 'Hacer premium' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 50, { premium: { grade: '9' } }));
  });

  test('un código VTD-… (el de la nota de PayPal) encuentra la ficha por su número de dex', async () => {
    montar();
    await abrirAlta();
    mocks.adminList.mockResolvedValue({ items: [fila(50, 'Mari', null), fila(150, 'Otra con 50 en el texto', null)], total: 2, page: 1, pageCount: 1, perPage: 20, facets: null });
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'VTD-050' } });
    const candidatas = await screen.findByTestId('premium-candidates');
    await waitFor(() => expect(within(candidatas).getByText('Mari')).toBeInTheDocument());
    // Se busca por el NÚMERO (50), no por el texto del código; y solo vale la ficha cuyo dex es EXACTAMENTE 50.
    expect(mocks.adminList.mock.calls.some((c) => c[1].q === '50')).toBe(true);
    expect(mocks.adminList.mock.calls.some((c) => c[1].q === 'VTD-050')).toBe(false);
    expect(within(candidatas).queryByText('Otra con 50 en el texto')).not.toBeInTheDocument();
  });

  test('un código de una ficha que YA es premium no se ofrece de nuevo', async () => {
    montar();
    await abrirAlta();
    mocks.adminList.mockResolvedValue({ items: [fila(17, 'madKoding', premium({ grade: '9' }))], total: 1, page: 1, pageCount: 1, perPage: 20, facets: null });
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'VTD-017' } });
    await waitFor(() => expect(mocks.adminList.mock.calls.some((c) => c[1].q === '17')).toBe(true));
    await waitFor(() => expect(screen.getByText(/Ninguna ficha sin premium coincide/)).toBeInTheDocument());
  });

  test('un código que no existe no rompe nada', async () => {
    montar();
    await abrirAlta();
    mocks.adminList.mockRejectedValue(new Error('no_encontrado'));
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'VTD-999' } });
    await waitFor(() => expect(screen.getByText(/Ninguna ficha sin premium coincide/)).toBeInTheDocument());
  });

  test('un error del servidor llega como aviso, no rompe la lista', async () => {
    mocks.updateVtuber.mockRejectedValueOnce(new Error('grado_invalido'));
    const { notify } = montar();
    fireEvent.click(within(await filaDe('madKoding')).getByRole('button', { name: 'Subir a 9.5' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('error', 'grado_invalido'));
    expect(screen.getAllByTestId('premium-row')).toHaveLength(2);
  });

  test('sin cartas premium muestra el alta abierta y explica cómo hacer la primera', async () => {
    tabla.premium.length = 0;
    montar();
    expect(await screen.findByText(/Aún no hay cartas premium/)).toBeInTheDocument();
    expect(screen.getByTestId('premium-alta')).toBeInTheDocument();
  });
});

describe('PremiumManager: filtros, orden y paginación (la lista no es una sábana)', () => {
  const fila = (id: number, name: string, p: PremiumInfo | null, extra = {}) =>
    makeCard({ id, dexNumber: id, slug: name.toLowerCase().replace(/\s/g, '-'), name, premium: p, ...extra });
  const mes = hoy();
  const base = [
    fila(1, 'Ana', premium({ grade: '6', gradedAt: '2026-01-05', cert: 'VTD-001' })),
    fila(2, 'Beto', premium({ grade: '8', gradedAt: mes, cert: 'VTD-002' })),
    fila(3, 'Carla', premium({ grade: '9.5', gradedAt: '2026-01-05', cert: 'VTD-003' })),
    fila(4, 'Diego', premium({ grade: '10', gradedAt: '2026-01-05', cert: 'VTD-004' })),
    fila(5, 'Elisa', premium({ grade: 'BL', cert: 'VTD-005' })),
    fila(6, 'Fran', premium({ grade: '3', cert: 'VTD-006' })),
  ];

  const montarCon = (filas: ReturnType<typeof fila>[], pageCount = 1) => {
    mocks.adminList.mockImplementation(async (_t: string, params: { page?: number }) => {
      const page = params.page ?? 1;
      const porPagina = Math.ceil(filas.length / pageCount);
      const items = filas.slice((page - 1) * porPagina, page * porPagina);
      return { items, total: filas.length, page, perPage: porPagina, pageCount };
    });
    render(<PremiumManager token="t" />);
  };
  afterEach(() => vi.clearAllMocks());
  const nombres = () => screen.getAllByTestId('premium-row').map((f) => within(f).getAllByText(/^[A-Z][a-z]+$/)[0].textContent);

  test('cada filtro muestra su CONTADOR y recorta la lista', async () => {
    montarCon(base);
    await screen.findAllByTestId('premium-row');
    const chip = (re: RegExp) => within(screen.getByRole('navigation', { name: 'Filtrar cartas premium' })).getByRole('button', { name: re });
    expect(chip(/^Todas/)).toHaveTextContent('6');
    expect(chip(/6 – 7,5/)).toHaveTextContent('1');
    expect(chip(/8 – 9,5/)).toHaveTextContent('2');
    expect(chip(/^10/)).toHaveTextContent('1');
    expect(chip(/Black Label/)).toHaveTextContent('1');
    expect(chip(/Deterioradas/)).toHaveTextContent('1');
    fireEvent.click(chip(/8 – 9,5/));
    expect(nombres()).toEqual(['Carla', 'Beto']);
    expect(chip(/8 – 9,5/)).toHaveAttribute('aria-pressed', 'true');
  });

  test('«Por subir este mes» deja solo a quien puede subir y aún no cambió este mes', async () => {
    montarCon(base);
    await screen.findAllByTestId('premium-row');
    // Beto ya subió este mes, Elisa está en el máximo y Fran está deteriorada: ninguno cuenta.
    const chip = within(screen.getByRole('navigation', { name: 'Filtrar cartas premium' })).getByRole('button', { name: /Por subir este mes/ });
    expect(chip).toHaveTextContent('3');
    fireEvent.click(chip);
    expect(nombres().sort()).toEqual(['Ana', 'Carla', 'Diego']);
    expect(screen.getByText(/3 cartas pendientes de revisar este mes/)).toBeInTheDocument();
  });

  test('la búsqueda en la lista encuentra por nombre sin tildes, por número y por certificado', async () => {
    montarCon([...base, fila(7, 'Papá Noel', premium({ grade: '8', cert: 'VTD-007' }))]);
    await screen.findAllByTestId('premium-row');
    const caja = screen.getByLabelText('Buscar en la lista de premium');
    fireEvent.change(caja, { target: { value: 'papa' } });
    expect(screen.getAllByTestId('premium-row')).toHaveLength(1);
    fireEvent.change(caja, { target: { value: '#003' } });
    expect(nombres()).toEqual(['Carla']);
    fireEvent.change(caja, { target: { value: 'VTD-005' } });
    expect(nombres()).toEqual(['Elisa']);
  });

  test('si nada coincide lo dice y ofrece quitar los filtros', async () => {
    montarCon(base);
    await screen.findAllByTestId('premium-row');
    fireEvent.change(screen.getByLabelText('Buscar en la lista de premium'), { target: { value: 'zzzz' } });
    expect(screen.getByTestId('premium-sin-resultados')).toHaveTextContent('Ninguna carta coincide');
    fireEvent.click(screen.getByRole('button', { name: 'Quitar filtros' }));
    expect(screen.getAllByTestId('premium-row')).toHaveLength(6);
  });

  test('ordena por grado (por defecto mayor primero), por nombre y por último cambio más antiguo', async () => {
    montarCon(base);
    await screen.findAllByTestId('premium-row');
    expect(nombres()).toEqual(['Elisa', 'Diego', 'Carla', 'Beto', 'Ana', 'Fran']);
    fireEvent.change(screen.getByLabelText('Ordenar'), { target: { value: 'grado-asc' } });
    expect(nombres()[0]).toBe('Fran');
    fireEvent.change(screen.getByLabelText('Ordenar'), { target: { value: 'nombre' } });
    expect(nombres()).toEqual(['Ana', 'Beto', 'Carla', 'Diego', 'Elisa', 'Fran']);
  });

  test('pagina de 20 en 20: con 45 cartas hay 3 páginas y no se pinta una sábana', async () => {
    const muchas = Array.from({ length: 45 }, (_, i) => fila(i + 1, `Carta${String(i + 1).padStart(2, '0')}`, premium({ grade: '8', cert: `VTD-${i + 1}` })));
    montarCon(muchas);
    await screen.findAllByTestId('premium-row');
    expect(screen.getAllByTestId('premium-row')).toHaveLength(20);
    expect(screen.getByTestId('premium-paginacion')).toHaveTextContent('Mostrando 1–20 de 45');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente ›' }));
    expect(screen.getByTestId('premium-paginacion')).toHaveTextContent('Mostrando 21–40 de 45');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente ›' }));
    expect(screen.getAllByTestId('premium-row')).toHaveLength(5);
    expect(screen.getByRole('button', { name: 'Siguiente ›' })).toBeDisabled();
  });

  test('al cambiar de filtro vuelve a la primera página', async () => {
    const muchas = Array.from({ length: 45 }, (_, i) => fila(i + 1, `Carta${String(i + 1).padStart(2, '0')}`, premium({ grade: i < 30 ? '8' : '10', cert: `VTD-${i + 1}` })));
    montarCon(muchas);
    await screen.findAllByTestId('premium-row');
    fireEvent.click(screen.getByRole('button', { name: 'Siguiente ›' }));
    expect(screen.getByTestId('premium-paginacion')).toHaveTextContent('21–40');
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Filtrar cartas premium' })).getByRole('button', { name: /^10/ }));
    expect(screen.getByTestId('premium-paginacion')).toHaveTextContent('Mostrando 1–15 de 15');
  });

  test('trae TODAS las páginas de la API (antes se cortaba en 100 sin avisar)', async () => {
    const muchas = Array.from({ length: 6 }, (_, i) => fila(i + 1, `Carta${i + 1}`, premium({ grade: '8', cert: `VTD-${i + 1}` })));
    montarCon(muchas, 2);
    await screen.findAllByTestId('premium-row');
    expect(screen.getAllByTestId('premium-row')).toHaveLength(6);
    expect(mocks.adminList.mock.calls.filter((c) => c[1].premium).map((c) => c[1].page)).toEqual([1, 2]);
  });
});

describe('holografía reforzada por grado', () => {
  test('una carta normal no cambia: todo en 1', () => {
    expect(refuerzoDeGrado(null)).toEqual(SIN_REFUERZO);
    expect(refuerzoDeGrado(undefined)).toEqual(SIN_REFUERZO);
  });

  test('toda carta gradeada refuerza, y sube con el grado hasta la Black Label', () => {
    const factores = GRADOS.map((grado) => factorDeGrado(grado));
    expect(factores[0]).toBeGreaterThan(1);
    factores.slice(1).forEach((factor, i) => expect(factor, GRADOS[i + 1]).toBeGreaterThan(factores[i]));
    expect(refuerzoDeGrado('BL').layerWeight).toBeGreaterThanOrEqual(refuerzoDeGrado('10').layerWeight);
  });

  test('ninguna perilla pasa su techo y la tinta sube menos que el arcoíris (no lava la carta)', () => {
    for (const grado of GRADOS) {
      const refuerzo = refuerzoDeGrado(grado);
      for (const clave of Object.keys(PREMIUM.boost.techo) as Array<keyof typeof refuerzo>) {
        expect(refuerzo[clave], `${grado}.${clave}`).toBeLessThanOrEqual(PREMIUM.boost.techo[clave]);
      }
      expect(refuerzo.edge).toBeLessThan(refuerzo.layerWeight);
    }
  });
});

describe('racha', () => {
  it('textoDeRacha muestra los meses seguidos y se apaga si se rompió', async () => {
    const { textoDeRacha } = await import('@/lib/premium');
    expect(textoDeRacha({ grade: '9', since: '2026-07-10', gradedAt: '2026-09-12' }, '2026-09-20')).toBe('3 meses seguidos');
    expect(textoDeRacha({ grade: '9', since: '2026-05-10', gradedAt: '2026-07-12' }, '2026-10-04')).toBeNull();
  });
});
