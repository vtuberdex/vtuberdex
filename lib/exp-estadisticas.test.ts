// @vitest-environment node
/**
 * `estadisticasDelMantenedor` devuelve la EXP de editor bajo `expEditor`, sin un campo `exp` genérico
 * que pueda confundirse con la EXP de las fichas.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { describe, expect, test, vi } from "vitest";

import { openDatabase } from "../server/src/db/index.mjs";
import { estadisticasDelMantenedor } from "../server/src/estadisticas-admin.mjs";
import { otorgarExp } from "../server/src/exp-diario.mjs";

describe("estadisticasDelMantenedor", () => {
  test("expone la EXP de editor como expEditor y no como exp", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exp-est-"));
    const db = openDatabase(path.join(dir, "t.db"));
    const mem = new DatabaseSync(":memory:");
    const ejecutor = {
      async execute(sql: string, args: unknown[] = []) {
        const st = mem.prepare(sql);
        if (/^\s*select/i.test(sql)) {
          return { rows: st.all(...(args as never[])), rowsAffected: 0 };
        }
        const r = st.run(...(args as never[]));
        return { rows: [], rowsAffected: Number(r.changes) };
      },
    };
    await otorgarExp(ejecutor, { cambioId: 1, tipo: "vtuber.crear", actor: "admin" });
    await otorgarExp(ejecutor, { cambioId: 2, tipo: "vtuber.editar", actor: "admin" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const stats = (await estadisticasDelMantenedor(
      db,
      ejecutor as never,
    )) as Record<string, unknown>;
    expect(stats.expEditor).toEqual({ actor: "admin", total: 20 });
    expect(stats).not.toHaveProperty("exp");
    db.close();
  });
});
