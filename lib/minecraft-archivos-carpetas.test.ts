// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  falloDeEscritura,
  guardarArchivo,
  listarCarpeta,
  validarCarpetaRelativa,
} from "./minecraft-archivos.mjs";

/** Resultado correcto de `listarCarpeta`: es el único que trae `carpetas` y `archivos`. */
type Listado = {
  ok: boolean;
  ruta: string;
  migas: { nombre: string; ruta: string }[];
  carpetas: { nombre: string; ruta: string }[];
  archivos: { nombre: string; ruta: string; escribible: boolean; legible: boolean }[];
  escribible: boolean;
  legible: boolean;
};

/** Resultado de rechazo (o de guardado fallido). */
type Rechazo = {
  ok: boolean;
  status: number;
  cuerpo: { error: string; detail?: string };
};

/** Lista una carpeta dejando el tipo ya estrechado. */
const listar = (opciones: Record<string, unknown>) =>
  listarCarpeta(opciones as never) as unknown as Promise<Listado>;

/** Igual, pero cuando se espera un rechazo. */
const rechaza = (opciones: Record<string, unknown>) =>
  listarCarpeta(opciones as never) as unknown as Promise<Rechazo>;

let base = "";
const w = (rel: string, txt: string) =>
  fs
    .mkdir(path.dirname(path.join(base, rel)), { recursive: true })
    .then(() => fs.writeFile(path.join(base, rel), txt));

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "mc-carpetas-"));
  await w("bukkit.yml", "a: 1\n");
  await w("config/paper-global.yml", "p: 1\n");
  await w("config/otro.yml", "o: 1\n");
  await w("plugins/MythicMobs/config.yml", "x: 1\n");
  await w("plugins/MythicMobs/Skills/a.yml", "s: 1\n");
  await w("plugins/VTuberDex/config.yml", "token: secreto\n");
  await w("plugins/VTuberDex/extra.yml", "token: secreto\n");
  await w("plugins/dynmap/config.yml", "d: 1\n");
  await w("plugins/Solo/config.yml", "solo: 1\n");
  await w("world/level.dat", "x");
});
afterAll(async () => {
  await fs.chmod(path.join(base, "plugins", "Solo"), 0o755).catch(() => {});
  await fs.rm(base, { recursive: true, force: true });
});

const rutas = (lista: { ruta: string }[]) => lista.map((x) => x.ruta);

describe("explorador por carpetas", () => {
  it("la raíz ofrece las carpetas navegables y los yml sueltos de la raíz", async () => {
    const r = await listar({ dir: base, rol: "mantenedor" });
    expect(r.ok).toBe(true);
    expect(rutas(r.carpetas)).toEqual(["plugins", "config"]);
    // `config/` no se lista como archivo suelto: se entra en su carpeta.
    expect(rutas(r.archivos)).toEqual(["bukkit.yml"]);
    expect(r.escribible).toBe(true);
  });

  it("dentro de plugins/ solo salen carpetas de configuración, sin las omitidas ni los secretos", async () => {
    const r = await listar({ dir: base, ruta: "plugins", rol: "mantenedor" });
    expect(rutas(r.carpetas)).toEqual(["plugins/MythicMobs", "plugins/Solo"]);
    expect(r.migas.map((m) => m.nombre)).toEqual(["plugins"]);
  });

  it("el admin sí ve la carpeta del plugin que lleva el token", async () => {
    const r = await listar({ dir: base, ruta: "plugins", rol: "admin" });
    expect(rutas(r.carpetas)).toContain("plugins/VTuberDex");
    const dentro = await listar({
      dir: base,
      ruta: "plugins/VTuberDex",
      rol: "admin",
    });
    expect(rutas(dentro.archivos)).toContain("plugins/VTuberDex/config.yml");
  });

  it("una carpeta de plugin trae sus archivos y sus subcarpetas", async () => {
    const r = await listar({
      dir: base,
      ruta: "plugins/MythicMobs",
      rol: "mantenedor",
    });
    expect(rutas(r.archivos)).toEqual(["plugins/MythicMobs/config.yml"]);
    expect(rutas(r.carpetas)).toEqual(["plugins/MythicMobs/Skills"]);
    expect(r.archivos[0].escribible).toBe(true);
  });

  it("config/ solo muestra los yml de Paper de la lista cerrada", async () => {
    const r = await listar({ dir: base, ruta: "config", rol: "mantenedor" });
    expect(rutas(r.archivos)).toEqual(["config/paper-global.yml"]);
  });

  it("rechaza carpetas fuera de lo permitido", async () => {
    for (const ruta of ["world", "logs", "../etc", "plugins/../../x"]) {
      const r = await rechaza({ dir: base, ruta, rol: "mantenedor" });
      expect(r.ok).toBe(false);
    }
    const mantenedor = await rechaza({
      dir: base,
      ruta: "plugins/VTuberDex",
      rol: "mantenedor",
    });
    expect(mantenedor.ok).toBe(false);
    expect(mantenedor.status).toBe(403);
    expect(validarCarpetaRelativa("", "mantenedor")).toEqual({
      ok: true,
      relativa: "",
    });
  });
});

describe("guardar sin permiso de escritura", () => {
  it("traduce el fallo del sistema a un aviso entendible", () => {
    expect(falloDeEscritura({ code: "EACCES" })).toMatchObject({
      ok: false,
      status: 403,
      cuerpo: { error: "sin_permiso_escritura" },
    });
    expect(falloDeEscritura({ code: "EROFS" }).status).toBe(403);
    expect(falloDeEscritura({ code: "ENOSPC" }).status).toBe(507);
    expect(falloDeEscritura({ code: "EIO" })).toMatchObject({
      status: 500,
      cuerpo: { error: "no_se_pudo_guardar" },
    });
  });

  const esRoot =
    typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(esRoot)(
    "una carpeta de solo lectura responde «sin permiso», no un 500",
    async () => {
      await fs.chmod(path.join(base, "plugins", "Solo"), 0o555);
      const r = (await guardarArchivo({
        dir: base,
        ruta: "plugins/Solo/config.yml",
        contenido: "solo: 2\n",
        rol: "mantenedor",
      })) as unknown as Rechazo;
      expect(r.ok).toBe(false);
      expect(r.status).toBe(403);
      expect(r.cuerpo.error).toBe("sin_permiso_escritura");
      await fs.chmod(path.join(base, "plugins", "Solo"), 0o755);
    },
  );
});
