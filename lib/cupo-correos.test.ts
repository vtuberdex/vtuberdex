// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { afterEach, describe, expect, it } from "vitest";
import {
  POR_RED_Y_DIA,
  TOTAL_POR_DIA,
  __reiniciarCupoDeCorreos,
  gastarCupoDeCorreo,
} from "@/lib/cupo-correos.mjs";

afterEach(() => __reiniciarCupoDeCorreos());
const hoy = new Date("2026-11-19T12:00:00Z");

describe("cupo de correos de los formularios públicos", () => {
  it("una red no puede pasar de su tope diario, aunque rote correos", () => {
    for (let i = 0; i < POR_RED_Y_DIA; i += 1) {
      expect(gastarCupoDeCorreo("203.0.113.5", hoy)).toBe(true);
    }
    expect(gastarCupoDeCorreo("203.0.113.5", hoy)).toBe(false);
    expect(gastarCupoDeCorreo("198.51.100.7", hoy)).toBe(true);
  });

  it("hay un tope global por día y se reinicia al día siguiente", () => {
    for (let i = 0; i < TOTAL_POR_DIA; i += 1) {
      gastarCupoDeCorreo(`10.0.${Math.floor(i / 200)}.${i % 200}`, hoy);
    }
    expect(gastarCupoDeCorreo("192.0.2.1", hoy)).toBe(false);
    expect(
      gastarCupoDeCorreo("192.0.2.1", new Date("2026-11-20T00:00:01Z")),
    ).toBe(true);
  });
});
