// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// El módulo es `.mjs` y no declara tipos: cada campo se comprueba a mano, así que aquí se
// tipa de forma laxa para que `tsc --noEmit` (job `validar` de CI) no se queje.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = (await import("@/lib/minecraft-admin.mjs")) as any;

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "minecraft-admin-lectura-"));
  await fs.mkdir(path.join(dir, "plugins"), { recursive: true });
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("listado del directorio de Minecraft", () => {
  it("lista los jars y los yml de plugins y si hay server.properties", async () => {
    await fs.writeFile(path.join(dir, "plugins", "b.jar"), "x");
    await fs.writeFile(path.join(dir, "plugins", "a.jar"), "y");
    await fs.writeFile(path.join(dir, "plugins", "config.yml"), "a: 1\n");
    await fs.writeFile(path.join(dir, "plugins", "notas.txt"), "no cuenta\n");
    await fs.writeFile(path.join(dir, "server.properties"), "motd=hola\n");

    const estado = await admin.listarMinecraft({ dir });
    expect(estado.plugins).toEqual(["a.jar", "b.jar"]);
    expect(estado.configuraciones).toEqual(["config.yml"]);
    expect(estado.servidor).toBe(true);
    expect(estado.directorio).toBe(dir);
  });

  it("devuelve listas vacías si el directorio todavía no existe", async () => {
    const estado = await admin.listarMinecraft({
      dir: path.join(dir, "no-existe"),
    });
    expect(estado.plugins).toEqual([]);
    expect(estado.configuraciones).toEqual([]);
    expect(estado.servidor).toBe(false);
  });
});

describe("lectura de la configuración guardada", () => {
  it("lee el server.properties del directorio", async () => {
    await fs.writeFile(
      path.join(dir, "server.properties"),
      "motd=hola\nmax-players=20\n",
    );

    const leido = await admin.leerConfiguracion({ tipo: "servidor", dir });
    expect(leido.ok).toBe(true);
    expect(leido.tipo).toBe("servidor");
    expect(leido.archivo).toBe("server.properties");
    expect(leido.contenido).toContain("motd=hola");
  });

  it("lee el yml de un plugin dentro de plugins/", async () => {
    await fs.writeFile(path.join(dir, "plugins", "suerte.yml"), "suerte: 2\n");

    const leido = await admin.leerConfiguracion({
      tipo: "plugin",
      archivo: "suerte.yml",
      dir,
    });
    expect(leido.ok).toBe(true);
    expect(leido.archivo).toBe("suerte.yml");
    expect(leido.contenido).toContain("suerte: 2");
  });

  it("responde 404 cuando el archivo no está en disco", async () => {
    const servidor = await admin.leerConfiguracion({ tipo: "servidor", dir });
    expect(servidor.ok).toBe(false);
    expect(servidor.status).toBe(404);
    expect(servidor.cuerpo.error).toBe("no_existe");

    const plugin = await admin.leerConfiguracion({
      tipo: "plugin",
      archivo: "nada.yml",
      dir,
    });
    expect(plugin.ok).toBe(false);
    expect(plugin.status).toBe(404);
    expect(plugin.cuerpo.error).toBe("no_existe");
  });

  it("rechaza un tipo que no es servidor ni plugin", async () => {
    const malo = await admin.leerConfiguracion({ tipo: "otro", dir });
    expect(malo.ok).toBe(false);
    expect(malo.status).toBe(400);
    expect(malo.cuerpo.error).toBe("tipo_invalido");
  });

  it("rechaza un yml con rutas, con otra extensión o sin nombre", async () => {
    for (const archivo of [
      "../fuera.yml",
      "a/b/config.yml",
      "../a/config.yml",
      ".oculto/config.yml",
      "config.txt",
      "",
    ]) {
      const malo = await admin.leerConfiguracion({
        tipo: "plugin",
        archivo,
        dir,
      });
      expect(malo.ok).toBe(false);
      expect(malo.status).toBe(400);
      expect(malo.cuerpo.error).toBe("archivo_invalido");
    }
  });
});

describe("metadatos de un jar subido", () => {
  it("devuelve nombre, tamaño en bytes y la fecha de subida", () => {
    const meta = admin.metadatosJar({
      nombre: "mi-plugin.jar",
      tamano: 12,
      ruta: "/tmp/mi-plugin.jar",
      ahora: 0,
    });
    expect(meta).toEqual({
      nombre: "mi-plugin.jar",
      tamano: 12,
      bytes: 12,
      ruta: "/tmp/mi-plugin.jar",
      subidoEn: new Date(0).toISOString(),
    });
  });
});

describe("rechazos al guardar configuración", () => {
  it("rechaza un tipo que no es servidor ni plugin", async () => {
    const malo = await admin.guardarConfiguracion({
      tipo: "otro",
      contenido: "a=1\n",
      dir,
    });
    expect(malo.ok).toBe(false);
    expect(malo.status).toBe(400);
    expect(malo.cuerpo.error).toBe("tipo_invalido");
  });

  it("rechaza un contenido vacío y uno por encima del límite", async () => {
    const vacio = await admin.guardarConfiguracion({
      tipo: "servidor",
      contenido: "   ",
      dir,
    });
    expect(vacio.ok).toBe(false);
    expect(vacio.status).toBe(400);

    const grande = "a=1\n".repeat(admin.LIMITE_CONFIG_BYTES);
    const pesado = await admin.guardarConfiguracion({
      tipo: "servidor",
      contenido: grande,
      dir,
    });
    expect(pesado.ok).toBe(false);
    expect(pesado.status).toBe(413);
    expect(pesado.cuerpo.error).toBe("configuracion_demasiado_grande");
  });
});

describe("rechazos al validar un jar", () => {
  it("rechaza un nombre vacío y un archivo de cero bytes", () => {
    const sinNombre = admin.validarJar({ nombre: "   ", tamano: 10 });
    expect(sinNombre.ok).toBe(false);
    expect(sinNombre.cuerpo.error).toBe("falta_nombre");

    const vacio = admin.validarJar({ nombre: "a.jar", tamano: 0 });
    expect(vacio.ok).toBe(false);
    expect(vacio.status).toBe(400);
    expect(vacio.cuerpo.error).toBe("archivo_vacio");
  });
});

describe("saneado de rutas: lo que nunca llega a ser ruta", () => {
  it("rechaza caracteres de control, dos puntos, .. y separadores", () => {
    for (const nombre of [
      "a\u0000.jar",
      "a\u007f.jar",
      "C:plugin.jar",
      "..",
      "a/b.jar",
      "a\\b.jar",
    ]) {
      const r = admin.resolverRutaEnBase(nombre, { base: dir });
      expect(r.ok).toBe(false);
      expect(r.status).toBe(400);
      expect(r.cuerpo.error).toBe("nombre_invalido");
    }
  });

  it("rechaza un nombre que empieza por punto o por guion y uno demasiado largo", () => {
    for (const nombre of [
      ".oculto.jar",
      "-rf.jar",
      "a".repeat(admin.LIMITE_NOMBRE_ARCHIVO + 1),
    ]) {
      const r = admin.resolverRutaEnBase(nombre, { base: dir });
      expect(r.ok).toBe(false);
      expect(r.cuerpo.error).toBe("nombre_invalido");
    }
  });
});
