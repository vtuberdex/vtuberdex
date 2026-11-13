// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  GET as archivosGET,
  PUT as archivosPUT,
} from "../app/api/minecraft-admin/archivos/route.js";
import {
  GET as consolaGET,
  POST as consolaPOST,
} from "../app/api/minecraft-admin/consola/route.js";
import {
  COOKIE_MANTENEDOR,
  crearSesionMantenedor,
} from "./minecraft-admin.mjs";
import { usarArchivoDeAuditoria } from "./minecraft-consola.mjs";

process.env.VTUBERDEX_ADMIN_EMAILS = "admin@example.com";
process.env.VTUBERDEX_MINECRAFT_MANTENEDORES = "mantenedor@example.com";

const crear = crearSesionMantenedor as unknown as (o: {
  email: string;
  role: string;
}) => string | null;
const cookie = (email: string, role: string) =>
  `${COOKIE_MANTENEDOR}=${encodeURIComponent(crear({ email, role }) ?? "")}`;
const MANT = cookie("mantenedor@example.com", "mantenedor");
const ADMIN = cookie("admin@example.com", "admin");
const req = (
  url: string,
  cookieHeader?: string,
  body?: unknown,
  method = "GET",
) =>
  new Request(url, {
    method,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeAll(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "mc-rutas-"));
  await fs.mkdir(path.join(base, "plugins", "MythicMobs"), { recursive: true });
  await fs.writeFile(
    path.join(base, "plugins", "MythicMobs", "config.yml"),
    "a: 1\n",
  );
  process.env.VTUBERDEX_MINECRAFT_DIR = base;
  usarArchivoDeAuditoria(path.join(base, "aud.log"));
});

describe("rutas de archivos y consola", () => {
  it("sin sesión: 401 en ambas", async () => {
    expect((await archivosGET(req("http://x/a"))).status).toBe(401);
    expect(
      (
        await consolaPOST(
          req("http://x/c", undefined, { comando: "list" }, "POST"),
        )
      ).status,
    ).toBe(401);
  });

  it("el mantenedor ve y edita la config anidada de un plugin", async () => {
    const lista = await (
      await archivosGET(req("http://x/a?carpeta=plugins/MythicMobs", MANT))
    ).json();
    expect(lista.archivos.map((a: { ruta: string }) => a.ruta)).toContain(
      "plugins/MythicMobs/config.yml",
    );
    const r = await archivosPUT(
      req(
        "http://x/a",
        MANT,
        { ruta: "plugins/MythicMobs/config.yml", contenido: "a: 2" },
        "PUT",
      ),
    );
    expect(r.status).toBe(200);
  });

  it("consola: el mantenedor no pasa `op`, el admin sí llega a RCON (sin configurar = 503)", async () => {
    const m = await consolaPOST(
      req("http://x/c", MANT, { comando: "op yo" }, "POST"),
    );
    expect(m.status).toBe(403);
    const a = await consolaPOST(
      req("http://x/c", ADMIN, { comando: "op yo" }, "POST"),
    );
    expect(a.status).toBe(503);
  });

  it("la auditoría solo la lee un admin y registra el rechazo", async () => {
    expect((await consolaGET(req("http://x/c", MANT))).status).toBe(403);
    const { eventos } = await (
      await consolaGET(req("http://x/c", ADMIN))
    ).json();
    expect(
      eventos.some((e: { tipo: string }) => e.tipo === "consola-rechazada"),
    ).toBe(true);
  });
});
