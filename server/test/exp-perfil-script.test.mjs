import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { expDelMantenedor } from "../src/estadisticas-admin.mjs";
import { otorgarExp } from "../src/exp-diario.mjs";
import { ejecutorSqlite } from "../src/solicitudes.mjs";
import { lanzarRetroactiva } from "../../scripts/exp-retroactiva.mjs";

function nuevo() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cambio (seq INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, payload TEXT, actor TEXT, creado TEXT)");
  const anotar = (tipo, actor = "admin") =>
    Number(db.prepare("INSERT INTO cambio (tipo, payload, actor, creado) VALUES (?, '{}', ?, 'x')").run(tipo, actor).lastInsertRowid);
  return { ej: ejecutorSqlite(db), anotar };
}

test("el perfil del mantenedor incluye la EXP calculada con expDePerfil", async () => {
  const { ej, anotar } = nuevo();
  const id = anotar("vtuber.editar");
  await otorgarExp(ej, { cambioId: id, tipo: "vtuber.editar", actor: "admin" });
  assert.deepEqual(await expDelMantenedor(ej), { actor: "admin", total: 10 });
});

test("el script crea los eventos faltantes y es idempotente", async () => {
  const { ej, anotar } = nuevo();
  anotar("vtuber.crear");
  anotar("vtuber.estado");
  anotar("faccion.crear");
  const r = await lanzarRetroactiva(ej, "admin");
  assert.deepEqual(r, { actor: "admin", eventos: 2, expSumada: 20, expTotal: 20 });
  assert.equal((await lanzarRetroactiva(ej, "admin")).eventos, 0);
});
