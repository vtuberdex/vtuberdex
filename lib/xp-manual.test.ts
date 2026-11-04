// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, test } from "vitest";

import {
  XP_MANUAL_MAX,
  darXpManual,
  historialXpManual,
  xpDeJuego,
  xpDeJuegoVarias,
} from "@/server/src/minecraft.mjs";
import { ejecutorSqlite } from "@/server/src/solicitudes.mjs";

let e: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  e = ejecutorSqlite(new DatabaseSync(":memory:"));
});

const dar = (extra: Record<string, unknown> = {}) =>
  darXpManual(e, {
    vtuberId: 7,
    cantidad: 150,
    motivo: "Premio del evento",
    actor: "admin@example.com",
    ...extra,
  } as never);

describe("XP manual", () => {
  test("suma a la XP de la ficha y queda con quién y por qué", async () => {
    const r = await dar();
    expect(r).toMatchObject({ ok: true, cantidad: 150, xpTotal: 150 });
    expect(await xpDeJuego(e, 7)).toBe(150);
    expect((await xpDeJuegoVarias(e, [7, 8])).get(7)).toBe(150);
    expect(await historialXpManual(e, 7)).toMatchObject([
      {
        cantidad: 150,
        motivo: "Premio del evento",
        actor: "admin@example.com",
      },
    ]);
  });

  test("una cantidad negativa corrige un error", async () => {
    await dar();
    const r = await dar({ cantidad: -50, motivo: "Corrección" });
    expect(r).toMatchObject({ ok: true, xpTotal: 100 });
    const h = await historialXpManual(e, 7);
    expect(h.map((x: { cantidad: number }) => x.cantidad)).toEqual([-50, 150]);
  });

  test("no es de otra ficha", async () => {
    await dar();
    expect(await xpDeJuego(e, 8)).toBe(0);
  });

  test("valida cantidad, motivo, ficha y actor", async () => {
    for (const cantidad of [
      0,
      1.5,
      "abc",
      XP_MANUAL_MAX + 1,
      -XP_MANUAL_MAX - 1,
      null,
    ]) {
      expect(await dar({ cantidad })).toMatchObject({ ok: false, status: 400 });
    }
    for (const motivo of ["", "ab", "x".repeat(201), "a\nb"]) {
      expect(await dar({ motivo })).toMatchObject({ ok: false, status: 400 });
    }
    expect(await dar({ vtuberId: 0 })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(await dar({ actor: " " })).toMatchObject({ ok: false, status: 400 });
    expect(await xpDeJuego(e, 7)).toBe(0);
  });

  test("el tope es inclusivo", async () => {
    expect(await dar({ cantidad: XP_MANUAL_MAX })).toMatchObject({ ok: true });
  });
});
