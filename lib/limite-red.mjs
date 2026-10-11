/**
 * Tope de peticiones por red en una ventana deslizante, en memoria de la instancia. Lo usan los
 * formularios que mandan un enlace al correo (`admin-enlace`, `mi-ficha`) para que nadie pueda
 * llenar buzones ajenos desde la misma red.
 *
 * El `Map` lo pone quien llama (colgado de `globalThis` para sobrevivir a la recarga en caliente);
 * la red se guarda como hash, nunca la IP en claro.
 */
import { hashearRed } from '../server/src/solicitudes.mjs';

const VENTANA_MS = 10 * 60 * 1000;
const MAX_POR_RED = 10;

/** Devuelve `redAgotada(ip, ahora?)`: `true` si esa red ya gastó su cupo (y entonces no lo anota). */
export function limitePorRed(porRed, { ventanaMs = VENTANA_MS, maximo = MAX_POR_RED } = {}) {
  return function redAgotada(ip, ahora = Date.now()) {
    const clave = hashearRed(ip);
    const marcas = (porRed.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
    if (marcas.length >= maximo) {
      porRed.set(clave, marcas);
      return true;
    }
    marcas.push(ahora);
    porRed.set(clave, marcas);
    if (porRed.size > 5000) porRed.clear();
    return false;
  };
}
