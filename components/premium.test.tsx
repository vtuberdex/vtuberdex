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
      fila(40, 'Maxima', premium({ grade: 'BL', cert: 'VTD-000040' }), { status: 'draft' }),
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

  test('lista las cartas premium con su grado, certificado y antigüedad', async () => {
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    expect(filas).toHaveLength(2);
    expect(mocks.adminList.mock.calls[0][1]).toMatchObject({ premium: true });
    expect(within(filas[0]).getByTestId('premium-badge')).toHaveTextContent('MINT 9');
    expect(filas[0]).toHaveTextContent('VTD-000017');
    expect(filas[0]).toHaveTextContent('premium desde 2026-05-01');
    // Una carta en borrador avisa de que el público no la ve.
    expect(filas[1]).toHaveTextContent('borrador');
  });

  test('«Subir a …» manda el grado siguiente de la escala', async () => {
    const { notify, onChanged } = montar();
    const filas = await screen.findAllByTestId('premium-row');
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'Subir a 9.5' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: { grade: '9.5' } }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('ok', expect.stringContaining('sube a')));
    expect(onChanged).toHaveBeenCalled();
    // Y vuelve a pedir la lista para mostrar el grado nuevo.
    await waitFor(() => expect(mocks.adminList.mock.calls.filter((c) => c[1].premium).length).toBeGreaterThanOrEqual(2));
  });

  test('después del 10 el siguiente paso es la Black Label, y en la BL no hay más', async () => {
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '10' }));
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    expect(within(filas[0]).getByRole('button', { name: 'Subir a Black Label' })).toBeEnabled();
    expect(within(filas[1]).getByRole('button', { name: 'Grado máximo' })).toBeDisabled();
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '9', gradedAt: '2026-01-05' }));
  });

  test('avisa si el grado ya cambió este mes, pero deja subir', async () => {
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '9', gradedAt: hoyMismoMes }));
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    expect(within(filas[0]).getByTestId('reason')).toHaveTextContent('Ya cambió de grado este mes');
    expect(within(filas[0]).getByRole('button', { name: 'Subir a 9.5' })).toBeEnabled();
    expect(within(filas[1]).queryByTestId('reason')).not.toBeInTheDocument();
    tabla.premium[0] = fila(17, 'madKoding', premium({ grade: '9', gradedAt: '2026-01-05' }));
  });

  test('«Fijar grado» corrige a mano cualquier grado de la escala', async () => {
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    fireEvent.change(within(filas[0]).getByLabelText('Grado de madKoding'), { target: { value: '10' } });
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: { grade: '10' } }));
  });

  test('quitar el premium pide confirmación y manda null', async () => {
    montar();
    const filas = await screen.findAllByTestId('premium-row');
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'Quitar premium' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'No' }));
    expect(mocks.updateVtuber).not.toHaveBeenCalled();
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'Quitar premium' }));
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'Sí, quitar' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 17, { premium: null }));
  });

  test('da de alta una ficha con el grado inicial elegido y no ofrece las que ya son premium', async () => {
    montar();
    await screen.findAllByTestId('premium-row');
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'ma' } });
    const candidatas = await screen.findByTestId('premium-candidates');
    await waitFor(() => expect(within(candidatas).getByText('Mari')).toBeInTheDocument());
    // «Madre» ya es premium: no se ofrece.
    expect(within(candidatas).queryByText('Madre')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Grado inicial'), { target: { value: '9' } });
    fireEvent.click(within(candidatas).getByRole('button', { name: 'Hacer premium' }));
    await waitFor(() => expect(mocks.updateVtuber).toHaveBeenCalledWith('t', 50, { premium: { grade: '9' } }));
  });

  test('un código VTD-… (el de la nota de PayPal) encuentra la ficha por id', async () => {
    mocks.adminDetail.mockResolvedValue(fila(50, 'Mari', null));
    montar();
    await screen.findAllByTestId('premium-row');
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'VTD-000050' } });
    const candidatas = await screen.findByTestId('premium-candidates');
    await waitFor(() => expect(within(candidatas).getByText('Mari')).toBeInTheDocument());
    expect(mocks.adminDetail).toHaveBeenCalledWith('t', 50);
    // No se pregunta por texto: el código no está en el nombre.
    expect(mocks.adminList.mock.calls.some((c) => c[1].q === 'VTD-000050')).toBe(false);
  });

  test('un código de una ficha que YA es premium no se ofrece de nuevo', async () => {
    mocks.adminDetail.mockResolvedValue(fila(17, 'madKoding', premium({ grade: '9' })));
    montar();
    await screen.findAllByTestId('premium-row');
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'VTD-000017' } });
    await waitFor(() => expect(mocks.adminDetail).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Ninguna ficha sin premium coincide/)).toBeInTheDocument());
  });

  test('un código que no existe no rompe nada', async () => {
    mocks.adminDetail.mockRejectedValue(new Error('no_encontrado'));
    montar();
    await screen.findAllByTestId('premium-row');
    fireEvent.change(screen.getByLabelText('Buscar ficha para hacerla premium'), { target: { value: 'VTD-999999' } });
    await waitFor(() => expect(screen.getByText(/Ninguna ficha sin premium coincide/)).toBeInTheDocument());
  });

  test('un error del servidor llega como aviso, no rompe la lista', async () => {
    mocks.updateVtuber.mockRejectedValueOnce(new Error('grado_invalido'));
    const { notify } = montar();
    const filas = await screen.findAllByTestId('premium-row');
    fireEvent.click(within(filas[0]).getByRole('button', { name: 'Subir a 9.5' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('error', 'grado_invalido'));
    expect(screen.getAllByTestId('premium-row')).toHaveLength(2);
  });

  test('sin cartas premium explica cómo hacer la primera', async () => {
    tabla.premium.length = 0;
    montar();
    expect(await screen.findByText(/Aún no hay cartas premium/)).toBeInTheDocument();
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
