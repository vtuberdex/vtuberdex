import { describe, expect, test } from "vitest";

import { miFichaEs } from "@/lib/i18n/textos/mificha";
import { miFichaEn } from "@/lib/i18n/textos/mificha.en";
import { miFichaJa } from "@/lib/i18n/textos/mificha.ja";
import { CONTADORES, MISIONES } from "@/server/src/misiones.mjs";

/** Una misión o contador nuevo en el catálogo sin su traducción saldría en español en los tres idiomas. */
describe("textos de las misiones", () => {
  for (const [nombre, textos] of [
    ["es", miFichaEs],
    ["en", miFichaEn],
    ["ja", miFichaJa],
  ] as const) {
    test(`${nombre}: cada misión y cada contador tiene su texto`, () => {
      const claves = new Set(Object.keys(textos));
      for (const m of MISIONES) {
        expect(claves.has(`mision.${m.id}.nombre`), m.id).toBe(true);
        expect(claves.has(`mision.${m.id}.descripcion`), m.id).toBe(true);
      }
      for (const c of Object.keys(CONTADORES)) {
        expect(claves.has(`contador.${c}`), c).toBe(true);
      }
    });
  }
});
