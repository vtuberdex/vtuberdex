// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, describe, expect, it, vi } from "vitest";

const dir = mkdtempSync(path.join(tmpdir(), "sesion-admin-"));
const archivo = path.join(dir, "turso.db");
vi.stubEnv("TURSO_DATABASE_URL", `file:${archivo}`);
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("sesiones del mantenedor: en la base solo va la huella (auditoría 2026-11-19)", () => {
  it("el token no se guarda en claro y la sesión sigue funcionando", async () => {
    const { emitirSesion, leerSesion, cerrarSesion } =
      await import("@/lib/admin-auth.mjs");
    const token = (await emitirSesion({
      username: "admin@example.com",
      role: "admin",
    })) as string;
    expect(token).toBeTruthy();
    const filas = new DatabaseSync(archivo, { readOnly: true })
      .prepare("SELECT token FROM sesion_admin")
      .all() as { token: string }[];
    expect(filas).toHaveLength(1);
    expect(filas[0].token).not.toBe(token);
    expect(filas[0].token).toMatch(/^[0-9a-f]{64}$/);
    expect(await leerSesion(token)).toEqual({
      username: "admin@example.com",
      role: "admin",
    });
    expect(await cerrarSesion(token)).toBe(true);
    expect(await leerSesion(token)).toBeNull();
  });
});
