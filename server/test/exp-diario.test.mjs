import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import { expDePerfil, expRetroactiva, otorgarExp } from "../src/exp-diario.mjs";
import { ejecutorSqlite } from "../src/solicitudes.mjs";

function nuevo() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE cambio (seq INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, payload TEXT, actor TEXT, creado TEXT)");
  const anotar = (tipo, actor = "yo") =>
    Number(db.prepare("INSERT INTO cambio (tipo, payload, actor, creado) VALUES (?, '{}', ?, 'x')").run(tipo, actor).lastInsertRowid);
  return { ej: ejecutorSqlite(db), anotar };
}

test("crear, modificar y aprobar suman +10; otros tipos no", async () => {
  const { ej, anotar } = nuevo();
  for (const tipo of ["vtuber.crear", "vtuber.editar", "vtuber.estado"]) {
    const id = anotar(tipo);
    assert.equal(await otorgarExp(ej, { cambioId: id, tipo, actor: "yo" }), 10);
  }
  assert.equal(await expDePerfil(ej, "yo"), 30);
  const otro = anotar("faccion.crear");
  assert.equal(await otorgarExp(ej, { cambioId: otro, tipo: "faccion.crear", actor: "yo" }), 0);
  assert.equal(await expDePerfil(ej, "yo"), 30);
});

test("retroactivo sobre ~60 cartas es 10 x válidas e idempotente", async () => {
  const { ej, anotar } = nuevo();
  const tipos = ["vtuber.crear", "vtuber.editar", "vtuber.estado", "faccion.editar"];
  let validas = 0;
  for (let i = 0; i < 60; i++) {
    const t = tipos[i % 4];
    anotar(t);
    if (t !== "faccion.editar") validas++;
  }
  for (let i = 0; i < 5; i++) anotar("vtuber.crear", "otro");
  assert.equal(await expRetroactiva(ej, "yo"), validas * 10);
  assert.equal(await expDePerfil(ej, "yo"), validas * 10);
  assert.equal(await expRetroactiva(ej, "yo"), 0);
  assert.equal(await expDePerfil(ej, "yo"), validas * 10);
  assert.equal(await expDePerfil(ej, "otro"), 0);
});

test("automático y retroactivo no cuentan dos veces", async () => {
  const { ej, anotar } = nuevo();
  const a = anotar("vtuber.crear");
  anotar("vtuber.editar");
  await otorgarExp(ej, { cambioId: a, tipo: "vtuber.crear", actor: "yo" });
  assert.equal(await expRetroactiva(ej, "yo"), 10);
  assert.equal(await otorgarExp(ej, { cambioId: a, tipo: "vtuber.crear", actor: "yo" }), 0);
  assert.equal(await expDePerfil(ej, "yo"), 20);
});
