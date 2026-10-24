// @vitest-environment node
/**
 * La EXP de editor (diario, +10 por acción) y la EXP de las fichas son independientes:
 * cada una con su cálculo, su almacenamiento y su nombre.
 */
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test } from "vitest";

import { expDelMantenedor } from "../server/src/estadisticas-admin.mjs";
import { experienciaDeFicha } from "../server/src/experiencia.mjs";
import { expDePerfil, otorgarExp } from "../server/src/exp-diario.mjs";

function nuevo() {
  const db = new DatabaseSync(":memory:");
  const ejecutor = {
    async execute(sql: string, args: unknown[] = []) {
      const st = db.prepare(sql);
      if (/^\s*select/i.test(sql)) {
        return { rows: st.all(...(args as never[])), rowsAffected: 0 };
      }
      const r = st.run(...(args as never[]));
      return { rows: [], rowsAffected: Number(r.changes) };
    },
  };
  return { db, ejecutor };
}

describe("EXP de editor separada de la EXP de fichas", () => {
  test("una acción del diario suma +10 solo a la EXP de editor y no toca la de fichas", async () => {
    const { db, ejecutor } = nuevo();
    const fichaAntes = experienciaDeFicha({ likes: 3, xpJuego: 20, dias: 10 });
    for (const [i, tipo] of ["vtuber.crear", "vtuber.editar", "vtuber.estado"].entries()) {
      expect(await otorgarExp(ejecutor, { cambioId: i + 1, tipo, actor: "yo" })).toBe(10);
    }
    expect(await expDePerfil(ejecutor, "yo")).toBe(30);
    expect(await expDePerfil(ejecutor, "otro")).toBe(0);
    expect(experienciaDeFicha({ likes: 3, xpJuego: 20, dias: 10 })).toEqual(fichaAntes);
    const tablas = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    expect(tablas.map((t) => t.name)).toEqual(["exp_evento"]);
  });

  test("un cambio de estado (vtuber.estado) crea su evento en exp_evento y suma +10 al actor", async () => {
    const { db, ejecutor } = nuevo();
    expect(await expDePerfil(ejecutor, "admin")).toBe(0);
    expect(await otorgarExp(ejecutor, { cambioId: 42, tipo: "vtuber.estado", actor: "admin" })).toBe(10);
    const eventos = db.prepare("SELECT * FROM exp_evento").all() as Array<Record<string, unknown>>;
    expect(eventos).toHaveLength(1);
    expect(Object.values(eventos[0])).toEqual(expect.arrayContaining([42, "vtuber.estado", "admin", 10]));
    expect(await expDePerfil(ejecutor, "admin")).toBe(10);
  });

  test("sumar EXP a una ficha no altera la EXP de editor", async () => {
    const { ejecutor } = nuevo();
    await otorgarExp(ejecutor, { cambioId: 1, tipo: "vtuber.crear", actor: "admin" });
    const antes = await expDePerfil(ejecutor, "admin");
    const ficha = experienciaDeFicha({ likes: 50, xpJuego: 500, dias: 100 });
    expect(ficha.total).toBeGreaterThan(0);
    expect(await expDePerfil(ejecutor, "admin")).toBe(antes);
  });

  test("el mantenedor expone la EXP de editor con su propia forma", async () => {
    const { ejecutor } = nuevo();
    await otorgarExp(ejecutor, { cambioId: 7, tipo: "vtuber.editar", actor: "admin" });
    expect(await expDelMantenedor(ejecutor)).toEqual({ actor: "admin", total: 10 });
  });
});
