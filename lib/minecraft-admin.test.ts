import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// El módulo es `.mjs` y no declara tipos: la prueba comprueba cada campo a mano, así que
// aquí se tipa de forma laxa para que `tsc --noEmit` (job `validar` de CI) no se queje de
// las uniones de resultado.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = (await import("@/lib/minecraft-admin.mjs")) as any;
const correo = await import("@/lib/correo.mjs");

let enviados: Array<Record<string, unknown>> = [];
let dir: string;

beforeEach(async () => {
  admin.__reiniciarEnlaces();
  enviados = [];
  correo.__usarTransporte({
    sendMail: async (mensaje: Record<string, unknown>) => {
      enviados.push(mensaje);
      return { messageId: "prueba" };
    },
  });
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "minecraft-admin-"));
});

afterEach(async () => {
  correo.__usarTransporte(null);
  await fs.rm(dir, { recursive: true, force: true });
});

describe("rol mantenedor y acceso a /minecraft-admin", () => {
  it("deja pasar a quien tiene el rol mantenedor", () => {
    expect(admin.ROL_MANTENEDOR).toBe("mantenedor");
    expect(admin.autorizar({ username: "a@a.cl", role: "mantenedor" })).toEqual({ ok: true });
    expect(admin.autorizar({ user: { role: "mantenedor" } })).toEqual({ ok: true });
  });

  it("responde 403 a cualquier otro rol", () => {
    const respuesta = admin.autorizar({ username: "a@a.cl", role: "usuario" });
    expect(respuesta.ok).toBe(false);
    expect(respuesta.status).toBe(403);
    expect(respuesta.cuerpo.error).toBe("prohibido");
  });

  it("responde 401 sin sesión", () => {
    expect(admin.autorizar(null).status).toBe(401);
  });
});

describe("enlace mágico del mantenedor", () => {
  it("envía el correo con el enlace y canjearlo crea una sesión de mantenedor", async () => {
    const alta = await admin.enviarEnlaceMantenedor({ email: "Mantenedor@Example.com" });
    expect(alta.ok).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(String(enviados[0].to)).toBe("mantenedor@example.com");

    const cuerpo = String(enviados[0].text);
    const encontrado = cuerpo.match(/\/minecraft-admin#t=([A-Za-z0-9_-]+)/);
    expect(encontrado).not.toBeNull();
    const token = encontrado![1];

    const canje = admin.canjearEnlace(token);
    expect(canje.ok).toBe(true);
    expect(canje.sesion.role).toBe("mantenedor");
    expect(canje.sesion.email).toBe("mantenedor@example.com");
    // El enlace recién creado da acceso al mantenedor de verdad.
    expect(admin.autorizar(canje.sesion)).toEqual({ ok: true });
  });

  it("rechaza el enlace usado por segunda vez y el caducado", async () => {
    await admin.enviarEnlaceMantenedor({ email: "a@example.com" });
    expect(enviados).toHaveLength(1);
    const token = String(enviados[0].text).match(/#t=([A-Za-z0-9_-]+)/)![1];
    expect(admin.canjearEnlace(token).ok).toBe(true);
    expect(admin.canjearEnlace(token).cuerpo.error).toBe("enlace_invalido");

    const caduco = admin.emitirEnlace({ email: "b@example.com", ahora: 1_000 }) as {
      ok: true;
      token: string;
    };
    const tarde = admin.canjearEnlace(caduco.token, {
      ahora: 1_000 + admin.VIGENCIA_ENLACE_MS + 1,
    });
    expect(tarde.ok).toBe(false);
    expect(tarde.cuerpo.error).toBe("enlace_caducado");
  });

  it("no manda correo si la dirección no es válida", async () => {
    const alta = await admin.enviarEnlaceMantenedor({ email: "no-es-un-correo" });
    expect(alta.ok).toBe(false);
    expect(alta.status).toBe(400);
    expect(enviados).toHaveLength(0);
  });
});

describe("subida de plugins", () => {
  it("acepta un .jar y devuelve sus metadatos", async () => {
    const contenido = new Uint8Array([80, 75, 3, 4, 1, 2, 3]);
    const guardado = await admin.guardarJar({ nombre: "mi-plugin.jar", contenido, dir });
    expect(guardado.ok).toBe(true);
    expect(guardado.metadatos.nombre).toBe("mi-plugin.jar");
    expect(guardado.metadatos.tamano).toBe(contenido.byteLength);
    const enDisco = await fs.readFile(path.join(dir, "plugins", "mi-plugin.jar"));
    expect(enDisco.byteLength).toBe(contenido.byteLength);
  });

  it("rechaza una extensión que no sea .jar", async () => {
    const revision = admin.validarJar({ nombre: "plugin.zip", tamano: 10 });
    expect(revision.ok).toBe(false);
    expect(revision.status).toBe(415);
    expect(revision.cuerpo.error).toBe("extension_no_permitida");
  });

  it("rechaza un archivo por encima del límite y un nombre con rutas", () => {
    const grande = admin.validarJar({ nombre: "grande.jar", tamano: admin.LIMITE_JAR_BYTES + 1 });
    expect(grande.ok).toBe(false);
    expect(grande.status).toBe(413);

    const ruta = admin.validarJar({ nombre: "../../etc/passwd.jar", tamano: 10 });
    expect(ruta.ok).toBe(false);
    expect(ruta.status).toBe(400);
  });
});

describe("configuración del servidor y del plugin", () => {
  it("guarda server.properties con los valores enviados", async () => {
    const texto = "motd=Hola VTuberDex\nmax-players=20\nonline-mode=true\n";
    const guardado = await admin.guardarConfiguracion({ tipo: "servidor", contenido: texto, dir });
    expect(guardado.ok).toBe(true);
    const escrito = await fs.readFile(path.join(dir, "server.properties"), "utf8");
    expect(escrito).toBe(texto);
    expect(admin.analizarServerProperties(escrito).valores["max-players"]).toBe("20");
  });

  it("no escribe nada si el server.properties tiene una línea rota", async () => {
    const guardado = await admin.guardarConfiguracion({
      tipo: "servidor",
      contenido: "motd=Hola\nesto no tiene igual\n",
      dir,
    });
    expect(guardado.ok).toBe(false);
    expect(guardado.status).toBe(400);
    await expect(fs.readFile(path.join(dir, "server.properties"), "utf8")).rejects.toThrow();
  });

  it("guarda el yml del plugin y rechaza tabuladores de indentación", async () => {
    const yml = "mensaje: hola\ncolor: rojo\n";
    const guardado = await admin.guardarConfiguracion({
      tipo: "plugin",
      contenido: yml,
      archivo: "mi-plugin.yml",
      dir,
    });
    expect(guardado.ok).toBe(true);
    expect(await fs.readFile(path.join(dir, "plugins", "mi-plugin.yml"), "utf8")).toBe(yml);

    const roto = await admin.guardarConfiguracion({
      tipo: "plugin",
      contenido: "\tmensaje: hola\n",
      archivo: "otro.yml",
      dir,
    });
    expect(roto.ok).toBe(false);
    expect(roto.status).toBe(400);
  });

  it("rechaza un archivo de configuración con rutas", async () => {
    const guardado = await admin.guardarConfiguracion({
      tipo: "plugin",
      contenido: "a: b\n",
      archivo: "../fuera.yml",
      dir,
    });
    expect(guardado.ok).toBe(false);
    expect(guardado.status).toBe(400);
  });
});
