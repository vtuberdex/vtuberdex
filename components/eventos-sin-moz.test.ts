// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { describe, expect, it } from "vitest";
import { quitarPropiedadesMozObsoletas } from "@/components/eventos-sin-moz";

describe("getters moz* obsoletos de Firefox", () => {
  it("los saca del for…in (lo que hace R3F al copiar el evento) y deja lo demás", () => {
    const leidas: string[] = [];
    const proto = {};
    for (const nombre of ["mozPressure", "mozInputSource", "pressure"]) {
      Object.defineProperty(proto, nombre, {
        configurable: true,
        enumerable: true,
        get: () => {
          leidas.push(nombre);
          return 0;
        },
      });
    }
    quitarPropiedadesMozObsoletas(proto);
    const evento = Object.create(proto) as Record<string, unknown>;
    const copia: Record<string, unknown> = {};
    for (const prop in evento) {
      copia[prop] = evento[prop];
    }
    expect(Object.keys(copia)).toEqual(["pressure"]);
    expect(leidas).toEqual(["pressure"]);
  });

  it("sin MouseEvent (servidor) no hace nada", () => {
    expect(() => quitarPropiedadesMozObsoletas(undefined)).not.toThrow();
  });
});
