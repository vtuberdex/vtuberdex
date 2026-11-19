// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Quita de `MouseEvent.prototype` las dos propiedades `moz*` que Firefox declara obsoletas.
 *
 * EL AVISO: «MouseEvent.mozPressure está obsoleto. Use PointerEvent.pressure» y lo mismo con
 * `mozInputSource`, en cuanto se toca una carta. Los provoca `@react-three/fiber` (9.8.2): para crear
 * su evento copia TODAS las propiedades del nativo con `for (let prop in event)`, y leer esos dos
 * getters es lo que Firefox denuncia. Nuestro código no los usa y R3F no los necesita.
 *
 * Son accesores configurables del prototipo (WebIDL), así que borrarlos los saca del `for…in` sin
 * tocar nada más: `pressure` y `pointerType` de `PointerEvent` siguen ahí. En los demás navegadores no
 * existen y esto no hace nada. Se ejecuta una vez, al cargar el módulo (antes del primer evento).
 */
export const PROPIEDADES_MOZ_OBSOLETAS = [
  "mozPressure",
  "mozInputSource",
] as const;

export function quitarPropiedadesMozObsoletas(
  proto: object | undefined = typeof MouseEvent === "undefined"
    ? undefined
    : MouseEvent.prototype,
): void {
  if (!proto) {
    return;
  }
  for (const nombre of PROPIEDADES_MOZ_OBSOLETAS) {
    if (Object.getOwnPropertyDescriptor(proto, nombre)?.configurable) {
      Reflect.deleteProperty(proto, nombre);
    }
  }
}

quitarPropiedadesMozObsoletas();
