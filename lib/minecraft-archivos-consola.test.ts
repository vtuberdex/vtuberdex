// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  guardarArchivo,
  leerArchivo,
  listarArchivos,
  validarRutaRelativa,
} from "./minecraft-archivos.mjs";
import {
  anotarAuditoria,
  leerAuditoria,
  prepararComando,
  usarArchivoDeAuditoria,
} from "./minecraft-consola.mjs";

let base = "";
const w = (rel: string, txt: string) =>
  fs
    .mkdir(path.dirname(path.join(base, rel)), { recursive: true })
    .then(() => fs.writeFile(path.join(base, rel), txt));

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "mc-arch-"));
  await w("bukkit.yml", "a: 1\n");
  await w("plugins/MythicMobs/config.yml", "x: 1\n");
  await w("plugins/MythicMobs/Skills/a/b.yml", "s: 1\n");
  await w("plugins/VTuberDex/config.yml", "token: secreto\n");
  await w("plugins/Foo.jar", "jar");
  await w("world/level.dat", "x");
  await fs.symlink("/etc", path.join(base, "plugins", "enlace"));
});
afterAll(() => fs.rm(base, { recursive: true, force: true }));

describe("archivos", () => {
  it("lista plugins anidados y la raíz permitida, sin jars ni secretos para el mantenedor", async () => {
    const { archivos } = await listarArchivos({ dir: base, rol: "mantenedor" });
    const rutas = archivos.map((a: { ruta: string }) => a.ruta);
    expect(rutas).toContain("bukkit.yml");
    expect(rutas).toContain("plugins/MythicMobs/config.yml");
    expect(rutas).toContain("plugins/MythicMobs/Skills/a/b.yml");
    expect(rutas).not.toContain("plugins/Foo.jar");
    expect(rutas).not.toContain("plugins/VTuberDex/config.yml");
    const admin = await listarArchivos({ dir: base, rol: "admin" });
    expect(admin.archivos.map((a: { ruta: string }) => a.ruta)).toContain(
      "plugins/VTuberDex/config.yml",
    );
  });

  it("rechaza escapes, carpetas fuera de la lista y jars", () => {
    for (const r of [
      "../etc/passwd",
      "plugins/../x.yml",
      "world/level.dat",
      "server.properties",
      "plugins/A/x.jar",
      "/etc/passwd",
      "plugins/.oculto/x.yml",
    ]) {
      expect(validarRutaRelativa(r, "admin").ok).toBe(false);
    }
    expect(
      validarRutaRelativa("plugins/VTuberDex/config.yml", "mantenedor"),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("un enlace simbólico no saca la lectura de la base", async () => {
    const r = await leerArchivo({
      ruta: "plugins/enlace/hostname.yml",
      dir: base,
      rol: "admin",
    });
    expect(r.ok).toBe(false);
  });

  it("guarda con .bak, valida JSON y tabuladores", async () => {
    const ok = await guardarArchivo({
      ruta: "bukkit.yml",
      contenido: "a: 2",
      dir: base,
      rol: "mantenedor",
    });
    expect(ok.ok).toBe(true);
    expect(await fs.readFile(path.join(base, "bukkit.yml.bak"), "utf8")).toBe(
      "a: 1\n",
    );
    expect(await fs.readFile(path.join(base, "bukkit.yml"), "utf8")).toBe(
      "a: 2\n",
    );
    expect(
      (
        await guardarArchivo({
          ruta: "bukkit.yml",
          contenido: "a:\n\tb: 1",
          dir: base,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await guardarArchivo({
          ruta: "plugins/X/d.json",
          contenido: "{rota",
          dir: base,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await guardarArchivo({
          ruta: "plugins/VTuberDex/config.yml",
          contenido: "a: 1",
          dir: base,
          rol: "mantenedor",
        })
      ).ok,
    ).toBe(false);
  });
});

describe("consola", () => {
  it("admin: cualquier comando; barra inicial fuera; sin saltos de línea", () => {
    expect(prepararComando("/op Pepe", "admin")).toMatchObject({
      ok: true,
      comando: "op Pepe",
    });
    expect(prepararComando("say a\nop b", "admin").ok).toBe(false);
    expect(prepararComando("  ", "admin").ok).toBe(false);
  });

  it("mantenedor: solo la lista blanca, sin atajos de espacio de nombres", () => {
    expect(prepararComando("mm reload", "mantenedor").ok).toBe(true);
    expect(prepararComando("/MM reload", "mantenedor").ok).toBe(true);
    for (const c of [
      "op x",
      "minecraft:op x",
      "execute run op x",
      "stop",
      "lp user x permission set *",
      "mm:reload",
    ]) {
      expect(prepararComando(c, "mantenedor")).toMatchObject({
        ok: false,
        status: 403,
      });
    }
  });

  it("el entorno amplía la lista pero nunca abre op/execute/stop", () => {
    const env = {
      VTUBERDEX_MINECRAFT_CONSOLA_PREFIJOS: "mmoitems, op, execute",
    } as unknown as NodeJS.ProcessEnv;
    expect(prepararComando("mmoitems reload", "mantenedor", env).ok).toBe(true);
    expect(prepararComando("op x", "mantenedor", env).ok).toBe(false);
    expect(prepararComando("execute as x", "mantenedor", env).ok).toBe(false);
  });

  it("la auditoría anota una línea por evento y no se deja forjar otra", async () => {
    const env = {
      VTUBERDEX_MINECRAFT_AUDITORIA: path.join(base, "aud", "a.log"),
    } as unknown as NodeJS.ProcessEnv;
    await anotarAuditoria(
      {
        quien: "a@b.c",
        rol: "admin",
        tipo: "consola",
        detalle: 'say hola\n{"falso":1}',
        ok: true,
      },
      env,
    );
    const e = await leerAuditoria({ env });
    expect(e).toHaveLength(1);
    expect(e[0].detalle).not.toContain("\n");
  });
});
