import { describe, expect, it } from "vitest";

import { POST as pluginsPOST } from "../app/api/minecraft-admin/plugins/route.js";
import {
  COOKIE_MANTENEDOR,
  LIMITE_JAR_BYTES,
  crearSesionMantenedor,
} from "./minecraft-admin.mjs";

const crearSesion = crearSesionMantenedor as unknown as (opciones: {
  email?: string;
  role?: string;
}) => string | null;

process.env.VTUBERDEX_ADMIN_EMAILS = "admin@example.com";

describe("plugins: tamaño anunciado", () => {
  it("corta con 413 si content-length supera el límite, sin leer el cuerpo", async () => {
    const token =
      crearSesion({ email: "admin@example.com", role: "admin" }) ?? "";
    const r = await pluginsPOST(
      new Request("http://x/api/minecraft-admin/plugins?nombre=Grande.jar", {
        method: "POST",
        headers: {
          cookie: `${COOKIE_MANTENEDOR}=${encodeURIComponent(token)}`,
          "content-length": String(LIMITE_JAR_BYTES + 1),
        },
        body: new Uint8Array([1, 2, 3]),
      }),
    );
    expect(r.status).toBe(413);
    const cuerpo = await r.json();
    expect(cuerpo.error).toBe("archivo_demasiado_grande");
    expect(cuerpo.limite).toBe(LIMITE_JAR_BYTES);
  });
});
