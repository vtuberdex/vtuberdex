/**
 * Presupuesto de FICHAS DISTINTAS por red: la defensa contra quien recorre el catálogo entero.
 *
 * nginx limita el ritmo (peticiones por segundo), pero un scraper paciente que respeta ese ritmo
 * saca las 785 fichas igual. Lo que un humano nunca hace es leer cientos de fichas DISTINTAS en
 * una hora, así que se cuenta eso: ids únicos vistos por red (listado + detalle) en una hora y en
 * un día. El tope diario (600) queda por debajo del catálogo (785): una sola red no puede
 * completarlo en 24 h, y repetir una ficha ya vista no gasta cupo (volver atrás no penaliza).
 *
 * La red se guarda como hash (`hashearRed`), nunca la IP en claro. El estado cuelga de `globalThis`
 * por la misma razón que `clientes-stats.mjs`: Next compila cada ruta como una entrada distinta.
 * Se pierde al reiniciar el servicio: es un freno, no un registro.
 */
import { hashearRed } from "../server/src/solicitudes.mjs";

export const VENTANAS = [
  { nombre: "hora", ms: 60 * 60 * 1000, maximo: 300 },
  { nombre: "dia", ms: 24 * 60 * 60 * 1000, maximo: 600 },
];
/** Redes recordadas a la vez; pasado esto se olvida la más antigua (acota la memoria). */
const MAX_REDES = 5000;
/** `perPage` máximo para el público: el front pide 8 (4 en celular). 100 volcaba el catálogo en 8 peticiones. */
export const PER_PAGE_PUBLICO_MAX = 24;

const CLAVE = Symbol.for("vtuberdex.anti-scraping");
function estado() {
  const g = globalThis;
  if (!g[CLAVE]) g[CLAVE] = new Map();
  return g[CLAVE];
}

/** Para los tests: olvida todo. */
export function __reiniciar() {
  delete globalThis[CLAVE];
}

/**
 * La IP real: nginx SOBRESCRIBE `X-Real-IP` con `$remote_addr`. `X-Forwarded-For` no sirve:
 * nginx le AÑADE el valor y el primer elemento lo escribe el cliente.
 */
export function redDeLaPeticion(cabeceras) {
  const ip = (cabeceras.get("x-real-ip") ?? "").trim();
  return ip || null;
}

/** Loopback y la VPN (los mismos que exime nginx) no gastan cupo: el plugin de Minecraft, los scripts, los tests. */
export function redExenta(ip) {
  return (
    !ip ||
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip.startsWith("10.8.0.") ||
    ip.toLowerCase().startsWith("fd42:42:42:")
  );
}

/**
 * Anota que `ip` ve estas fichas y dice si se pasó de cupo. Si se pasa NO anota nada (una red
 * bloqueada no sigue ampliando su lista). Devuelve `{ permitido, ventana?, reintentarEnS? }`.
 * @param {string|null} ip
 * @param {Array<string|number>} ids ids de ficha (o slugs) que esta respuesta revelaría
 */
export function gastarFichas(ip, ids, ahora = Date.now()) {
  if (redExenta(ip) || !ids.length) return { permitido: true };
  const redes = estado();
  const clave = hashearRed(ip);
  const vistas = redes.get(clave) ?? new Map();
  const limite = ahora - VENTANAS[VENTANAS.length - 1].ms;
  for (const [id, t] of vistas) if (t < limite) vistas.delete(id);

  const nuevas = ids.map(String).filter((id) => !vistas.has(id));
  for (const v of VENTANAS) {
    const dentro = [...vistas.values()].filter((t) => ahora - t < v.ms);
    if (dentro.length + nuevas.length > v.maximo) {
      const masVieja = Math.min(...dentro, ahora);
      redes.set(clave, vistas);
      return {
        permitido: false,
        ventana: v.nombre,
        reintentarEnS: Math.max(1, Math.ceil((masVieja + v.ms - ahora) / 1000)),
      };
    }
  }
  for (const id of nuevas) vistas.set(id, ahora);
  // LRU simple: reinsertar mueve la red al final del orden de inserción.
  redes.delete(clave);
  redes.set(clave, vistas);
  if (redes.size > MAX_REDES) redes.delete(redes.keys().next().value);
  return { permitido: true };
}

/** Respuesta 429 uniforme para el listado y el detalle. */
export function respuestaAgotada({ reintentarEnS }) {
  return Response.json(
    { error: "demasiadas_fichas" },
    {
      status: 429,
      headers: {
        "retry-after": String(reintentarEnS),
        "cache-control": "no-store",
      },
    },
  );
}
