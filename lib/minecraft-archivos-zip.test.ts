// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIMITE_JAR_BYTES } from "./minecraft-admin.mjs";
import {
  guardarComprimido,
  validarCarpetaDeSubida,
  validarComprimido,
} from "./minecraft-archivos.mjs";

/** Rechazo de la validación o del guardado. */
type Rechazo = { ok: boolean; status: number; cuerpo: { error: string } };

/** Resultado correcto del guardado. */
type Guardado = {
  ok: boolean;
  nombre: string;
  bytes: number;
  ruta: string;
  sobrescrito: boolean;
};

const guardar = (opciones: Record<string, unknown>) =>
  guardarComprimido(opciones as never) as unknown as Promise<
    Guardado | Rechazo
  >;

const zip = (relleno = 4) => new Uint8Array(relleno).fill(7);

let base = "";

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "mc-zip-"));
  await fs.mkdir(path.join(base, "plugins", "Recursos"), { recursive: true });
  await fs.mkdir(path.join(base, "plugins", "VTuberDex"), { recursive: true });
  await fs.mkdir(path.join(base, "config"), { recursive: true });
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

describe("validarComprimido", () => {
  it("acepta un zip con nombre normal", () => {
    expect(validarComprimido({ nombre: "pack de recursos.zip", tamano: 10 })).toEqual({
      ok: true,
      nombre: "pack de recursos.zip",
      tamano: 10,
    });
  });

  it("solo acepta la extensión .zip", () => {
    for (const nombre of ["plugin.jar", "pack.rar", "pack.zip.txt", "pack"]) {
      const r = validarComprimido({ nombre, tamano: 10 }) as Rechazo;
      expect(r.ok).toBe(false);
      expect(r.status).toBe(415);
    }
  });

  it("no acepta nombres con rutas ni vacíos", () => {
    for (const nombre of ["../pack.zip", "sub/pack.zip", "sub\\pack.zip", "  "]) {
      const r = validarComprimido({ nombre, tamano: 10 }) as Rechazo;
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
    }
  });

  it("usa el mismo tope que un jar y no acepta un archivo vacío", () => {
    expect(
      (validarComprimido({ nombre: "pack.zip", tamano: 0 }) as Rechazo).status,
    ).toBe(400);
    expect(
      (
        validarComprimido({
          nombre: "pack.zip",
          tamano: LIMITE_JAR_BYTES + 1,
        }) as Rechazo
      ).status,
    ).toBe(413);
    expect(
      validarComprimido({ nombre: "pack.zip", tamano: LIMITE_JAR_BYTES }).ok,
    ).toBe(true);
  });
});

describe("validarCarpetaDeSubida", () => {
  it("solo deja carpetas dentro de plugins/", () => {
    expect(validarCarpetaDeSubida("plugins", "admin")).toEqual({
      ok: true,
      relativa: "plugins",
    });
    expect(validarCarpetaDeSubida("plugins/Recursos/", "admin")).toEqual({
      ok: true,
      relativa: "plugins/Recursos",
    });
    for (const carpeta of ["", "config", "world", "../plugins"]) {
      expect(validarCarpetaDeSubida(carpeta, "admin").ok).toBe(false);
    }
  });

  it("deja fuera la carpeta con credenciales para un mantenedor", () => {
    const r = validarCarpetaDeSubida("plugins/VTuberDex", "mantenedor") as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});

describe("guardarComprimido", () => {
  it("escribe el zip en la carpeta pedida", async () => {
    const r = (await guardar({
      dir: base,
      carpeta: "plugins/Recursos",
      nombre: "pack de recursos.zip",
      contenido: zip(),
      rol: "admin",
    })) as Guardado;
    expect(r.ok).toBe(true);
    expect(r.sobrescrito).toBe(false);
    expect(r.ruta).toBe("plugins/Recursos/pack de recursos.zip");
    const escrito = await fs.readFile(
      path.join(base, "plugins/Recursos/pack de recursos.zip"),
    );
    expect(escrito.byteLength).toBe(4);
  });

  it("no pisa el que ya existe si no se confirma", async () => {
    const r = (await guardar({
      dir: base,
      carpeta: "plugins/Recursos",
      nombre: "pack de recursos.zip",
      contenido: zip(8),
      rol: "admin",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(r.cuerpo.error).toBe("ya_existe");
    // Sigue el de antes, no el nuevo.
    const escrito = await fs.readFile(
      path.join(base, "plugins/Recursos/pack de recursos.zip"),
    );
    expect(escrito.byteLength).toBe(4);
  });

  it("reemplaza de una vez cuando se confirma, sin copia .bak", async () => {
    const r = (await guardar({
      dir: base,
      carpeta: "plugins/Recursos",
      nombre: "pack de recursos.zip",
      contenido: zip(9),
      sobrescribir: true,
      rol: "admin",
    })) as Guardado;
    expect(r.ok).toBe(true);
    expect(r.sobrescrito).toBe(true);
    const carpeta = path.join(base, "plugins/Recursos");
    const escrito = await fs.readFile(path.join(carpeta, "pack de recursos.zip"));
    expect(escrito.byteLength).toBe(9);
    expect(await fs.readdir(carpeta)).toEqual(["pack de recursos.zip"]);
  });

  it("rechaza guardar fuera de plugins/", async () => {
    const r = (await guardar({
      dir: base,
      carpeta: "config",
      nombre: "pack.zip",
      contenido: zip(),
      rol: "admin",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });

  it("no escribe si el nombre no es un zip", async () => {
    const r = (await guardar({
      dir: base,
      carpeta: "plugins/Recursos",
      nombre: "pack.rar",
      contenido: zip(),
      rol: "admin",
    })) as Rechazo;
    expect(r.status).toBe(415);
  });

  it("no escribe en una carpeta que no existe", async () => {
    const r = (await guardar({
      dir: base,
      carpeta: "plugins/NoExiste",
      nombre: "pack.zip",
      contenido: zip(),
      rol: "admin",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
  });
});
