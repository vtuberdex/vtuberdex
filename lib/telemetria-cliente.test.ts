import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { categoriaDeRuta, clasificarGpu, fichaDeRuta, idDeSesion, iniciarTelemetria, medianaDe, seDebeMedir } from './telemetria-cliente';

afterEach(() => vi.restoreAllMocks());

describe('categoriaDeRuta', () => {
  it('clasifica por categoría', () => {
    expect(categoriaDeRuta('/')).toBe('catalogo');
    expect(categoriaDeRuta('/v/madkoding')).toBe('ficha');
    expect(categoriaDeRuta('/v/madkoding/')).toBe('ficha');
    for (const otra of ['/admin', '/inscripcion', '/v', '/v/a/b', '/baja']) expect(categoriaDeRuta(otra), otra).toBe('otra');
  });
  it('el resultado es solo la categoría, nunca el slug', () => {
    expect(categoriaDeRuta('/v/una-ficha-privada')).not.toContain('privada');
  });
});

describe('fichaDeRuta', () => {
  it('saca el slug de una página de ficha y nada más', () => {
    expect(fichaDeRuta('/v/madkoding')).toBe('madkoding');
    expect(fichaDeRuta('/v/madkoding/')).toBe('madkoding');
    for (const otra of ['/', '/v', '/v/', '/v/a/b', '/inscripcion', '/admin', '/api/vtubers/x']) expect(fichaDeRuta(otra), otra).toBeNull();
  });
  it('decodifica, acota el largo y no se rompe con un % mal formado', () => {
    expect(fichaDeRuta('/v/ni%C3%B1a')).toBe('niña');
    expect(fichaDeRuta('/v/' + 'a'.repeat(500))!.length).toBe(120);
    expect(fichaDeRuta('/v/%E0%A4%A')).toBeNull();
  });
});

describe('seDebeMedir: respeta «No rastrear» y Global Privacy Control', () => {
  it('mide por defecto', () => expect(seDebeMedir({ doNotTrack: null })).toBe(true));
  it('no mide con DNT', () => expect(seDebeMedir({ doNotTrack: '1' })).toBe(false));
  it('no mide con GPC', () => expect(seDebeMedir({ globalPrivacyControl: true })).toBe(false));
});

describe('piezas puras', () => {
  it('clasificarGpu distingue el rasterizador por CPU', () => {
    expect(clasificarGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))')).toBe('software');
    expect(clasificarGpu('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe('software');
    expect(clasificarGpu('Microsoft Basic Render Driver')).toBe('software');
    expect(clasificarGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11)')).toBe('hardware');
    expect(clasificarGpu(null)).toBe('desconocida');
    expect(clasificarGpu('')).toBe('desconocida');
  });
  it('medianaDe', () => {
    expect(medianaDe([])).toBeNull();
    expect(medianaDe([5])).toBe(5);
    expect(medianaDe([3, 1, 2])).toBe(2);
    expect(medianaDe([4, 1, 3, 2])).toBe(2.5);
  });
  it('idDeSesion: aleatorio, solo caracteres seguros y cumple lo que valida el servidor', () => {
    const a = idDeSesion();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    expect(idDeSesion()).not.toBe(a);
  });
});

describe('iniciarTelemetria', () => {
  const beacon = vi.fn();
  const enviados = () => beacon.mock.calls.map(([, blob]) => blob as Blob);
  // `Blob.text()` no existe en jsdom: se lee con FileReader.
  const leer = (b: Blob) =>
    new Promise<string>((resolver) => {
      const lector = new FileReader();
      lector.onload = () => resolver(String(lector.result));
      lector.readAsText(b);
    });
  const cuerpos = async () => Promise.all(enviados().map(async (b) => JSON.parse(await leer(b))));

  beforeEach(() => {
    beacon.mockReset().mockReturnValue(true);
    Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
    Object.defineProperty(navigator, 'doNotTrack', { value: null, configurable: true });
    window.history.pushState({}, '', '/');
  });
  afterEach(() => vi.useRealTimers());

  it('con «No rastrear» no hace nada: ni envíos, ni temporizadores, ni navegación', () => {
    Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true });
    const intervalo = vi.spyOn(window, 'setInterval');
    const t = iniciarTelemetria();
    t.navegar();
    t.detener();
    expect(intervalo).not.toHaveBeenCalled();
    expect(beacon).not.toHaveBeenCalled();
  });

  it('al cargar avisa DE INMEDIATO con la página, el dispositivo y la conexión (no espera al primer latido)', async () => {
    const t = iniciarTelemetria();
    const [primero] = await cuerpos();
    expect(primero).toMatchObject({ nav: true, ruta: 'catalogo', disp: 'escritorio' });
    expect(primero.sid).toMatch(/^[A-Za-z0-9_-]{8,40}$/);
    expect(Object.keys(primero).sort()).toEqual(expect.arrayContaining(['disp', 'nav', 'ruta', 'sid', 'vis']));
    // Mínimo: nada de métricas ni nada que identifique.
    expect(Object.keys(primero)).not.toEqual(expect.arrayContaining(['lcp', 'fps', 'lt']));
    t.detener();
  });

  it('navegar() avisa de un cambio de página y NO repite si no cambió nada', async () => {
    const t = iniciarTelemetria();
    expect(beacon).toHaveBeenCalledTimes(1);
    t.navegar(); // sigue en el catálogo
    expect(beacon).toHaveBeenCalledTimes(1);
    window.history.pushState({}, '', '/v/una-ficha');
    t.navegar();
    expect(beacon).toHaveBeenCalledTimes(2);
    const [, segundo] = await cuerpos();
    expect(segundo).toMatchObject({ nav: true, ruta: 'ficha', ficha: 'una-ficha' });
    t.navegar(); // la misma ficha otra vez: nada nuevo
    expect(beacon).toHaveBeenCalledTimes(2);
    window.history.pushState({}, '', '/inscripcion');
    t.navegar();
    const ultimo = (await cuerpos()).at(-1);
    expect(ultimo).toMatchObject({ ruta: 'otra' });
    expect(ultimo).not.toHaveProperty('ficha'); // el slug solo viaja en una ficha
    t.detener();
  });

  it('pasar de una ficha a OTRA ficha también se avisa: es una vista nueva de esa otra ficha', async () => {
    window.history.pushState({}, '', '/v/ana');
    const t = iniciarTelemetria();
    window.history.pushState({}, '', '/v/bea');
    t.navegar();
    expect((await cuerpos()).map((c) => c.ficha)).toEqual(['ana', 'bea']);
    t.detener();
  });

  it('detener() limpia lo que arrancó', () => {
    vi.useFakeTimers();
    const limpiar = vi.spyOn(window, 'clearInterval');
    iniciarTelemetria().detener();
    expect(limpiar).toHaveBeenCalled();
  });
});
