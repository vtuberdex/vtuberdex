// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `terminaEnParentesis` sustituye a `/\([^)]*\)\s*$/` (backtracking cuadrático) para detectar subfacciones
 * huérfanas: se compara contra la regex en casos válidos e inválidos y se prueba una entrada larga.
 */
import { describe, expect, it } from "vitest";

import {
  esSubfaccionHuerfana,
  terminaEnParentesis,
} from "@/components/admin/faction-manager";
import type { FactionRow } from "@/lib/types";

const ANTIGUA = /\([^)]*\)\s*$/;

describe("terminaEnParentesis", () => {
  it("dice lo mismo que la regex anterior", () => {
    const casos = [
      "Netherbane (Ceniza)",
      "Netherbane ()",
      "Netherbane",
      "Netherbane (Ceniza) x",
      "Netherbane (a) (b)",
      "Netherbane (a)b)",
      "Netherbane ((a)",
      "(solo)",
      ")",
      "(",
      "",
      "a)",
      "a ( b ) ",
    ];
    for (const texto of casos) {
      const recortado = texto.trim();
      expect(terminaEnParentesis(recortado), texto).toBe(
        ANTIGUA.test(recortado),
      );
    }
  });

  it("es lineal con muchos paréntesis de apertura", () => {
    const largo = `${"(".repeat(100_000)}x`;
    expect(terminaEnParentesis(largo)).toBe(false);
    expect(terminaEnParentesis(`${largo})`)).toBe(true);
  });

  it("una facción con madre nunca es huérfana", () => {
    const base = { id: 1, label: "Madre (Hija)" } as FactionRow;
    expect(esSubfaccionHuerfana({ ...base, parentId: null })).toBe(true);
    expect(esSubfaccionHuerfana({ ...base, parentId: 2 })).toBe(false);
  });
});
