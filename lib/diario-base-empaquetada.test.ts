// @vitest-environment node
/**
 * El diario se materializa sobre la base EMPAQUETADA de verdad (`deploy/data/vtuberdex.db`).
 *
 * POR QUÉ ESTE ARCHIVO EXISTE
 * ---------------------------
 * `lib/diario.test.ts` siembra una base NUEVA con el esquema actual, así que nunca ejercita el
 * camino de producción: copiar la base empaquetada (generada semanas antes, con un esquema
 * VIEJO) y aplicarle `schema.sql` + migraciones + el diario. El 2026-11-10 un índice sobre
 * `faction.parent_id` en `schema.sql` corría antes de la migración que crea la columna: en
 * producción fallaba con «no such column: parent_id», `dbConDiario` lo tragaba (sirve el
 * catálogo sin el diario para no tumbar la web) y todas las fichas creadas por el diario daban
 * 404. Ningún test se puso en rojo porque ese fallo es silencioso por diseño.
 *
 * Aquí se usa el artefacto que se despliega tal cual y se exige que el diario se aplique: una
 * ficha creada tiene que verse en una instancia fría y no puede haber «no se pudo materializar».
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterAll, beforeAll, expect, test, vi } from "vitest";

// --- Turso falso: SQLite en memoria con la misma interfaz que usa `lib/ediciones.mjs`.
const turso = new DatabaseSync(":memory:");
const clienteFalso = {
  execute: async (arg: string | { sql: string; args?: unknown[] }) => {
    const sql = typeof arg === "string" ? arg : arg.sql;
    const args = (typeof arg === "string" ? [] : (arg.args ?? [])) as never[];
    const sentencia = turso.prepare(sql);
    if (/^\s*(select|pragma)/i.test(sql)) {
      const rows = sentencia.all(...args).map((fila) => ({ ...fila }));
      return { rows, rowsAffected: 0 };
    }
    const info = sentencia.run(...args);
    return {
      rows: [],
      rowsAffected: Number(info.changes),
      lastInsertRowid: BigInt(info.lastInsertRowid),
    };
  },
  executeMultiple: async (sql: string) => {
    turso.exec(sql);
  },
  batch: async () => ({}),
};
vi.mock("@libsql/client/node", () => ({ createClient: () => clienteFalso }));

const EMPAQUETADA = path.join(process.cwd(), "deploy", "data", "vtuberdex.db");
let dir: string;
let diario: typeof import("@/lib/diario.mjs");

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtuberdex-empaquetada-"));
  // Copia: el diario abre la base ESCRIBIBLE y el artefacto versionado no se toca.
  const copia = path.join(dir, "vtuberdex.db");
  fs.copyFileSync(EMPAQUETADA, copia);
  process.env.VTUBERDEX_DB = copia;
  process.env.TURSO_DATABASE_URL = "http://turso-de-mentira";
  process.env.TURSO_AUTH_TOKEN = "no-hace-falta";
  vi.resetModules();
  diario = await import("@/lib/diario.mjs");
});

afterAll(() => {
  diario.reiniciarDiario();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("una ficha creada por el diario se ve sobre la base empaquetada en una instancia fría", async () => {
  const errores = vi.spyOn(console, "error");
  const { resultado } = await diario.aplicarYAnotar({
    tipo: "vtuber.crear",
    datos: { name: "Ficha Del Diario CI" },
  });
  const { id } = resultado as { id: number };

  diario.reiniciarDiario();
  const fila = (await diario.dbConDiario())
    .prepare("SELECT id FROM vtuber WHERE slug = ?")
    .get("ficha-del-diario-ci") as { id: number } | undefined;

  expect(fila?.id).toBe(id);
  const fallos = errores.mock.calls
    .map((args) => String(args[0]))
    .filter((m) => m.includes("no se pudo materializar"));
  expect(fallos).toEqual([]);
  errores.mockRestore();
});
