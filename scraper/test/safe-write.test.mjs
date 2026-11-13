import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { writeInside } from "../src/safe-write.mjs";

test("escribe un fichero dentro del directorio base", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    const target = path.join(base, "sub.webp");
    await writeInside(base, target, "dato");
    assert.equal(await readFile(target, "utf8"), "dato");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rechaza una ruta que escapa del base con ..", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    const target = path.join(base, "..", "vd-escape-" + process.pid + ".txt");
    await assert.rejects(writeInside(base, target, "x"), /ruta fuera/);
    await assert.rejects(access(target));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rechaza la propia base y una ruta absoluta fuera de ella", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    await assert.rejects(writeInside(base, base, "x"), /ruta fuera/);
    const outside = path.join(os.tmpdir(), "vd-abs-" + process.pid + ".txt");
    await assert.rejects(writeInside(base, outside, "x"), /ruta fuera/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("permite un nombre que empieza por .. dentro del base", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    const target = path.join(base, "..cache.txt");
    await writeInside(base, target, "ok");
    assert.equal(await readFile(target, "utf8"), "ok");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("escribe en una subcarpeta del base sin salirse", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    const carpeta = path.join(base, "raw");
    await mkdir(carpeta);
    const target = path.join(carpeta, "captura.png");
    await writeInside(base, target, "png");
    assert.equal(await readFile(target, "utf8"), "png");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("rechaza un nombre con espacios o separadores sueltos", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    await assert.rejects(writeInside(base, path.join(base, "con espacio.png"), "x"), /nombre no permitido/);
    await assert.rejects(writeInside(base, path.join(base, "sub", "..", "..", "otro.png"), "x"), /ruta fuera/);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("acepta un nombre con guiones y guiones bajos, como los del scraper", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "vd-safe-"));
  try {
    const target = path.join(base, "mi-slug--YWJjZA.html");
    await writeInside(base, target, "html");
    assert.equal(await readFile(target, "utf8"), "html");
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
