import { describe, expect, it } from "vitest";
import {
  conContadoresDiferidos,
  refreshFacetCounters,
} from "../server/src/mutations.mjs";

/** Una base falsa que solo cuenta cuántas veces se recalcularon los contadores. */
function baseFalsa() {
  const llamadas: string[] = [];
  return { db: { exec: (sql: string) => llamadas.push(sql) }, llamadas };
}

describe("conContadoresDiferidos", () => {
  it("recalcula UNA vez al final en vez de una por operación", () => {
    const { db, llamadas } = baseFalsa();
    conContadoresDiferidos(db as never, () => {
      for (let i = 0; i < 500; i += 1) refreshFacetCounters(db as never);
      expect(llamadas).toHaveLength(0);
    });
    expect(llamadas).toHaveLength(1);
  });

  it("si nadie lo pidió, no recalcula; y fuera del bloque sigue siendo inmediato", () => {
    const { db, llamadas } = baseFalsa();
    conContadoresDiferidos(db as never, () => {});
    expect(llamadas).toHaveLength(0);
    refreshFacetCounters(db as never);
    expect(llamadas).toHaveLength(1);
  });

  it("recalcula aunque la función falle", () => {
    const { db, llamadas } = baseFalsa();
    expect(() =>
      conContadoresDiferidos(db as never, () => {
        refreshFacetCounters(db as never);
        throw new Error("x");
      }),
    ).toThrow("x");
    expect(llamadas).toHaveLength(1);
  });
});
