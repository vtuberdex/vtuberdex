/**
 * Comprueba que el path de escritura de los crudos del OCR (ocr.mjs) queda
 * contenido dentro del directorio de salida aunque el slug traiga `..`.
 *
 * ocr.mjs escribe con `writeInside(RAW_DIR, path.join(RAW_DIR, `${rawName}.png`), image)`
 * donde `rawName = slugify(card.slug)`. Este test reproduce ese path con un slug
 * de path traversal ('../../evil') y verifica que el fichero no sale de RAW_DIR.
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { slugify } from "../src/normalize.mjs";
import { writeInside } from "../src/safe-write.mjs";

describe("escritura de crudos del OCR", () => {
  let base;

  beforeEach(async () => {
    base = await mkdtemp(path.join(tmpdir(), "ocr-raw-"));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it("un slug con path traversal no saca el fichero del directorio de salida", async () => {
    const rawName = slugify("../../evil") || "v1";
    const target = path.join(base, `${rawName}.png`);

    await writeInside(base, target, Buffer.from("png"));

    const entries = await readdir(base);
    expect(entries).toEqual([`${rawName}.png`]);
    const rel = path.relative(path.resolve(base), path.resolve(target));
    expect(rel.startsWith("..")).toBe(false);
    expect(path.isAbsolute(rel)).toBe(false);
  });

  it("writeInside rechaza un destino que sale del directorio", async () => {
    await expect(
      writeInside(base, path.join(base, "..", "evil.png"), Buffer.from("x")),
    ).rejects.toThrow(/fuera de/);
  });
});
