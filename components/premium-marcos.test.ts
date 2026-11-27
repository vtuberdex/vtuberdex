import { describe, expect, it } from "vitest";

import { ORIGENES } from "@/lib/premium";

import { PREMIUM, marcoDe } from "./card3d-config";

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
