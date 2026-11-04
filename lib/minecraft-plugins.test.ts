import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  analizarPluginsCargados,
  cambiarEstadoPlugin,
  leerDatosDeJar,
  leerRegistro,
  listarPlugins,
} from "./minecraft-plugins.mjs";

/** Un zip mínimo con UNA entrada deflatada, como los que escribe Gradle. */
function zip(nombre: string, contenido: string) {
  const datos = zlib.deflateRawSync(Buffer.from(contenido));
  const n = Buffer.from(nombre);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(datos.length, 18);
  local.writeUInt32LE(contenido.length, 22);
  local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(datos.length, 20);
  central.writeUInt32LE(contenido.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE(0, 42);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(1, 8);
  fin.writeUInt16LE(1, 10);
  fin.writeUInt32LE(46 + n.length, 12);
  fin.writeUInt32LE(30 + n.length + datos.length, 16);
  return Buffer.concat([local, n, datos, central, n, fin]);
}

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "mc-"));
  await fs.mkdir(path.join(dir, "plugins", "Vault"), { recursive: true });
  await fs.mkdir(path.join(dir, "logs"));
  await fs.writeFile(
    path.join(dir, "plugins", "vault.jar"),
    zip(
      "plugin.yml",
      "name: Vault\nversion: '1.7'\ndescription: Economia\nauthors: [Ana, Beto]\n",
    ),
  );
  await fs.writeFile(
    path.join(dir, "plugins", "Vault", "config.yml"),
    "a: 1\n",
  );
  await fs.writeFile(path.join(dir, "plugins", "VTuberDex.jar"), "x");
});
afterEach(() => fs.rm(dir, { recursive: true, force: true }));

describe("plugins", () => {
  it("lee plugin.yml del jar", async () => {
    const d = await leerDatosDeJar(path.join(dir, "plugins", "vault.jar"));
    expect(d).toEqual({
      nombre: "Vault",
      version: "1.7",
      descripcion: "Economia",
      autores: ["Ana", "Beto"],
    });
  });

  it("un jar roto no rompe el listado", async () => {
    expect(
      await leerDatosDeJar(path.join(dir, "plugins", "VTuberDex.jar")),
    ).toBeNull();
  });

  it("lista con configuraciones y estado según lo cargado", async () => {
    const r = await listarPlugins({ dir, cargados: new Set(["Vault"]) });
    const v = r.plugins.find((p: { nombre: string }) => p.nombre === "Vault");
    expect(v).toMatchObject({
      version: "1.7",
      estado: "activo",
      configuraciones: ["Vault/config.yml"],
      protegido: false,
    });
    expect(
      r.plugins.find((p: { archivo: string }) => p.archivo === "VTuberDex.jar")
        .protegido,
    ).toBe(true);
    const sin = await listarPlugins({ dir, cargados: new Set() });
    expect(
      sin.plugins.find((p: { nombre: string }) => p.nombre === "Vault").estado,
    ).toBe("sin-cargar");
  });

  it("un jar que el panel no puede leer no se marca como pendiente de reinicio", async () => {
    const ruta = path.join(dir, "plugins", "vault.jar");
    await fs.chmod(ruta, 0o000);
    try {
      const r = await listarPlugins({ dir, cargados: new Set(["Vault"]) });
      const v = r.plugins.find(
        (p: { archivo: string }) => p.archivo === "vault.jar",
      );
      // Como root (CI en contenedor) chmod 000 no impide leer: solo se comprueba si de verdad falla.
      if (v.legible === false) expect(v.estado).toBe("sin-leer");
    } finally {
      await fs.chmod(ruta, 0o644);
    }
  });

  it("deshabilitar renombra el jar y habilitar lo devuelve", async () => {
    expect(
      (
        await cambiarEstadoPlugin({
          dir,
          archivo: "vault.jar",
          habilitado: false,
        })
      ).ok,
    ).toBe(true);
    await expect(
      fs.access(path.join(dir, "plugins", "vault.jar.disabled")),
    ).resolves.toBeUndefined();
    const l = await listarPlugins({ dir, cargados: new Set(["Vault"]) });
    expect(
      l.plugins.find((p: { nombre: string }) => p.nombre === "Vault").estado,
    ).toBe("pendiente-reinicio");
    expect(
      (
        await cambiarEstadoPlugin({
          dir,
          archivo: "vault.jar.disabled",
          habilitado: true,
        })
      ).ok,
    ).toBe(true);
    await expect(
      fs.access(path.join(dir, "plugins", "vault.jar")),
    ).resolves.toBeUndefined();
  });

  it("no apaga plugins de VTuberDex ni acepta rutas", async () => {
    expect(
      await cambiarEstadoPlugin({
        dir,
        archivo: "VTuberDex.jar",
        habilitado: false,
      }),
    ).toMatchObject({ ok: false, status: 403 });
    for (const archivo of ["../x.jar", "a/b.jar", "x.txt", ""]) {
      expect(
        await cambiarEstadoPlugin({ dir, archivo, habilitado: false }),
      ).toMatchObject({
        ok: false,
        status: 400,
      });
    }
  });

  it("analiza la respuesta de /plugins", () => {
    const t =
      "§fServer Plugins (3):\n§6Bukkit Plugins:\n §8- §aBlueMap§r, §aChunky§r\n §aVault\n";
    expect([...analizarPluginsCargados(t)].sort()).toEqual([
      "BlueMap",
      "Chunky",
      "Vault",
    ]);
  });
});

describe("registro", () => {
  beforeEach(() =>
    fs.writeFile(
      path.join(dir, "logs", "latest.log"),
      [
        "[12:00:00] [Server thread/INFO]: [Vault] Cargado",
        "[12:00:01] [Server thread/INFO]: [Otro] Hola 10.1.2.3:5555",
        "[12:00:02] [RCON Client /127.0.0.1 #1/INFO]: Thread RCON Client shutting down",
        "[12:00:03] [Server thread/WARN]: [Vault] Fallo",
        "java.lang.Error: x",
        "\tat a.b.C",
        "",
      ].join("\n"),
    ),
  );

  it("filtra por plugin, conserva la traza y descarta el ruido de RCON", async () => {
    const r = await leerRegistro({ dir, plugin: "Vault" });
    expect(r.lineas).toEqual([
      "[12:00:00] [Server thread/INFO]: [Vault] Cargado",
      "[12:00:03] [Server thread/WARN]: [Vault] Fallo",
      "java.lang.Error: x",
      "\tat a.b.C",
    ]);
  });

  it("sin filtro oculta IP y RCON", async () => {
    const r = await leerRegistro({ dir });
    expect(r.lineas.join("\n")).toContain("[ip]");
    expect(r.lineas.join("\n")).not.toContain("10.1.2.3");
    expect(r.lineas.join("\n")).not.toContain("RCON Client");
  });

  it("rechaza un nombre de plugin raro", async () => {
    expect(await leerRegistro({ dir, plugin: "../x" })).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
