// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
/**
 * Borrado de archivos del servidor desde el panel (`borrarArchivo`).
 *
 * Lo que se prueba es lo que protege al servidor: quién puede borrar, que la ruta pase la lista
 * cerrada de siempre, que una carpeta no se borre por accidente y —lo importante— que antes de
 * borrar quede una copia `.bak` al lado, para que un clic de más se recupere sin restaurar el mundo.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { borrarArchivo } from "./minecraft-archivos.mjs";

/** Rechazo de la validación. */
type Rechazo = { ok: boolean; status: number; cuerpo: { error: string } };
/** Resultado correcto del borrado. */
type Borrado = { ok: boolean; ruta: string };

const borrar = (opciones: Record<string, unknown>) =>
  borrarArchivo(opciones as never) as unknown as Promise<Borrado | Rechazo>;

let base = "";

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "mc-borrar-"));
});

afterAll(async () => {
  await fs.rm(base, { recursive: true, force: true });
});

// Cada prueba empieza con los mismos dos archivos: uno de un plugin y otro suelto en `plugins/`.
beforeEach(async () => {
  const plugins = path.join(base, "plugins");
  await fs.rm(plugins, { recursive: true, force: true });
  await fs.mkdir(path.join(plugins, "VTuberDex"), { recursive: true });
  await fs.writeFile(path.join(plugins, "VTuberDex", "config.yml"), "speed: 1\n");
  await fs.mkdir(path.join(plugins, "MMOItems", "datos.yml"), { recursive: true });
  await fs.writeFile(path.join(plugins, "MMOItems", "config.yml"), "a: 1\n");
  await fs.writeFile(path.join(plugins, "suelto.yml"), "a: 1\n");
});

const existe = (relativa: string) =>
  fs
    .stat(path.join(base, relativa))
    .then(() => true)
    .catch(() => false);

describe("borrarArchivo", () => {
  it("el admin borra el archivo y deja una copia .bak al lado", async () => {
    const r = await borrar({
      ruta: "plugins/suelto.yml",
      dir: base,
      rol: "admin",
    });
    expect(r).toEqual({ ok: true, ruta: "plugins/suelto.yml" });
    expect(await existe("plugins/suelto.yml")).toBe(false);
    expect(await fs.readFile(path.join(base, "plugins/suelto.yml.bak"), "utf8")).toBe(
      "a: 1\n",
    );
  });

  it("el mantenedor también borra (el equipo abrió la puerta a los mantenedores)", async () => {
    const r = await borrar({
      ruta: "plugins/VTuberDex/config.yml",
      dir: base,
      rol: "mantenedor",
    });
    expect(r).toEqual({ ok: true, ruta: "plugins/VTuberDex/config.yml" });
    expect(await existe("plugins/VTuberDex/config.yml")).toBe(false);
  });

  it("sin rol de admin ni mantenedor no borra nada", async () => {
    const r = (await borrar({
      ruta: "plugins/suelto.yml",
      dir: base,
      rol: "invitado",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(r.cuerpo.error).toBe("sin_permiso");
    expect(await existe("plugins/suelto.yml")).toBe(true);
  });

  it("el mantenedor no toca los archivos que llevan credenciales", async () => {
    const r = (await borrar({
      ruta: "plugins/VTuberDex/config.yml",
      dir: base,
      rol: "mantenedor",
    })) as Rechazo;
    expect(r.status).toBe(403);
    expect(r.cuerpo.error).toBe("solo_admin");
    expect(await existe("plugins/VTuberDex/config.yml")).toBe(true);
  });

  it("no borra fuera de la lista cerrada (mundos, registros, server.properties)", async () => {
    for (const ruta of ["server.properties", "world/level.dat", "logs/latest.log"]) {
      const r = (await borrar({ ruta, dir: base, rol: "admin" })) as Rechazo;
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
      expect(r.cuerpo.error).toBe("ruta_no_permitida");
    }
  });

  it("no se sale de la carpeta base con ..", async () => {
    const r = (await borrar({
      ruta: "plugins/../../etc/passwd",
      dir: base,
      rol: "admin",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toBe("ruta_invalida");
  });

  it("una carpeta no se borra como si fuera un archivo", async () => {
    const r = (await borrar({
      ruta: "plugins/VTuberDex",
      dir: base,
      rol: "admin",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(400);
    expect(r.cuerpo.error).toBe("no_es_archivo");
    expect(await existe("plugins/VTuberDex/config.yml")).toBe(true);
  });

  it("un archivo que ya no está responde «no existe»", async () => {
    const r = (await borrar({
      ruta: "plugins/no-esta.yml",
      dir: base,
      rol: "admin",
    })) as Rechazo;
    expect(r.ok).toBe(false);
    expect(r.status).toBe(404);
    expect(r.cuerpo.error).toBe("no_existe");
  });
});
