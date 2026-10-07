/**
 * Latido anónimo de rendimiento del navegador hacia `/api/stats` (ver `lib/clientes-stats.mjs`).
 *
 * LO QUE SE MIDE usa APIs del navegador que ya miden por su cuenta (Navigation Timing, LCP, Long Tasks y las
 * marcas `textura-*` que la fábrica de texturas ya emite): casi no cuesta CPU. La única medición activa es
 * un conteo de 1 s de `requestAnimationFrame` cada ~minuto y solo con la pestaña visible (fluidez).
 *
 * LO QUE NO SE ENVÍA: IP, cookies, el user-agent (el servidor lo lee del encabezado y lo reduce a una familia), ni nada que
 * identifique a una persona. De la ruta solo viaja la categoría y, en una ficha, su slug (para contar qué fichas se
 * ven). El id de sesión es aleatorio, vive en memoria y cambia en cada carga de página.
 * Respeta «No rastrear» (DNT) y «Global Privacy Control».
 */

export const INTERVALO_MS = 20_000;
const CADA_N_LATIDOS_FPS = 3;

export type Ruta = 'catalogo' | 'ficha' | 'otra';

/** La ruta como CATEGORÍA. */
export function categoriaDeRuta(pathname: string): Ruta {
  if (pathname === '/') return 'catalogo';
  if (/^\/v\/[^/]+\/?$/.test(pathname)) return 'ficha';
  return 'otra';
}

/**
 * El slug de la ficha que se está viendo (`/v/madkoding` → `madkoding`), o `null` fuera de una ficha.
 * Se manda solo para que el SERVIDOR cuente qué fichas se ven: él lo valida contra el catálogo, lo convierte en el id de
 * una ficha pública y descarta el texto (ver `lib/ficha-id.mjs`). Es lo mismo que ya ve el registro de acceso del servidor.
 */
export function fichaDeRuta(pathname: string): string | null {
  const m = /^\/v\/([^/]+)\/?$/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]).slice(0, 120);
  } catch {
    return null;
  }
}

export function seDebeMedir(nav: { doNotTrack?: string | null; globalPrivacyControl?: boolean } = navigator as never): boolean {
  return nav.doNotTrack !== '1' && nav.globalPrivacyControl !== true;
}

export function idDeSesion(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function medianaDe(valores: number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** `software` si el renderizador es un rasterizador por CPU (SwiftShader, llvmpipe…): explica un 3D lento. */
export function clasificarGpu(renderer: string | null | undefined): 'hardware' | 'software' | 'desconocida' {
  if (!renderer) return 'desconocida';
  return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|lavapipe/i.test(renderer) ? 'software' : 'hardware';
}

function detectarGpu(): 'hardware' | 'software' | 'desconocida' {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') as WebGLRenderingContext | null;
    if (!gl) return 'desconocida';
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // no ocupa uno de los ~16 contextos del navegador
    return clasificarGpu(renderer);
  } catch {
    return 'desconocida';
  }
}

function medirFps(): Promise<number | null> {
  return new Promise((resolver) => {
    let cuadros = 0;
    const inicio = performance.now();
    const paso = (ahora: number) => {
      cuadros += 1;
      if (ahora - inicio >= 1000) resolver(Math.round((cuadros * 1000) / (ahora - inicio)));
      else requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
    setTimeout(() => resolver(null), 2500); // pestaña en segundo plano: rAF no corre y no se espera
  });
}

type Conexion = { effectiveType?: string; rtt?: number };

export interface Telemetria {
  detener: () => void;
  /** Avisa de un cambio de página (navegación dentro de la app). Si la categoría no cambió, no hace nada. */
  navegar: () => void;
}

const SIN_TELEMETRIA: Telemetria = { detener: () => undefined, navegar: () => undefined };

export function iniciarTelemetria(): Telemetria {
  if (typeof window === 'undefined' || !seDebeMedir()) return SIN_TELEMETRIA;

  const sid = idDeSesion();
  let largas = { n: 0, ms: 0 };
  let lcp: number | null = null;
  let gpu: 'hardware' | 'software' | 'desconocida' | null = null;
  let latidos = 0;
  let marcasVistas = 0;
  const observadores: PerformanceObserver[] = [];

  const observar = (tipo: string, alEntrada: (e: PerformanceEntry) => void) => {
    try {
      const o = new PerformanceObserver((lista) => lista.getEntries().forEach(alEntrada));
      o.observe({ type: tipo, buffered: true });
      observadores.push(o);
    } catch {
      /* el navegador no soporta ese tipo: simplemente no se mide */
    }
  };
  observar('longtask', (e) => {
    largas = { n: largas.n + 1, ms: largas.ms + e.duration };
  });
  observar('largest-contentful-paint', (e) => {
    lcp = e.startTime;
  });

  const nav = () => performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;

  const construir = async (extra: Record<string, unknown> = {}) => {
    const visible = document.visibilityState === 'visible';
    latidos += 1;
    const fps = visible && latidos % CADA_N_LATIDOS_FPS === 1 ? await medirFps() : null;
    const marcas = performance.getEntriesByType('measure').filter((m) => m.name.startsWith('textura-completa-cpu:'));
    const tex = medianaDe(marcas.slice(marcasVistas).map((m) => m.duration));
    marcasVistas = marcas.length;
    const conexion = (navigator as Navigator & { connection?: Conexion }).connection;
    const cuerpo = {
      sid,
      vis: visible,
      ruta: categoriaDeRuta(location.pathname),
      ficha: fichaDeRuta(location.pathname) ?? undefined,
      disp: dispositivo(),
      gpu: gpu ?? undefined,
      nuc: navigator.hardwareConcurrency,
      mem: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
      dpr: devicePixelRatio,
      red: conexionActual(),
      rtt: conexion?.rtt,
      ttfb: nav()?.responseStart,
      lcp: lcp ?? undefined,
      fps: fps ?? undefined,
      tex: tex ?? undefined,
      lt: { n: largas.n, ms: Math.round(largas.ms) },
      ...extra,
    };
    largas = { n: 0, ms: 0 }; // cada latido informa SOLO su ventana
    return cuerpo;
  };

  const enviar = (cuerpo: Record<string, unknown>) => {
    const texto = JSON.stringify(cuerpo);
    try {
      if (!navigator.sendBeacon('/api/stats', new Blob([texto], { type: 'text/plain' }))) throw new Error('beacon');
    } catch {
      void fetch('/api/stats', { method: 'POST', body: texto, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => undefined);
    }
  };

  const dispositivo = () => (window.matchMedia?.('(pointer: coarse)').matches && innerWidth < 900 ? 'movil' : 'escritorio');
  const conexionActual = () => (navigator as Navigator & { connection?: Conexion }).connection?.effectiveType;

  /**
   * Aviso MÍNIMO de navegación: crea la sesión (la primera vez) o registra el cambio de página. Lleva dispositivo y
   * conexión porque el histórico mensual cuenta cada visita por ambos, y no puede esperar al primer latido completo
   * (a los 3 s, ya con LCP): una navegación rápida se perdería. No mide nada ni toca la ventana de tareas largas.
   */
  let ultimaClave: string | null = null;
  const claveDeRuta = () => `${categoriaDeRuta(location.pathname)}:${fichaDeRuta(location.pathname) ?? ''}`;
  const avisarRuta = () => {
    // Se avisa si cambió la categoría O la ficha: pasar de una ficha a otra es una vista nueva de esa otra ficha.
    const clave = claveDeRuta();
    if (clave === ultimaClave) return;
    ultimaClave = clave;
    const ruta = categoriaDeRuta(location.pathname);
    enviar({
      sid,
      nav: true,
      vis: document.visibilityState === 'visible',
      ruta,
      ficha: ruta === 'ficha' ? (fichaDeRuta(location.pathname) ?? undefined) : undefined,
      disp: dispositivo(),
      red: conexionActual(),
    });
  };
  avisarRuta();

  const latir = async () => {
    ultimaClave = claveDeRuta(); // el latido ya lleva la ruta actual
    enviar(await construir());
  };
  const alOcultar = () => {
    if (document.visibilityState === 'hidden') void construir().then(enviar);
  };
  const alSalir = () => enviar({ sid, bye: true });

  // Primer latido a los 3 s (ya hay TTFB y casi siempre LCP); la GPU se mira una vez, en reposo.
  const inicial = window.setTimeout(() => {
    gpu = detectarGpu();
    void latir();
  }, 3000);
  const reloj = window.setInterval(() => {
    if (document.visibilityState === 'visible') void latir();
  }, INTERVALO_MS);
  document.addEventListener('visibilitychange', alOcultar);
  window.addEventListener('pagehide', alSalir);

  return {
    navegar: avisarRuta,
    detener: () => {
      clearTimeout(inicial);
      clearInterval(reloj);
      document.removeEventListener('visibilitychange', alOcultar);
      window.removeEventListener('pagehide', alSalir);
      observadores.forEach((o) => o.disconnect());
    },
  };
}
