import { describe, expect, test } from "vitest";

import { chipDeNivel } from "./chip-nivel";

describe("chipDeNivel", () => {
  test("lleva nivel y rango en mayúsculas", () => {
    expect(chipDeNivel(1)).toBe("NIV 1 · NOVATO");
    expect(chipDeNivel(12)).toBe("NIV 12 · VETERANO");
    expect(chipDeNivel(20)).toBe("NIV 20 · ÉLITE");
    expect(chipDeNivel(50)).toBe("NIV 50 · LEYENDA");
  });
  test("sin nivel (el listado) no hay chip", () => {
    expect(chipDeNivel(null)).toBeNull();
  });
  test("el chip más largo cabe de sobra en el lienzo con los otros dos", () => {
    // 1008 px de lienzo menos 2 × 46 de margen, a ~14 px por carácter y 30 de relleno por chip.
    const chips = [chipDeNivel(100)!, "PODER 1234", "SOLO FICHA BÁSICA"];
    const ancho = chips.reduce((s, c) => s + c.length * 14 + 30 + 10, -10);
    expect(ancho).toBeLessThan(1008 - 92);
  });
});
