/**
 * Panorama del servidor para el dashboard de `/minecraft-admin`: jugadores, TPS, tiempo de
 * tick y carga de la máquina, todo de solo lectura.
 *
 * Los datos salen de tres comandos FIJOS de RCON (`list`, `tps`, `mspt`) y de `node:os`. El
 * panel consulta cada pocos segundos; para que dos pestañas abiertas (o varios mantenedores)
 * no multipliquen las conexiones RCON, el resultado se guarda `VIGENCIA_MS` y se comparte.
 * Los textos de Paper traen códigos de color y su forma cambia entre versiones, así que los
 * analizadores NO lanzan: si no entienden una línea devuelven `null` y el panel pinta «—».
 */
import os from "node:os";
import { ejecutarAccion, sinColores } from "./minecraft-rcon.mjs";

export const VIGENCIA_MS = 4000;

const numeros = (texto) =>
  [...String(texto).matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));

/** «There are 1 of a max of 20 players online: A, B» → { enLinea, maximo, nombres }. */
export function analizarJugadores(texto) {
  const limpio = sinColores(texto);
  const m = limpio.match(/(\d+)\s+of a max of\s+(\d+)/i);
  if (!m) return null;
  const resto = limpio.split(":").slice(1).join(":");
  const nombres = resto
    .split(",")
    .map((n) => n.trim())
    .filter((n) => /^[A-Za-z0-9_.]{1,20}$/.test(n));
  return { enLinea: Number(m[1]), maximo: Number(m[2]), nombres };
}

/** «TPS from last 1m, 5m, 15m: 20.0, 20.0, 19.8» → [20, 20, 19.8] (el tope real es 20). */
export function analizarTps(texto) {
  const despues = sinColores(texto).split(":").slice(1).join(":");
  const valores = numeros(despues).slice(0, 3);
  return valores.length ? valores : null;
}

/**
 * «Server tick times (avg/min/max) from last 5s, 10s, 1m:\n 1.8/0.9/18.9, …» →
 * { promedio, minimo, maximo } de la ventana más corta.
 */
export function analizarMspt(texto) {
  const linea = sinColores(texto)
    .split("\n")
    .find((l) => /\d\s*\/\s*\d/.test(l));
  if (!linea) return null;
  // Se exigen los tres números por cantidad, no por `=== undefined` sobre la desestructuración
  // (Sonar S3403 lo da por siempre falso aunque una línea corta deje huecos).
  const valores = numeros(linea.split(",")[0]);
  if (valores.length < 3) return null;
  const [promedio, minimo, maximo] = valores;
  return { promedio, minimo, maximo };
}

/** Carga y memoria de la máquina (la VPS comparte web y juego: es el techo que importa). */
export function leerSistema() {
  const total = os.totalmem();
  const libre = os.freemem();
  return {
    cargaPorNucleo: Number(
      (os.loadavg()[0] / (os.cpus().length || 1)).toFixed(2),
    ),
    nucleos: os.cpus().length,
    memoriaUsadaMb: Math.round((total - libre) / 1048576),
    memoriaTotalMb: Math.round(total / 1048576),
    encendidoHoras: Math.floor(os.uptime() / 3600),
  };
}

/** @type {{ hasta: number, valor: any, vuelo: Promise<any> | null }} */
let memo = { hasta: 0, valor: null, vuelo: null };

/** Consulta el servidor (o devuelve lo reciente). `ejecutar` se inyecta para las pruebas. */
export async function obtenerPanorama({
  ejecutar = ejecutarAccion,
  ahora = Date.now(),
} = {}) {
  if (memo.valor && ahora < memo.hasta) return memo.valor;
  if (memo.vuelo) return memo.vuelo;
  memo.vuelo = (async () => {
    const [jug, tps, mspt] = await Promise.all(
      ["jugadores", "tps", "mspt"].map((a) => ejecutar(a, {})),
    );
    const rconOk = jug.ok;
    const valor = {
      hora: new Date(ahora).toISOString(),
      rcon: rconOk ? "ok" : jug.status === 503 ? "sin_configurar" : "caido",
      jugadores: rconOk ? analizarJugadores(jug.respuesta) : null,
      tps: tps.ok ? analizarTps(tps.respuesta) : null,
      mspt: mspt.ok ? analizarMspt(mspt.respuesta) : null,
      sistema: leerSistema(),
    };
    memo = { hasta: ahora + VIGENCIA_MS, valor, vuelo: null };
    return valor;
  })();
  try {
    return await memo.vuelo;
  } finally {
    memo.vuelo = null;
  }
}

export function olvidarPanorama() {
  memo = { hasta: 0, valor: null, vuelo: null };
}
