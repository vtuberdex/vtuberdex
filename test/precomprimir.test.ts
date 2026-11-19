// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { precomprimir } from "../scripts/precomprimir.mjs";

let carpeta = "";
afterEach(() => rmSync(carpeta, { recursive: true, force: true }));

describe("precomprimir (assets estáticos del release)", () => {
  it("deja .br y .gz que se descomprimen al original, y salta lo chico o binario", async () => {
    carpeta = mkdtempSync(path.join(tmpdir(), "precomp-"));
    mkdirSync(path.join(carpeta, "chunks"));
    const js = "console.log('hola');\n".repeat(200);
    writeFileSync(path.join(carpeta, "chunks", "a.js"), js);
    writeFileSync(path.join(carpeta, "chico.css"), "a{}");
    writeFileSync(path.join(carpeta, "fuente.woff2"), Buffer.alloc(4096, 7));

    const total = await precomprimir(carpeta);
    expect(total.archivos).toBe(1);
    const base = path.join(carpeta, "chunks", "a.js");
    expect(
      zlib.brotliDecompressSync(readFileSync(`${base}.br`)).toString(),
    ).toBe(js);
    expect(zlib.gunzipSync(readFileSync(`${base}.gz`)).toString()).toBe(js);
    expect(existsSync(path.join(carpeta, "chico.css.br"))).toBe(false);
    expect(existsSync(path.join(carpeta, "fuente.woff2.br"))).toBe(false);
  });
});
