// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { describe, expect, test } from "vitest";

import { terminosDe } from "@/lib/terminos-i18n";

/**
 * `terminos-contenido.tsx` usa el TEXTO de cada párrafo como `key` (no su índice): el texto legal
 * es fijo y así React no confunde párrafos si se inserta uno en medio. Eso solo vale si dentro
 * del preámbulo y de cada cláusula no hay dos párrafos idénticos; esta prueba lo fija.
 */
describe("párrafos de los términos como key", () => {
  for (const locale of ["es", "en", "ja"] as const) {
    test(`${locale}: sin párrafos repetidos en el preámbulo ni en una cláusula`, () => {
      const t = terminosDe(locale);
      expect(new Set(t.preambulo).size).toBe(t.preambulo.length);
      for (const c of t.clausulas) {
        expect(new Set(c.parrafos).size, c.id).toBe(c.parrafos.length);
      }
    });
  }
});
