// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Tope de correos que pueden disparar los FORMULARIOS PÚBLICOS (códigos de inscripción y de cambios, y bajas):
 * por red y en total por día.
 *
 * POR QUÉ (auditoría 2026-11-19): el único tope era por CORREO (1/min, 4/día). Rotando direcciones, un script
 * mandaba miles de correos de VTuberDex, firmados con DKIM, a buzones ajenos; las denuncias de spam acabarían
 * con el dominio y la IP en listas negras y dejarían de llegar los códigos y avisos legítimos.
 *
 * En memoria (como `anti-scraping.mjs`): un reinicio lo borra; es un freno, no un registro. La red es la de
 * `ipDelCliente` (`X-Real-IP`), nunca algo que escriba el cliente.
 */
import { hashearRed } from "../server/src/solicitudes.mjs";

/** Correos por red y día (una persona real pide uno o dos; una oficina compartida, algunos más). */
export const POR_RED_Y_DIA = 15;
/** Correos en total por día desde los formularios: muy por encima del uso real, muy por debajo de una campaña. */
export const TOTAL_POR_DIA = 400;

const CLAVE = Symbol.for("vtuberdex.cupo-correos");
function estado() {
  const g = globalThis;
  g[CLAVE] ??= { dia: "", total: 0, porRed: new Map() };
  return g[CLAVE];
}

/** Para los tests. */
export function __reiniciarCupoDeCorreos() {
  delete globalThis[CLAVE];
}

/**
 * Gasta un correo del cupo de `ip` si queda. Devuelve `true` si se puede enviar. Las redes desconocidas
 * (sin `X-Real-IP`: desarrollo, tests) solo cuentan para el total.
 */
export function gastarCupoDeCorreo(ip, ahora = new Date()) {
  const dia = ahora.toISOString().slice(0, 10);
  const e = estado();
  if (e.dia !== dia) {
    e.dia = dia;
    e.total = 0;
    e.porRed.clear();
  }
  if (e.total >= TOTAL_POR_DIA) {
    return false;
  }
  const red = ip && ip !== "desconocida" ? hashearRed(ip) : null;
  if (red && (e.porRed.get(red) ?? 0) >= POR_RED_Y_DIA) {
    return false;
  }
  e.total += 1;
  if (red) {
    e.porRed.set(red, (e.porRed.get(red) ?? 0) + 1);
  }
  return true;
}
