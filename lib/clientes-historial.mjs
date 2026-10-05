/**
 * HISTÓRICO MENSUAL de visitantes: dispositivos, páginas y tipo de conexión, mes a mes.
 *
 * QUÉ ES: contadores AGREGADOS por mes (UTC) que sobreviven a los reinicios. `clientes-stats.mjs` solo recuerda a
 * quienes están conectados ahora; esto recuerda cuántos hubo en octubre, en noviembre…
 *
 *   · visitas   = cargas de página (una sesión nueva cuenta una visita), con su dispositivo, su conexión, su navegador
 *                 y su sistema operativo, y el día del mes (para la gráfica diaria);
 *   · páginas   = vistas por categoría (`catalogo` / `ficha` / `otra`), contando cada cambio de página;
 *   · cruce     = dispositivo × página (¿en el móvil se mira más el catálogo o las fichas?);
 *   · fichas    = cuántas veces se vio CADA ficha pública (por su id interno);
 *   · pico      = el máximo de conectados a la vez en el mes.
 *
 * PRIVACIDAD: solo contadores. No hay sesión, IP, User-Agent ni slug guardados. Las claves salen de listas cerradas
 * (dispositivo, navegador, sistema, conexión, categoría de página) o de un ID de ficha que el servidor YA validó como
 * pública (ver `ficha-id.mjs`); nunca de texto libre del cliente. Los contadores por ficha son de la página, no de la
 * persona: no se cruzan con navegador, sistema ni dispositivo.
 *
 * DÓNDE VIVE: en la misma base del mantenedor (tabla `estadistica_mes`), así entra en el respaldo diario. Sin
 * base configurada (Vercel, CI) todo sigue funcionando en memoria y simplemente no hay histórico persistente.
 *
 * POR QUÉ SE ACUMULA EN MEMORIA: una visita no puede costar una escritura en disco. Los incrementos se acumulan y se
 * vuelcan cada `VACIADO_MS` (con un UPSERT que SUMA, así dos instancias no se pisan). Contrapartida conocida: al
 * reiniciar el servicio se pierde, como mucho, lo de los últimos `VACIADO_MS`.
 */
import { tursoConfigurado, turso } from './ediciones.mjs';
import { NAVEGADORES, SISTEMAS } from './user-agent.mjs';

export const VACIADO_MS = 15_000;
export const MESES_POR_DEFECTO = 12;
const CACHE_MS = 60_000;
const MAX_PENDIENTES = 500;

export const DISPOSITIVOS = ['movil', 'escritorio'];
export const PAGINAS = ['catalogo', 'ficha', 'otra'];
export const CONEXIONES = ['slow-2g', '2g', '3g', '4g', 'desconocida'];
/** Cuántas fichas se devuelven por mes en el ranking. */
export const TOP_FICHAS = 15;

const CLAVE = Symbol.for('vtuberdex.clientes-historial');
function estado() {
  const g = globalThis;
  if (!g[CLAVE]) g[CLAVE] = { sumas: new Map(), picos: new Map(), temporizador: null, leido: null, tabla: null };
  return g[CLAVE];
}

/** Para los tests: olvida todo y detiene el temporizador. */
export function __reiniciarHistorial() {
  const e = globalThis[CLAVE];
  if (e?.temporizador) clearInterval(e.temporizador);
  delete globalThis[CLAVE];
}

/** `2026-10`: el mes (UTC) al que pertenece un instante. */
export const mesDe = (ahora = Date.now()) => new Date(ahora).toISOString().slice(0, 7);

function almacenPorDefecto() {
  return tursoConfigurado() ? turso() : null;
}

async function asegurarTabla(almacen) {
  const e = estado();
  if (e.tabla === almacen) return;
  await almacen.execute(
    'CREATE TABLE IF NOT EXISTS estadistica_mes (mes TEXT NOT NULL, clave TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (mes, clave))',
  );
  e.tabla = almacen;
}

/** Suma `n` a un contador del mes. La clave la fijan SOLO las funciones de abajo, con valores de listas cerradas. */
function sumar(clave, n = 1, ahora = Date.now()) {
  const e = estado();
  const k = `${mesDe(ahora)}|${clave}`;
  e.sumas.set(k, (e.sumas.get(k) ?? 0) + n);
  // Sin base nunca se vuelca: que el buffer no crezca sin tope.
  if (e.sumas.size > MAX_PENDIENTES) e.sumas.delete(e.sumas.keys().next().value);
  iniciarVaciadoPeriodico();
}

/**
 * Una visita nueva (carga de página): con su dispositivo, conexión, navegador y sistema operativo.
 * @param {{ disp?: string | null, red?: string | null, navegador?: string | null, so?: string | null }} datos
 */
export function contarVisita({ disp, red, navegador, so }, ahora = Date.now()) {
  sumar('visitas', 1, ahora);
  sumar(`dia:${new Date(ahora).toISOString().slice(8, 10)}`, 1, ahora);
  if (DISPOSITIVOS.includes(disp)) sumar(`dispositivo:${disp}`, 1, ahora);
  sumar(`conexion:${CONEXIONES.includes(red) ? red : 'desconocida'}`, 1, ahora);
  sumar(`navegador:${NAVEGADORES.includes(navegador) ? navegador : 'otros'}`, 1, ahora);
  sumar(`so:${SISTEMAS.includes(so) ? so : 'otros'}`, 1, ahora);
}

/** Una vista de una ficha PÚBLICA (el id ya viene validado por `ficha-id.mjs`). */
export function contarFicha(id, ahora = Date.now()) {
  if (Number.isInteger(id) && id > 0) sumar(`ficha:${id}`, 1, ahora);
}

/** Una página vista (la primera de la visita o un cambio de página), con el dispositivo desde el que se vio. */
export function contarPagina({ disp, ruta }, ahora = Date.now()) {
  if (!PAGINAS.includes(ruta)) return;
  sumar(`pagina:${ruta}`, 1, ahora);
  if (DISPOSITIVOS.includes(disp)) sumar(`cruce:${disp}:${ruta}`, 1, ahora);
}

/** El máximo de conectados a la vez en el mes (solo sube). */
export function contarPico(conectados, ahora = Date.now()) {
  const e = estado();
  const mes = mesDe(ahora);
  if (conectados > (e.picos.get(mes) ?? 0)) e.picos.set(mes, conectados);
  iniciarVaciadoPeriodico();
}

/**
 * Vuelca lo acumulado a la base. Si falla, lo devuelve al buffer para el siguiente intento (no se pierde nada por una
 * caída momentánea). Devuelve cuántos contadores escribió.
 */
export async function vaciar(almacen = almacenPorDefecto()) {
  const e = estado();
  if (!almacen || (e.sumas.size === 0 && e.picos.size === 0)) return 0;
  const sumas = new Map(e.sumas);
  const picos = new Map(e.picos);
  e.sumas.clear();
  e.picos.clear();
  try {
    await asegurarTabla(almacen);
    const sentencias = [
      ...[...sumas].map(([k, n]) => {
        const [mes, clave] = k.split('|');
        return {
          sql: 'INSERT INTO estadistica_mes (mes, clave, n) VALUES (?, ?, ?) ON CONFLICT(mes, clave) DO UPDATE SET n = n + excluded.n',
          args: [mes, clave, n],
        };
      }),
      ...[...picos].map(([mes, n]) => ({
        sql: "INSERT INTO estadistica_mes (mes, clave, n) VALUES (?, 'pico', ?) ON CONFLICT(mes, clave) DO UPDATE SET n = MAX(n, excluded.n)",
        args: [mes, n],
      })),
    ];
    await almacen.batch(sentencias, 'write');
    e.leido = null; // lo que había en caché ya no es lo último
    return sentencias.length;
  } catch (error) {
    for (const [k, n] of sumas) e.sumas.set(k, (e.sumas.get(k) ?? 0) + n);
    for (const [mes, n] of picos) if (n > (e.picos.get(mes) ?? 0)) e.picos.set(mes, n);
    console.error(`[historial] no se pudo guardar el histórico mensual: ${error.message}`);
    return 0;
  }
}

/** Arranca (una sola vez) el volcado periódico. `unref`: nunca mantiene vivo el proceso. */
export function iniciarVaciadoPeriodico() {
  const e = estado();
  if (e.temporizador || typeof setInterval !== 'function') return;
  e.temporizador = setInterval(() => void vaciar(), VACIADO_MS);
  e.temporizador.unref?.();
}

const vacio = (mes) => ({
  mes,
  visitas: 0,
  dispositivo: Object.fromEntries(DISPOSITIVOS.map((d) => [d, 0])),
  pagina: Object.fromEntries(PAGINAS.map((p) => [p, 0])),
  conexion: Object.fromEntries(CONEXIONES.map((c) => [c, 0])),
  navegador: Object.fromEntries(NAVEGADORES.map((n) => [n, 0])),
  so: Object.fromEntries(SISTEMAS.map((n) => [n, 0])),
  /** Visitas por día del mes (`'06': 3`). */
  dias: {},
  /** Vistas por ficha mientras se acumula; al terminar pasa a ser el ranking (ver `cerrar`). */
  _fichas: new Map(),
  cruce: Object.fromEntries(DISPOSITIVOS.map((d) => [d, Object.fromEntries(PAGINAS.map((p) => [p, 0]))])),
  pico: 0,
});

function aplicar(m, clave, n, esPico = false) {
  if (clave === 'visitas') m.visitas += n;
  else if (clave === 'pico' || esPico) m.pico = Math.max(m.pico, n);
  else {
    const [grupo, a, b] = clave.split(':');
    if (grupo === 'dispositivo' && a in m.dispositivo) m.dispositivo[a] += n;
    else if (grupo === 'pagina' && a in m.pagina) m.pagina[a] += n;
    else if (grupo === 'conexion' && a in m.conexion) m.conexion[a] += n;
    else if (grupo === 'navegador' && a in m.navegador) m.navegador[a] += n;
    else if (grupo === 'so' && a in m.so) m.so[a] += n;
    else if (grupo === 'dia' && /^\d{2}$/.test(a)) m.dias[a] = (m.dias[a] ?? 0) + n;
    else if (grupo === 'ficha' && /^\d{1,9}$/.test(a)) m._fichas.set(Number(a), (m._fichas.get(Number(a)) ?? 0) + n);
    else if (grupo === 'cruce' && m.cruce[a] && b in m.cruce[a]) m.cruce[a][b] += n;
  }
}

/** Convierte el acumulado de fichas en el ranking que se devuelve (las `TOP_FICHAS` más vistas) y quita lo interno. */
function cerrar(m) {
  const { _fichas, ...resto } = m;
  const orden = [..._fichas].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  return { ...resto, fichas: orden.slice(0, TOP_FICHAS).map(([id, n]) => ({ id, n })), fichasDistintas: orden.length };
}

/**
 * Los últimos `meses` meses, el más reciente primero. Incluye lo que aún no se volcó, así que el mes en curso se ve en
 * vivo. Lo leído de la base se guarda `CACHE_MS`: el panel pregunta cada pocos segundos y esto cambia poco.
 */
export async function historial({ meses = MESES_POR_DEFECTO, ahora = Date.now(), almacen = almacenPorDefecto() } = {}) {
  const e = estado();
  const lista = [];
  const ref = new Date(ahora);
  for (let i = 0; i < meses; i += 1) lista.push(mesDe(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - i, 1)));
  const porMes = new Map(lista.map((mes) => [mes, vacio(mes)]));

  if (almacen) {
    try {
      if (!e.leido || ahora - e.leido.en > CACHE_MS || e.leido.almacen !== almacen) {
        await asegurarTabla(almacen);
        const { rows } = await almacen.execute({ sql: 'SELECT mes, clave, n FROM estadistica_mes WHERE mes >= ?', args: [lista.at(-1)] });
        e.leido = { en: ahora, almacen, filas: rows.map((r) => ({ mes: String(r.mes), clave: String(r.clave), n: Number(r.n) })) };
      }
      for (const f of e.leido.filas) if (porMes.has(f.mes)) aplicar(porMes.get(f.mes), f.clave, f.n);
    } catch (error) {
      console.error(`[historial] no se pudo leer el histórico mensual: ${error.message}`);
    }
  }
  // Lo acumulado y todavía no volcado.
  for (const [k, n] of e.sumas) {
    const [mes, clave] = k.split('|');
    if (porMes.has(mes)) aplicar(porMes.get(mes), clave, n);
  }
  for (const [mes, n] of e.picos) if (porMes.has(mes)) aplicar(porMes.get(mes), 'pico', n);
  return lista.map((mes) => cerrar(/** @type {ReturnType<typeof vacio>} */ (porMes.get(mes))));
}
