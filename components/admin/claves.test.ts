// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { describe, expect, it } from "vitest";

import { conClaves } from "@/components/admin/claves";

describe("conClaves", () => {
  it("usa el contenido como clave y numera las repeticiones", () => {
    const redes = [
      { platform: "X", url: "https://x.com/a" },
      { platform: "YouTube", url: "https://youtube.com/a" },
      { platform: "X", url: "https://x.com/a" },
    ];
    const claves = conClaves(redes, (r) => `${r.platform}|${r.url}`).map(
      (c) => c.clave,
    );
    expect(claves).toEqual([
      "X|https://x.com/a",
      "YouTube|https://youtube.com/a",
      "X|https://x.com/a#2",
    ]);
    expect(new Set(claves).size).toBe(claves.length);
  });

  it("conserva el orden y el elemento", () => {
    const lista = ["b", "a"];
    expect(conClaves(lista, (x) => x)).toEqual([
      { item: "b", clave: "b" },
      { item: "a", clave: "a" },
    ]);
  });
});
