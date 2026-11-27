/** Origen del grado (premium8 / misiones / donacion): se guarda, se valida y se conserva al subir de grado. */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { openDatabase } from "../src/db/index.mjs";
import { seedDatabase } from "../src/seed.mjs";
import { aplicarParche } from "../src/mutations.mjs";
import { getVtuberBySlug } from "../src/search.mjs";
import { vtuberUpdateSchema } from "../src/validation.mjs";
import { ORIGENES, ORIGEN_POR_DEFECTO } from "../src/premium.mjs";

const vtuber = (n, slug) => ({
  dexNumber: n, slug, name: slug,
  countries: [{ slug: "chile", name: "Chile", flag: "🇨🇱" }],
  languages: ["es"], groups: [], artists: [],
  source: { indexImage: `fichas/v${n}.jpg`, detailUrl: null, hasDetail: false },
  assets: { card: `images/ficha/${slug}.webp` }, detail: null,
});

function base() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vtuberdex-origen-"));
  const db = openDatabase(path.join(dir, "app.db"));
  seedDatabase({ db, dataset: { generatedAt: "2026-01-01T00:00:00.000Z", source: "x", vtubers: [vtuber(1, "ana"), vtuber(2, "beto")] } });
  return { db, id: (s) => db.prepare("SELECT id FROM vtuber WHERE slug = ?").get(s).id, limpiar: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("hay tres orígenes y el de por defecto es la donación", () => {
  assert.deepEqual([...ORIGENES], ["premium8", "misiones", "donacion"]);
  assert.equal(ORIGEN_POR_DEFECTO, "donacion");
});

test("sin origen en el parche una carta nueva queda con el origen por defecto", () => {
  const { db, id, limpiar } = base();
  aplicarParche(db, id("ana"), { premium: { grade: "6" } });
  assert.equal(getVtuberBySlug(db, "ana").premium.origin, "donacion");
  limpiar();
});

test("el origen se guarda, y subir de grado sin indicarlo lo conserva", () => {
  const { db, id, limpiar } = base();
  aplicarParche(db, id("ana"), { premium: { grade: "6", origin: "misiones" } });
  aplicarParche(db, id("ana"), { premium: { grade: "6.5" } });
  assert.equal(getVtuberBySlug(db, "ana").premium.origin, "misiones");
  aplicarParche(db, id("ana"), { premium: { grade: "6.5", origin: "premium8" } });
  assert.equal(getVtuberBySlug(db, "ana").premium.origin, "premium8");
  limpiar();
});

test("un origen inválido se rechaza en el esquema", () => {
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: "6", origin: "regalo" } }).success, false);
  assert.equal(vtuberUpdateSchema.safeParse({ premium: { grade: "6", origin: "premium8" } }).success, true);
});
