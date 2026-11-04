// @vitest-environment node
import { describe, expect, it } from "vitest";

process.env.VTUBERDEX_ADMIN_EMAILS = "admin@example.com";
process.env.VTUBERDEX_MINECRAFT_MANTENEDORES = "mantenedor@example.com";

import {
  GET as experienciaGET,
  POST as experienciaPOST,
} from "../app/api/minecraft-admin/experiencia/route.js";
import {
  COOKIE_MANTENEDOR,
  crearSesionMantenedor as crearSesionSinTipos,
} from "./minecraft-admin.mjs";

const crearSesion = crearSesionSinTipos as unknown as (o: {
  email?: string;
}) => string | null;
const cookie = (email: string) =>
  `${COOKIE_MANTENEDOR}=${encodeURIComponent(crearSesion({ email }) ?? "")}`;
const req = (url: string, init: RequestInit & { c?: string } = {}) =>
  new Request(url, { ...init, headers: init.c ? { cookie: init.c } : {} });

describe("/api/minecraft-admin/experiencia: solo admin", () => {
  it("sin sesión: 401", async () => {
    expect(
      (
        await experienciaGET(
          req("http://x/api/minecraft-admin/experiencia?q=ana"),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await experienciaPOST(
          req("http://x/api/minecraft-admin/experiencia", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("el mantenedor que no es admin no puede ni buscar ni dar XP: 403", async () => {
    const c = cookie("mantenedor@example.com");
    expect(
      (
        await experienciaGET(
          req("http://x/api/minecraft-admin/experiencia?q=ana", { c }),
        )
      ).status,
    ).toBe(403);
    const r = await experienciaPOST(
      req("http://x/api/minecraft-admin/experiencia", {
        method: "POST",
        c,
        body: JSON.stringify({ ficha: 1, cantidad: 100, motivo: "no debería" }),
      }),
    );
    expect(r.status).toBe(403);
  });
});
