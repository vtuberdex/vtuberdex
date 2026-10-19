/**
 * Sesión de visitante con prueba de trabajo: la puerta de `/api/vtubers*` para quien no es un navegador.
 *
 * Un script suelto (`requests`, `curl`, `fetch` de Node) pide la API directo y la recibe. Aquí la API
 * exige una cookie firmada que solo se obtiene resolviendo un reto: encontrar un `n` tal que
 * sha256(reto:n) empiece por `BITS_PRUEBA` ceros (~65.000 hashes, algo más de un segundo en un navegador).
 * Al navegador le cuesta un instante una vez cada 30 min; a un scraper le obliga a ejecutar código,
 * gastar CPU por cada sesión nueva y respetar el tope de sesiones por red.
 *
 * Qué NO hace: un scraper que ejecute la prueba (o use un navegador real) la pasa. Su límite lo
 * pone `anti-scraping.mjs` (fichas distintas por red) y, por encima, nginx/fail2ban.
 *
 * La cookie va atada a la red y al User-Agent (hash): copiarla a otra máquina no sirve. El secreto
 * es por proceso (se pierde al reiniciar: el cliente vuelve a resolver el reto en la primera 401).
 */
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { redDeLaPeticion, redExenta } from "./anti-scraping.mjs";

export const COOKIE = "vtd_s";
export const BITS_PRUEBA = 16;
export const VIDA_RETO_MS = 60 * 1000;
/** Vida de CADA cookie: corta, para que una robada caduque enseguida. El navegador la renueva sola (`renovarSesion`). */
export const VIDA_SESION_S = 5 * 60;
/** Tope de una sesión sin volver a resolver el reto, por mucho que se renueve. */
export const VIDA_MAXIMA_S = 2 * 60 * 60;
/** Sesiones nuevas por red y hora: resolver el reto 50 veces seguidas no es un uso humano. */
export const MAX_SESIONES_POR_RED_HORA = 30;

const CLAVE = Symbol.for("vtuberdex.sesion-visitante");
function estado() {
  const g = globalThis;
  if (!g[CLAVE])
    g[CLAVE] = {
      secreto: randomBytes(32),
      usados: new Map(),
      porRed: new Map(),
    };
  return g[CLAVE];
}

/** Para los tests: olvida el secreto y los contadores. */
export function __reiniciar() {
  delete globalThis[CLAVE];
}

const hmac = (...partes) =>
  createHmac("sha256", estado().secreto)
    .update(partes.join("|"))
    .digest("base64url");
const corto = (texto) =>
  createHash("sha256")
    .update(String(texto ?? ""))
    .digest("base64url")
    .slice(0, 16);

function iguales(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Ceros iniciales (en bits) de un digest. */
export function bitsInicialesEnCero(digest) {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    bits += Math.clz32(byte) - 24;
    break;
  }
  return bits;
}

/** Un reto nuevo: `ts.nonce.firma`. Sin estado en el servidor hasta que se canjea. */
export function crearReto(ahora = Date.now()) {
  const base = `${ahora}.${randomBytes(9).toString("base64url")}`;
  return { reto: `${base}.${hmac("reto", base)}`, bits: BITS_PRUEBA };
}

/** ¿`solucion` resuelve `reto`? Firma válida, reciente, sin usar antes y con los ceros pedidos. */
export function solucionValida(reto, solucion, ahora = Date.now()) {
  const partes = String(reto ?? "").split(".");
  if (partes.length !== 3 || !/^\d{1,16}$/.test(String(solucion ?? "")))
    return false;
  const [ts, nonce, firma] = partes;
  if (!iguales(firma, hmac("reto", `${ts}.${nonce}`))) return false;
  if (ahora - Number(ts) > VIDA_RETO_MS || Number(ts) > ahora + 5000)
    return false;
  const { usados } = estado();
  for (const [r, t] of usados) if (ahora - t > VIDA_RETO_MS) usados.delete(r);
  if (usados.has(reto)) return false;
  const digest = createHash("sha256").update(`${reto}:${solucion}`).digest();
  if (bitsInicialesEnCero(digest) < BITS_PRUEBA) return false;
  usados.set(reto, ahora); // un reto resuelto no se reutiliza
  return true;
}

/** `true` si esta red ya abrió demasiadas sesiones en la última hora (y no anota). */
export function sesionesAgotadas(redHash, ahora = Date.now()) {
  const { porRed } = estado();
  const marcas = (porRed.get(redHash) ?? []).filter(
    (t) => ahora - t < 3_600_000,
  );
  if (marcas.length >= MAX_SESIONES_POR_RED_HORA) {
    porRed.set(redHash, marcas);
    return true;
  }
  marcas.push(ahora);
  porRed.set(redHash, marcas);
  if (porRed.size > 5000) porRed.clear();
  return false;
}

/** El valor de la cookie: `exp.inicio.firma`; caduca a `exp`, atada a la red y al User-Agent. `inicio` es cuándo se resolvió el reto. */
export function valorDeSesion(
  ip,
  userAgent,
  ahora = Date.now(),
  inicio = ahora,
) {
  const exp = Math.floor(ahora / 1000) + VIDA_SESION_S;
  const ini = Math.floor(inicio / 1000);
  return `${exp}.${ini}.${hmac("sesion", exp, ini, corto(ip), corto(userAgent))}`;
}

/** Lee y verifica la cookie. `{ inicio }` en segundos si vale, o `null`. */
function leerSesion(cabeceraCookie, ip, userAgent, ahora) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(
    cabeceraCookie ?? "",
  );
  if (!m) return null;
  const [exp, ini, firma] = m[1].split(".");
  if (!/^\d{1,12}$/.test(exp ?? "") || !/^\d{1,12}$/.test(ini ?? "") || !firma)
    return null;
  if (Number(exp) * 1000 < ahora) return null;
  if (!iguales(firma, hmac("sesion", exp, ini, corto(ip), corto(userAgent))))
    return null;
  return { inicio: Number(ini) };
}

export function sesionValida(
  cabeceraCookie,
  ip,
  userAgent,
  ahora = Date.now(),
) {
  return leerSesion(cabeceraCookie, ip, userAgent, ahora) !== null;
}

/**
 * Cookie nueva con la vida completa si la actual sigue vigente y la sesión no pasó de `VIDA_MAXIMA_S`
 * desde que se resolvió el reto; si no, `null` (hay que resolver el reto otra vez).
 */
export function renovarSesion(
  cabeceraCookie,
  ip,
  userAgent,
  ahora = Date.now(),
) {
  const actual = leerSesion(cabeceraCookie, ip, userAgent, ahora);
  if (!actual || ahora / 1000 - actual.inicio > VIDA_MAXIMA_S) return null;
  return valorDeSesion(ip, userAgent, ahora, actual.inicio * 1000);
}

export const hashDeRed = corto;

/**
 * Guarda de las rutas públicas del catálogo: `null` si pasa, o la respuesta 401 a devolver.
 * Loopback, la VPN y el desarrollo local (sin `X-Real-IP`) no la necesitan.
 */
export function exigirSesion(request) {
  const ip = redDeLaPeticion(request.headers);
  if (redExenta(ip)) return null;
  const ok = sesionValida(
    request.headers.get("cookie"),
    ip,
    request.headers.get("user-agent") ?? "",
  );
  return ok
    ? null
    : Response.json(
        { error: "sesion_requerida" },
        { status: 401, headers: { "cache-control": "no-store" } },
      );
}
