import { describe, expect, it } from "vitest";

import { ORIGENES } from "@/lib/premium";

import { PREMIUM, marcoDe } from "./card3d-config";
import { tipoDeEtiqueta } from "./premium-label";

describe("marcos de gradeo según el origen", () => {
  it("hay un marco por cada origen del servidor", () => {
    expect(Object.keys(PREMIUM.marcos).sort()).toEqual([...ORIGENES].sort());
  });

  it("sin origen (cartas anteriores a la columna) se usa el de donación", () => {
    expect(marcoDe(undefined)).toEqual(marcoDe("donacion"));
    expect(marcoDe("desconocido" as never)).toEqual(marcoDe("donacion"));
  });

  it("el marco parte del acrílico y la hoja base y solo cambia lo que su origen redefine", () => {
    const marco = marcoDe("misiones");
    expect(marco.acrylic.fresnelPower).toBe(PREMIUM.acrylic.fresnelPower);
    expect(marco.insert.pxWidth).toBe(PREMIUM.insert.pxWidth);
  });
});

describe("identidad visual de cada marco", () => {
  const HEX = /^#[0-9a-f]{6}$/i;
  const origenes = ["premium8", "misiones", "donacion"] as const;

  it("cada origen redefine su propio color de acrílico, de hoja y de acento", () => {
    for (const o of origenes) {
      const marco = marcoDe(o);
      expect(marco.acrylic.tint).toMatch(HEX);
      expect(marco.insert.windowLine).toMatch(HEX);
      expect(marco.etiqueta.acento).toMatch(HEX);
    }
  });

  it("los tres se distinguen entre sí en acrílico, hoja y acento", () => {
    const campos = [
      (o: (typeof origenes)[number]) => marcoDe(o).acrylic.tint,
      (o: (typeof origenes)[number]) => marcoDe(o).insert.frame,
      (o: (typeof origenes)[number]) => marcoDe(o).etiqueta.acento,
      (o: (typeof origenes)[number]) => marcoDe(o).etiqueta.tipo,
    ];
    for (const campo of campos) {
      expect(new Set(origenes.map(campo)).size).toBe(origenes.length);
    }
  });

  it("la etiqueta dice el tipo de su origen, salvo Black Label y deterioro, que mandan", () => {
    expect(tipoDeEtiqueta(false, false, "premium8")).toBe("PREMIUM 8");
    expect(tipoDeEtiqueta(false, false, "misiones")).toBe("MISIONES");
    expect(tipoDeEtiqueta(false, false, "donacion")).toBe("DONACIÓN");
    expect(tipoDeEtiqueta(false, false, undefined)).toBe("DONACIÓN");
    expect(tipoDeEtiqueta(true, false, "misiones")).toBe("BLACK LABEL");
    expect(tipoDeEtiqueta(false, true, "premium8")).toBe("DETERIORADA");
  });
});
