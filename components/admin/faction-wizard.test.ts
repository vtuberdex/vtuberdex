// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `nombreDeSubfaccion` dejó de usar `/\)+\s*$/` (backtracking cuadrático) para quitar los paréntesis del
 * final: estas pruebas fijan que el resultado es el mismo en los casos de siempre y con entradas largas.
 */
import { describe, expect, it } from "vitest";

import { nombreDeSubfaccion } from "@/components/admin/faction-wizard";

describe("nombreDeSubfaccion", () => {
  it("compone «Madre (Propia)»", () => {
    expect(nombreDeSubfaccion("Netherbane", "Ceniza")).toBe(
      "Netherbane (Ceniza)",
    );
    expect(nombreDeSubfaccion("Netherbane", "")).toBe("Netherbane ()");
    expect(nombreDeSubfaccion("", " Suelta ")).toBe("Suelta");
  });

  it("respeta lo que ya viene bien escrito", () => {
    expect(nombreDeSubfaccion("Netherbane", "netherbane (Ceniza)")).toBe(
      "netherbane (Ceniza)",
    );
  });

  it("reescribe lo que empieza por la madre, quitando paréntesis sueltos", () => {
    expect(nombreDeSubfaccion("Netherbane", "Netherbane Ceniza))")).toBe(
      "Netherbane (Ceniza)",
    );
    expect(nombreDeSubfaccion("Netherbane", "Netherbane((Ceniza")).toBe(
      "Netherbane (Ceniza)",
    );
    expect(nombreDeSubfaccion("Netherbane", "Netherbane")).toBe(
      "Netherbane ()",
    );
    expect(nombreDeSubfaccion("Netherbane", "Netherbane (Ceniza) x")).toBe(
      "Netherbane (Ceniza) x)",
    );
  });

  it("no se atasca con muchos paréntesis de cierre", () => {
    const largo = `Madre x${")".repeat(50_000)}y`;
    expect(nombreDeSubfaccion("Madre", largo)).toBe(
      `Madre (x${")".repeat(50_000)}y)`,
    );
  });
});
