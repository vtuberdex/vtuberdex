/**
 * Visitantes conectados y su rendimiento: agregados ANÓNIMOS en memoria.
 *
 * QUÉ ES: cada pestaña abierta manda un latido cada ~20 s (`components/cliente-stats.tsx`) con
 * métricas de rendimiento. Aquí se guardan por sesión (un id aleatorio por carga de página, que
 * nunca se persiste ni se relaciona con una persona) y `resumen()` devuelve solo agregados para el
 * panel de estado del servidor (`/srv/estado`).
 *
 * PRIVACIDAD, por construcción:
 *   · No se lee ni se guarda la IP, ni cookies, ni el user-agent, ni la ruta exacta (nunca un slug: solo
 *     'catalogo' | 'ficha' | 'otra').
 *   · Todo valor se valida y se acota: un cliente hostil no puede inyectar texto al panel.
 *   · Vive en memoria y se pierde al reiniciar. Nada va a disco ni a la base.
 *
 * LÍMITES contra abuso (no hay IP con la que limitar): como máximo `MAX_SESIONES` sesiones vivas
 * (se desaloja la más vieja), un latido por sesión cada `MIN_ENTRE_LATIDOS_MS`, y TTL corto.
 *
 * El estado cuelga de `globalThis`: Next compila cada ruta como una entrada distinta y un `let` de
 * módulo podría duplicarse entre la ruta que RECIBE los latidos y la que entrega el resumen.
 */

import { contarFicha, contarPagina, contarPico, contarVisita } from './clientes-historial.mjs';
import { NAVEGADORES, SISTEMAS } from './user-agent.mjs';

export const TTL_MS = 45_000;
export const MAX_SESIONES = 5000;
export const MIN_ENTRE_LATIDOS_MS = 5_000;
/** Un aviso de NAVEGACIÓN (cambio de página) puede llegar enseguida, pero no a ráfagas: así no infla las vistas. */
export const MIN_ENTRE_NAVEGACIONES_MS = 2_000;
export const MINUTOS_HISTORIAL = 60;
const RETENCION_MS = 10 * 60_000;

const RUTAS = new Set(['catalogo', 'ficha', 'otra']);
const DISPOSITIVOS = new Set(['movil', 'escritorio']);
const GPUS = new Set(['hardware', 'software', 'desconocida']);
const REDES = new Set(['slow-2g', '2g', '3g', '4g', 'desconocida']);
const NAVEGADORES_OK = new Set(NAVEGADORES);
const SISTEMAS_OK = new Set(SISTEMAS);
/** Sesiones NUEVAS aceptadas por minuto, en total: sin IP con la que limitar, esto acota que un script infle las visitas. */
export const MAX_NUEVAS_POR_MINUTO = 600;

const CLAVE = Symbol.for('vtuberdex.clientes-stats');
function estado() {
  const g = globalThis;
  if (!g[CLAVE]) g[CLAVE] = { sesiones: new Map(), picos: new Map(), dia: '', visitasHoy: 0, ultimaLimpieza: 0, nuevas: { minuto: 0, n: 0 } };
  return g[CLAVE];
}

/** Para los tests: cuántas sesiones hay guardadas (vivas o no). */
export function __sesionesGuardadas() {
  return estado().sesiones.size;
}

/** Para los tests: olvida todo. */
export function __reiniciar() {
  delete globalThis[CLAVE];
}

function numero(valor, min, max) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null;
}
function opcion(valor, permitidos, porDefecto) {
  return typeof valor === 'string' && permitidos.has(valor) ? valor : porDefecto;
}
/** Como `opcion`, pero un dato AUSENTE es `null` (no se conocía): no debe pisar lo que una sesión ya informó. */
function opcionOpcional(valor, permitidos, invalido) {
  return valor === undefined || valor === null ? null : opcion(valor, permitidos, invalido);
}

/** Valida y acota un latido. Devuelve `null` si no se puede aceptar. */
export function limpiarLatido(crudo) {
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return null;
  if (typeof crudo.sid !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(crudo.sid)) return null;
  const lt = crudo.lt && typeof crudo.lt === 'object' ? crudo.lt : {};
  return {
    sid: crudo.sid,
    bye: crudo.bye === true,
    nav: crudo.nav === true,
    vis: crudo.vis !== false,
    ruta: opcion(crudo.ruta, RUTAS, 'otra'),
    disp: opcion(crudo.disp, DISPOSITIVOS, 'escritorio'),
    gpu: opcionOpcional(crudo.gpu, GPUS, 'desconocida'),
    red: opcionOpcional(crudo.red, REDES, 'desconocida'),
    // El servidor los pone a partir del User-Agent de la petición (ver la ruta); el cliente no decide qué navegador es.
    navegador: opcionOpcional(crudo.navegador, NAVEGADORES_OK, 'otros'),
    so: opcionOpcional(crudo.so, SISTEMAS_OK, 'otros'),
    // ID de una ficha PÚBLICA ya validada por el servidor (`ficha-id.mjs`); nunca el slug que mandó el cliente.
    fichaId: Number.isInteger(crudo.fichaId) && crudo.fichaId > 0 && crudo.fichaId < 1e9 ? crudo.fichaId : null,
    nuc: numero(crudo.nuc, 1, 256),
    mem: numero(crudo.mem, 0.25, 128),
    dpr: numero(crudo.dpr, 0.5, 8),
    rtt: numero(crudo.rtt, 0, 30_000),
    ttfb: numero(crudo.ttfb, 0, 120_000),
    lcp: numero(crudo.lcp, 0, 300_000),
    fps: numero(crudo.fps, 0, 480),
    tex: numero(crudo.tex, 0, 120_000),
    ltN: numero(lt.n, 0, 100_000),
    ltMs: numero(lt.ms, 0, 3_600_000),
  };
}

function diaDe(ahora) {
  return new Date(ahora).toISOString().slice(0, 10);
}

function limpiar(e, ahora) {
  if (ahora - e.ultimaLimpieza < 30_000) return;
  e.ultimaLimpieza = ahora;
  for (const [sid, s] of e.sesiones) if (ahora - s.visto > RETENCION_MS) e.sesiones.delete(sid);
  const corte = Math.floor(ahora / 60_000) - MINUTOS_HISTORIAL;
  for (const minuto of e.picos.keys()) if (minuto < corte) e.picos.delete(minuto);
}

function conectadas(e, ahora) {
  let n = 0;
  for (const s of e.sesiones.values()) if (ahora - s.visto <= TTL_MS) n += 1;
  return n;
}

/** @returns {'ok' | 'invalido' | 'demasiado_rapido'} */
export function registrar(crudo, ahora = Date.now()) {
  const latido = limpiarLatido(crudo);
  if (!latido) return 'invalido';
  const e = estado();
  limpiar(e, ahora);

  const dia = diaDe(ahora);
  if (e.dia !== dia) {
    e.dia = dia;
    e.visitasHoy = 0;
  }

  const previa = e.sesiones.get(latido.sid);
  if (latido.bye) {
    e.sesiones.delete(latido.sid);
    return 'ok';
  }
  // Dos cadencias independientes: el latido normal (cada ~20 s) y el aviso de navegación (al cambiar de página).
  if (previa) {
    const desde = latido.nav ? (previa.ultimoNav ?? 0) : (previa.ultimoLatido ?? 0);
    if (ahora - desde < (latido.nav ? MIN_ENTRE_NAVEGACIONES_MS : MIN_ENTRE_LATIDOS_MS)) return 'demasiado_rapido';
  }

  if (!previa) {
    const minutoNuevo = Math.floor(ahora / 60_000);
    if (e.nuevas.minuto !== minutoNuevo) e.nuevas = { minuto: minutoNuevo, n: 0 };
    if (e.nuevas.n >= MAX_NUEVAS_POR_MINUTO) return 'demasiado_rapido';
    e.nuevas.n += 1;
    e.visitasHoy += 1;
    if (e.sesiones.size >= MAX_SESIONES) {
      // Tope contra abuso: se desaloja la sesión más vieja (Map conserva el orden de inserción).
      e.sesiones.delete(e.sesiones.keys().next().value);
    }
  } else {
    e.sesiones.delete(latido.sid); // se reinserta al final: así el orden de inserción es el de último latido
  }
  // Las métricas que esta pestaña no midió en ESTE latido conservan su último valor conocido.
  const base = previa ?? {};
  const fusion = { ...base };
  for (const [k, v] of Object.entries(latido)) if (v !== null && v !== undefined && k !== 'nav') fusion[k] = v;
  // La ficha que se ve AHORA: solo en una página de ficha. Al volver al catálogo se olvida (no se arrastra la anterior).
  fusion.fichaId = latido.ruta === 'ficha' ? latido.fichaId : null;
  e.sesiones.set(latido.sid, {
    ...fusion,
    visto: ahora,
    ultimoLatido: latido.nav ? base.ultimoLatido : ahora,
    ultimoNav: latido.nav ? ahora : base.ultimoNav,
  });

  // HISTÓRICO MENSUAL: una sesión nueva es una visita; cada cambio de página (o la primera) es una página vista.
  if (!previa) contarVisita({ disp: latido.disp, red: latido.red, navegador: latido.navegador, so: latido.so }, ahora);
  if (!previa || latido.ruta !== previa.ruta) contarPagina({ disp: latido.disp, ruta: latido.ruta }, ahora);
  // Cada ficha distinta que se abre cuenta una vez (no cada latido de 20 s mientras se la mira).
  if (latido.fichaId && latido.fichaId !== previa?.fichaId) contarFicha(latido.fichaId, ahora);

  const minuto = Math.floor(ahora / 60_000);
  const ahoraN = conectadas(e, ahora);
  if (ahoraN > (e.picos.get(minuto) ?? 0)) e.picos.set(minuto, ahoraN);
  contarPico(ahoraN, ahora);
  return 'ok';
}

function mediana(valores) {
  const v = valores.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function percentil(valores, p) {
  const v = valores.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)];
}
function contar(lista, clave) {
  const r = {};
  for (const s of lista) {
    const k = s[clave] ?? 'desconocida';
    r[k] = (r[k] ?? 0) + 1;
  }
  return r;
}
function fichasAhora(vivas) {
  const por = new Map();
  for (const s of vivas) if (s.fichaId) por.set(s.fichaId, (por.get(s.fichaId) ?? 0) + 1);
  return [...por].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 5).map(([id, n]) => ({ id, n }));
}
const redondear = (n, d = 0) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d);

/** Agregados para el panel. Nunca devuelve una sesión individual. */
export function resumen(ahora = Date.now()) {
  const e = estado();
  limpiar(e, ahora);
  const vivas = [...e.sesiones.values()].filter((s) => ahora - s.visto <= TTL_MS);
  const visibles = vivas.filter((s) => s.vis);

  const minutoActual = Math.floor(ahora / 60_000);
  const historial = [];
  for (let i = MINUTOS_HISTORIAL - 1; i >= 0; i -= 1) historial.push(e.picos.get(minutoActual - i) ?? 0);

  // El dato más reciente de cada sesión; el bloqueo se expresa por minuto (un latido cubre ~20 s).
  const sw = vivas.filter((s) => s.gpu === 'software').length;
  const conGpu = vivas.filter((s) => s.gpu && s.gpu !== 'desconocida').length;
  return {
    ts: Math.floor(ahora / 1000),
    conectados: vivas.length,
    visibles: visibles.length,
    visitas_hoy: e.dia === diaDe(ahora) ? e.visitasHoy : 0,
    pico_hora: Math.max(0, ...historial),
    historial,
    muestras: vivas.length,
    rendimiento: {
      lcp_ms: redondear(mediana(vivas.map((s) => s.lcp))),
      lcp_p90_ms: redondear(percentil(vivas.map((s) => s.lcp), 90)),
      ttfb_ms: redondear(mediana(vivas.map((s) => s.ttfb))),
      fps: redondear(mediana(visibles.map((s) => s.fps))),
      textura_ms: redondear(mediana(vivas.map((s) => s.tex))),
      tareas_largas_min: redondear(mediana(vivas.map((s) => (s.ltN === undefined ? null : s.ltN * 3))), 1),
      bloqueo_ms_min: redondear(mediana(vivas.map((s) => (s.ltMs === undefined ? null : s.ltMs * 3)))),
      rtt_ms: redondear(mediana(vivas.map((s) => s.rtt))),
    },
    gpu_software_pct: conGpu ? redondear((100 * sw) / conGpu) : null,
    por_navegador: contar(vivas, 'navegador'),
    por_so: contar(vivas, 'so'),
    // Qué fichas se están mirando ahora (solo ids: los nombres se ponen al servir el panel).
    fichas_ahora: fichasAhora(vivas),
    por_dispositivo: contar(vivas, 'disp'),
    por_ruta: contar(vivas, 'ruta'),
    por_red: contar(vivas, 'red'),
  };
}
