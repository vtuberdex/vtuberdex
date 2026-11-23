// @vitest-environment node
/**
 * Agente de archivos y terminal (`minecraft-agente/agente.mjs`) y las rutas que lo exponen
 * (`/api/minecraft-admin/fs`, `/terminal`). El agente corre de verdad en un socket temporal, sin
 * bubblewrap (`AGENTE_SANDBOX=ninguno`): aquí se prueba el contrato y los límites de rutas; la caja
 * se comprueba en la VPS.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as fsGET, POST as fsPOST, PUT as fsPUT } from "../app/api/minecraft-admin/fs/route.js";
import { GET as termLista, POST as termPOST } from "../app/api/minecraft-admin/terminal/route.js";
import {
  DELETE as termDELETE,
  GET as termSalida,
  POST as termEntrada,
} from "../app/api/minecraft-admin/terminal/[id]/route.js";
import { configDe, crearServidor, normalizarRelativa } from "../minecraft-agente/agente.mjs";
import { COOKIE_MANTENEDOR, crearSesionMantenedor } from "./minecraft-admin.mjs";
import { usarArchivoDeAuditoria } from "./minecraft-consola.mjs";
import { POST as pluginEstado } from "../app/api/minecraft-admin/plugins/estado/route.js";

const crearSesion = crearSesionMantenedor as unknown as (o: { email?: string; role?: string }) => string | null;

process.env.VTUBERDEX_ADMIN_EMAILS = "admin@example.com";
process.env.VTUBERDEX_MINECRAFT_MANTENEDORES = "mante@example.com";

const TOKEN = "t".repeat(40);
let base = "";
let raiz = "";
let servidor: Server;

const cookie = (email: string, role: string) =>
  `${COOKIE_MANTENEDOR}=${encodeURIComponent(crearSesion({ email, role }) ?? "")}`;
const ADMIN = cookie("admin@example.com", "admin");
const MANTE = cookie("mante@example.com", "mantenedor");

const pedir = (url: string, init: RequestInit & { quien?: string } = {}) =>
  new Request(`http://x${url}`, {
    ...init,
    headers: { cookie: init.quien ?? MANTE, ...(init.headers as Record<string, string>) },
  });
const conPanel = { "x-panel": "1" };

beforeAll(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "mc-agente-"));
  raiz = path.join(base, "srv");
  await fs.mkdir(path.join(raiz, "plugins", "Foo"), { recursive: true });
  await fs.writeFile(path.join(raiz, "plugins", "Foo", "config.yml"), "a: 1\n");
  await fs.writeFile(path.join(raiz, "server.properties"), "motd=Hola\n");
  await fs.writeFile(path.join(base, "secreto.txt"), "no\n");
  await fs.symlink(path.join(base, "secreto.txt"), path.join(raiz, "fuera"));
  const cfg = configDe(<NodeJS.ProcessEnv>(<unknown>{
    AGENTE_RAIZ: raiz,
    AGENTE_SOCKET: path.join(base, "a.sock"),
    AGENTE_TOKEN: TOKEN,
    AGENTE_SANDBOX: "ninguno",
  }));
  servidor = crearServidor(cfg);
  await new Promise<void>((ok) => servidor.listen(cfg.socket, ok));
  process.env.VTUBERDEX_MC_AGENTE_SOCKET = cfg.socket;
  process.env.VTUBERDEX_MC_AGENTE_TOKEN = TOKEN;
  usarArchivoDeAuditoria(path.join(base, "auditoria.log"));
});

afterAll(async () => {
  await new Promise((ok) => servidor.close(ok));
  delete process.env.VTUBERDEX_MC_AGENTE_SOCKET;
  delete process.env.VTUBERDEX_MC_AGENTE_TOKEN;
  usarArchivoDeAuditoria();
  await fs.rm(base, { recursive: true, force: true });
});

describe("rutas relativas", () => {
  it("normaliza y rechaza las que suben de la raíz", () => {
    expect(normalizarRelativa("")).toBe("");
    expect(normalizarRelativa("/plugins//Foo/")).toBe("plugins/Foo");
    expect(normalizarRelativa("plugins/../server.properties")).toBe("server.properties");
    expect(normalizarRelativa("../../etc/passwd")).toBe("etc/passwd");
    expect(() => normalizarRelativa("a\u0000b")).toThrow();
  });
});

describe("/api/minecraft-admin/fs", () => {
  it("sin sesión no pasa", async () => {
    const r = await fsGET(new Request("http://x/api/minecraft-admin/fs?op=listar"));
    expect(r.status).toBe(401);
  });

  it("el mantenedor ve TODA la carpeta, no solo plugins", async () => {
    const r = await fsGET(pedir("/api/minecraft-admin/fs?op=listar&ruta="));
    expect(r.status).toBe(200);
    const c = await r.json();
    expect(c.entradas.map((e: { nombre: string }) => e.nombre)).toEqual(["plugins", "fuera", "server.properties"]);
  });

  it("lee texto y no sigue un enlace que sale de la carpeta", async () => {
    const ok = await (await fsGET(pedir("/api/minecraft-admin/fs?op=leer&ruta=server.properties"))).json();
    expect(ok.contenido).toBe("motd=Hola\n");
    const fuera = await fsGET(pedir("/api/minecraft-admin/fs?op=leer&ruta=fuera"));
    expect(fuera.status).toBe(403);
    expect((await fuera.json()).error).toBe("fuera_de_la_carpeta");
  });

  it("lo que cambia algo exige X-Panel (CSRF)", async () => {
    const r = await fsPUT(pedir("/api/minecraft-admin/fs?ruta=x.txt", { method: "PUT", body: "hola" }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("falta_cabecera_del_panel");
  });

  it("guarda, detecta un cambio en disco y deja forzar", async () => {
    const leido = await (await fsGET(pedir("/api/minecraft-admin/fs?op=leer&ruta=plugins/Foo/config.yml"))).json();
    const guardado = await fsPUT(
      pedir(`/api/minecraft-admin/fs?ruta=plugins/Foo/config.yml&modificado=${leido.modificado}`, {
        method: "PUT",
        headers: conPanel,
        body: "a: 2\n",
      }),
    );
    expect(guardado.status).toBe(200);
    // Con la fecha vieja, otra escritura choca.
    const choque = await fsPUT(
      pedir(`/api/minecraft-admin/fs?ruta=plugins/Foo/config.yml&modificado=${leido.modificado - 5000}`, {
        method: "PUT",
        headers: conPanel,
        body: "a: 3\n",
      }),
    );
    expect(choque.status).toBe(409);
    const forzado = await fsPUT(
      pedir(`/api/minecraft-admin/fs?ruta=plugins/Foo/config.yml&modificado=1&forzar=1`, {
        method: "PUT",
        headers: conPanel,
        body: "a: 3\n",
      }),
    );
    expect(forzado.status).toBe(200);
    expect(await fs.readFile(path.join(raiz, "plugins/Foo/config.yml"), "utf8")).toBe("a: 3\n");
  });

  it("sube creando carpetas y no pisa sin permiso", async () => {
    const subir = (sobrescribir: boolean) =>
      fsPOST(
        pedir(`/api/minecraft-admin/fs?op=subir&ruta=plugins/Nuevo/sub/datos.bin${sobrescribir ? "&sobrescribir=1" : ""}`, {
          method: "POST",
          headers: conPanel,
          body: new Uint8Array([0, 1, 2, 3]),
        }),
      );
    expect((await subir(false)).status).toBe(201);
    expect((await subir(false)).status).toBe(409);
    expect((await subir(true)).status).toBe(201);
    expect((await fs.readFile(path.join(raiz, "plugins/Nuevo/sub/datos.bin"))).length).toBe(4);
  });

  it("mueve, cambia permisos, descomprime y borra; todo queda en la auditoría", async () => {
    const accion = (cuerpo: object) =>
      fsPOST(
        pedir("/api/minecraft-admin/fs", {
          method: "POST",
          headers: { ...conPanel, "content-type": "application/json" },
          body: JSON.stringify(cuerpo),
        }),
      );
    expect((await accion({ accion: "mover", de: "plugins/Nuevo", a: "plugins/Movido" })).status).toBe(200);
    expect((await accion({ accion: "mover", de: "plugins", a: "plugins/dentro" })).status).toBe(400);
    expect((await accion({ accion: "permisos", ruta: "plugins/Movido", modo: "750", recursivo: true })).status).toBe(200);
    expect(((await fs.stat(path.join(raiz, "plugins/Movido/sub"))).mode & 0o777).toString(8)).toBe("750");
    expect((await accion({ accion: "permisos", ruta: "plugins/Movido", modo: "9999" })).status).toBe(400);

    // Un zip con `../` no escribe fuera de la carpeta.
    const zipDir = path.join(base, "zip");
    await fs.mkdir(zipDir, { recursive: true });
    execFileSync("python3", [
      "-c",
      "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr('../../escapado.txt','x'); z.writestr('ok/a.yml','a: 1'); z.close()",
      path.join(raiz, "plugins/pack.zip"),
    ]);
    expect((await accion({ accion: "descomprimir", ruta: "plugins/pack.zip", destino: "plugins/Pack" })).status).toBe(200);
    expect(await fs.readFile(path.join(raiz, "plugins/Pack/ok/a.yml"), "utf8")).toBe("a: 1");
    await expect(fs.access(path.join(base, "escapado.txt"))).rejects.toThrow();

    expect((await accion({ accion: "borrar", rutas: ["plugins/Movido", "plugins/pack.zip"] })).status).toBe(200);
    expect((await accion({ accion: "borrar", rutas: [""] })).status).toBe(400);
    // Borrar el enlace borra el enlace, no lo apuntado.
    expect((await accion({ accion: "borrar", rutas: ["fuera"] })).status).toBe(200);
    expect(await fs.readFile(path.join(base, "secreto.txt"), "utf8")).toBe("no\n");

    const auditoria = await fs.readFile(path.join(base, "auditoria.log"), "utf8");
    expect(auditoria).toContain('"tipo":"archivo-mover"');
    expect(auditoria).toContain('"tipo":"archivo-borrar"');
    expect(auditoria).toContain("mante@example.com");
  });

  it("descarga una carpeta como .tar.gz", async () => {
    const r = await fsGET(pedir("/api/minecraft-admin/fs?op=descargar&ruta=plugins/Foo"));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toContain("Foo.tar.gz");
    const bytes = new Uint8Array(await r.arrayBuffer());
    expect([bytes[0], bytes[1]]).toEqual([0x1f, 0x8b]);
  });
});

describe("/api/minecraft-admin/terminal", () => {
  it("abre una shell en la carpeta, ejecuta y solo la ve quien la abrió", async () => {
    const abierta = await termPOST(
      pedir("/api/minecraft-admin/terminal", {
        method: "POST",
        headers: { ...conPanel, "content-type": "application/json" },
        body: JSON.stringify({ filas: 24, columnas: 80 }),
      }),
    );
    expect(abierta.status).toBe(201);
    const { id } = await abierta.json();
    const contexto = { params: Promise.resolve({ id }) };

    // Otra persona (aunque sea admin) no la lee.
    const ajena = await termSalida(pedir(`/api/minecraft-admin/terminal/${id}`, { quien: ADMIN }), contexto);
    expect(ajena.status).toBe(404);

    const salida = await termSalida(pedir(`/api/minecraft-admin/terminal/${id}`), contexto);
    expect(salida.headers.get("content-type")).toContain("text/event-stream");
    const lector = salida.body!.getReader();

    const enviada = await termEntrada(
      pedir(`/api/minecraft-admin/terminal/${id}?op=entrada`, {
        method: "POST",
        headers: conPanel,
        body: "echo MARCA-$((40+2)); pwd\r",
      }),
      contexto,
    );
    expect(enviada.status).toBe(200);

    let texto = "";
    const limite = Date.now() + 8000;
    while (Date.now() < limite && !(texto.includes("MARCA-42") && texto.includes(raiz))) {
      const { value, done } = await lector.read();
      if (done) {break;}
      for (const linea of new TextDecoder().decode(value).split("\n")) {
        if (linea.startsWith("data: ")) {texto += Buffer.from(linea.slice(6), "base64").toString("utf8");}
      }
    }
    expect(texto).toContain("MARCA-42");
    expect(texto).toContain(raiz);
    await lector.cancel();

    const tamano = await termEntrada(
      pedir(`/api/minecraft-admin/terminal/${id}?op=tamano`, {
        method: "POST",
        headers: { ...conPanel, "content-type": "application/json" },
        body: JSON.stringify({ filas: 40, columnas: 160 }),
      }),
      contexto,
    );
    expect(tamano.status).toBe(200);
    const mala = await termEntrada(
      pedir(`/api/minecraft-admin/terminal/${id}?op=otra`, { method: "POST", headers: conPanel }),
      contexto,
    );
    expect(mala.status).toBe(400);
    const lista = await (await termLista(pedir("/api/minecraft-admin/terminal"))).json();
    expect(lista.terminales.map((t: { id: string }) => t.id)).toContain(id);
    const deOtro = await (await termLista(pedir("/api/minecraft-admin/terminal", { quien: ADMIN }))).json();
    expect(deOtro.terminales).toEqual([]);
    const idMalo = await termSalida(pedir("/api/minecraft-admin/terminal/x"), {
      params: Promise.resolve({ id: "../x" }),
    });
    expect(idMalo.status).toBe(404);

    const cerrada = await termDELETE(pedir(`/api/minecraft-admin/terminal/${id}`, { method: "DELETE", headers: conPanel }), contexto);
    expect(cerrada.status).toBe(200);
  }, 15000);
});

describe("sin agente", () => {
  it("503 si no está configurado y 502 si no responde", async () => {
    const socket = process.env.VTUBERDEX_MC_AGENTE_SOCKET;
    try {
      delete process.env.VTUBERDEX_MC_AGENTE_SOCKET;
      const r = await fsGET(pedir("/api/minecraft-admin/fs?op=listar"));
      expect(r.status).toBe(503);
      process.env.VTUBERDEX_MC_AGENTE_SOCKET = path.join(base, "no-existe.sock");
      const caido = await fsGET(pedir("/api/minecraft-admin/fs?op=descargar&ruta=x"));
      expect(caido.status).toBe(502);
      expect((await fsGET(pedir("/api/minecraft-admin/fs?op=borrar"))).status).toBe(400);
    } finally {
      process.env.VTUBERDEX_MC_AGENTE_SOCKET = socket;
    }
  });

  it("acciones sin cuerpo válido y descarga de algo que no existe", async () => {
    const r = await fsPOST(
      pedir("/api/minecraft-admin/fs", { method: "POST", headers: conPanel, body: "no es json" }),
    );
    expect(r.status).toBe(400);
    const noHay = await fsGET(pedir("/api/minecraft-admin/fs?op=descargar&ruta=no-existe"));
    expect(noHay.status).toBe(404);
  });
});

describe("plugins/estado por el agente", () => {
  it("desactiva y activa renombrando como minecraft; repetir no falla; VTuberDex protegido", async () => {
    await fs.writeFile(path.join(raiz, "plugins", "Bar.jar"), "jar");
    const cambiar = (archivo: string, habilitado: boolean) =>
      pluginEstado(
        pedir("/api/minecraft-admin/plugins/estado", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archivo, habilitado }),
        }),
      );
    const apagado = await cambiar("Bar.jar", false);
    expect(apagado.status).toBe(200);
    expect((await apagado.json()).archivo).toBe("Bar.jar.disabled");
    await expect(fs.access(path.join(raiz, "plugins", "Bar.jar.disabled"))).resolves.toBeUndefined();
    const otraVez = await cambiar("Bar.jar", false);
    expect(otraVez.status).toBe(200);
    expect((await cambiar("Bar.jar.disabled", true)).status).toBe(200);
    await expect(fs.access(path.join(raiz, "plugins", "Bar.jar"))).resolves.toBeUndefined();
    expect((await cambiar("NoHay.jar", true)).status).toBe(404);
    expect((await cambiar("VTuberDex.jar", false)).status).toBe(403);
    expect((await cambiar("../x.jar", false)).status).toBe(400);
  });
});

describe("permisos con ACL", () => {
  const hayAcl = (() => {
    try {
      execFileSync("setfacl", ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

  it.skipIf(!hayAcl)("un chmod 600 no le quita la lectura a un usuario con nombre de la ACL", async () => {
    const archivo = path.join(raiz, "plugins", "Acl.jar");
    await fs.writeFile(archivo, "jar");
    const yo = os.userInfo().username;
    execFileSync("setfacl", ["-m", `u:${yo}:rw`, archivo]);
    const r = await fsPOST(
      pedir("/api/minecraft-admin/fs", {
        method: "POST",
        headers: { ...conPanel, "content-type": "application/json" },
        body: JSON.stringify({ accion: "permisos", ruta: "plugins/Acl.jar", modo: "600" }),
      }),
    );
    expect(r.status).toBe(200);
    const acl = execFileSync("getfacl", ["--absolute-names", archivo]).toString();
    // Sin el arreglo la máscara quedaba en «---» y el usuario de la ACL no leía.
    expect(acl).toMatch(/^mask::r--$/m);
    expect(acl).toMatch(/^group::/m);
  });
});
