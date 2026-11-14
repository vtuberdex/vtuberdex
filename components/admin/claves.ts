// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Claves de React para listas de SOLO LECTURA cuyos elementos no traen id (redes de una solicitud, detalles de
 * un error de validación…). La clave sale del CONTENIDO, no de la posición: si la lista cambia, React empareja
 * cada fila con la suya. Como el contenido puede repetirse (nada impide mandar dos veces la misma red), cada
 * repetición lleva su número de aparición: `x`, `x#2`, `x#3`. Así nunca hay dos claves iguales.
 */
export function conClaves<T>(
  items: readonly T[],
  claveDe: (item: T) => string,
): Array<{ item: T; clave: string }> {
  const vistas = new Map<string, number>();
  return items.map((item) => {
    const base = claveDe(item);
    const n = (vistas.get(base) ?? 0) + 1;
    vistas.set(base, n);
    return { item, clave: n === 1 ? base : `${base}#${n}` };
  });
}
