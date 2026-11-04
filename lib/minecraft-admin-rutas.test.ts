import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const enviados: Array<{ para: string; asunto: string; texto: string }> = [];

vi.mock("./correo.mjs", () => ({
  urlDelSitio: () => "https://vtuberdex.com",
  enviarCorreo: async (mensaje: { para: string; asunto: string; texto: string }) => {
    enviados.push(mensaje);
    return { ok: true };
  },
}));

import { GET as estadoGET } from "../app/api/minecraft-admin/estado/route.js";
import { POST as enlacePOST } from "../app/api/minecraft-admin/enlace/route.js";
import { POST as sesionPOST } from "../app/api/minecraft-admin/sesion/route.js";
import { POST as pluginsPOST } from "../app/api/minecraft-admin/plugins/route.js";
import { PUT as configPUT } from "../app/api/minecraft-admin/configuracion/route.js";
import {
  COOKIE_MANTENEDOR,
  __reiniciarEnlaces,
  crearSesionMantenedor,
} from "./minecraft-admin.mjs";

let base = "";

// El módulo es `.mjs` y no declara tipos: `crearSesionMantenedor` devuelve null sin un correo
// válido, así que se tipa aquí para pasar uno y cambiar solo el rol en cada prueba.
const crearSesion = crearSesionMantenedor as unknown as (opciones: {
  email?: string;
  role?: string;
}) => string | null;

const cookieDe = (role: string) => {
  const token = crearSesion({ email: "mantenedor@example.com", role }) ?? "";
  return `${COOKIE_MANTENEDOR}=${encodeURIComponent(token)}`;
};

const pedir = (url: string, init: RequestInit & { cookie?: string } = {}) => {
  const { cookie, ...resto } = init;
  return new Request(url, {
    ...resto,
    headers: {
      ...(resto.headers as Record<string, string> | undefined),
      ...(cookie ? { cookie } : {}),
    },
  });
};

const cookieDeRespuesta = (r: Response) =>
  (r.headers.get("set-cookie") ?? "").split(";")[0];

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "minecraft-admin-"));
  process.env.VTUBERDEX_MINECRAFT_DIR = base;
});

beforeEach(() => {
  __reiniciarEnlaces();
  enviados.length = 0;
});

describe("rol mantenedor", () => {
  it("sin sesión responde 401", async () => {
    const r = await estadoGET(pedir("http://x/api/minecraft-admin/estado"));
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe("sin_sesion");
  });

  it("otro rol recibe 403", async () => {
    const r = await estadoGET(
      pedir("http://x/api/minecraft-admin/estado", { cookie: cookieDe("admin") }),
    );
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("prohibido");
  });

  it("el rol mantenedor ve el estado", async () => {
    const r = await estadoGET(
      pedir("http://x/api/minecraft-admin/estado", { cookie: cookieDe("mantenedor") }),
    );
    expect(r.status).toBe(200);
    const cuerpo = await r.json();
    expect(Array.isArray(cuerpo.plugins)).toBe(true);
  });
});

describe("enlace mágico", () => {
  it("manda el correo y canjear el enlace abre una sesión de mantenedor", async () => {
    const alta = await enlacePOST(
      pedir("http://x/api/minecraft-admin/enlace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "mantenedor@example.com" }),
      }),
    );
    expect(alta.status).toBe(200);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe("mantenedor@example.com");

    const token = enviados[0].texto.match(/#t=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();

    const canje = await sesionPOST(
      pedir("http://x/api/minecraft-admin/sesion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(canje.status).toBe(200);
    expect((await canje.json()).role).toBe("mantenedor");

    const cookie = cookieDeRespuesta(canje);
    expect(cookie.startsWith(`${COOKIE_MANTENEDOR}=`)).toBe(true);

    const dentro = await estadoGET(
      pedir("http://x/api/minecraft-admin/estado", { cookie }),
    );
    expect(dentro.status).toBe(200);

    const otraVez = await sesionPOST(
      pedir("http://x/api/minecraft-admin/sesion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      }),
    );
    expect(otraVez.status).toBe(400);
  });

  it("rechaza un correo inválido", async () => {
    const r = await enlacePOST(
      pedir("http://x/api/minecraft-admin/enlace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "no-es-un-correo" }),
      }),
    );
    expect(r.status).toBe(400);
    expect(enviados).toHaveLength(0);
  });
});

describe("subida de plugins", () => {
  const subir = (nombre: string, bytes: Uint8Array, cookie: string) =>
    pluginsPOST(
      pedir(`http://x/api/minecraft-admin/plugins?nombre=${encodeURIComponent(nombre)}`, {
        method: "POST",
        body: bytes.slice().buffer as ArrayBuffer,
        cookie,
      }),
    );

  it("guarda un .jar y devuelve sus metadatos", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const r = await subir("mi-plugin.jar", bytes, cookieDe("mantenedor"));
    expect(r.status).toBe(201);
    const meta = await r.json();
    expect(meta.nombre).toBe("mi-plugin.jar");
    expect(meta.tamano).toBe(bytes.byteLength);
    const escrito = await fs.readFile(path.join(base, "plugins", "mi-plugin.jar"));
    expect(escrito.byteLength).toBe(bytes.byteLength);
  });

  it("rechaza con 415 una extensión que no es .jar", async () => {
    const r = await subir("notas.txt", new Uint8Array([1, 2, 3]), cookieDe("mantenedor"));
    expect(r.status).toBe(415);
    expect((await r.json()).error).toBe("extension_no_permitida");
  });

  it("rechaza con 413 un archivo por encima del límite", async () => {
    const grande = new Uint8Array(9 * 1024 * 1024);
    const r = await subir("enorme.jar", grande, cookieDe("mantenedor"));
    expect(r.status).toBe(413);
    expect((await r.json()).error).toBe("archivo_demasiado_grande");
  });

  it("sin rol mantenedor no escribe nada", async () => {
    const r = await subir("intruso.jar", new Uint8Array([1]), cookieDe("usuario"));
    expect(r.status).toBe(403);
    await expect(
      fs.access(path.join(base, "plugins", "intruso.jar")),
    ).rejects.toThrow();
  });
});

describe("configuración", () => {
  const guardar = (cuerpo: unknown, cookie: string) =>
    configPUT(
      pedir("http://x/api/minecraft-admin/configuracion", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cuerpo),
        cookie,
      }),
    );

  it("escribe el server.properties con los valores enviados", async () => {
    const contenido = "motd=VTuberDex\nmax-players=20\n";
    const r = await guardar({ tipo: "servidor", contenido }, cookieDe("mantenedor"));
    expect(r.status).toBe(200);
    const escrito = await fs.readFile(path.join(base, "server.properties"), "utf8");
    expect(escrito).toContain("motd=VTuberDex");
    expect(escrito).toContain("max-players=20");
  });

  it("escribe el yml de un plugin", async () => {
    const r = await guardar(
      { tipo: "plugin", archivo: "mi-plugin.yml", contenido: "precio: 10\nmoneda: euros\n" },
      cookieDe("mantenedor"),
    );
    expect(r.status).toBe(200);
    const escrito = await fs.readFile(path.join(base, "plugins", "mi-plugin.yml"), "utf8");
    expect(escrito).toContain("moneda: euros");
  });

  it("rechaza un server.properties con una línea rota", async () => {
    const r = await guardar(
      { tipo: "servidor", contenido: "motd=ok\nesto-no-tiene-igual\n" },
      cookieDe("mantenedor"),
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("linea_invalida");
  });

  it("un rol distinto no puede guardar", async () => {
    const r = await guardar({ tipo: "servidor", contenido: "motd=x\n" }, cookieDe("admin"));
    expect(r.status).toBe(403);
  });
});
