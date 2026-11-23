// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { ejecutorSqlite } from "@/server/src/solicitudes.mjs";
import { correoDelToken, crearToken } from "@/server/src/verificacion.mjs";

describe("enlace de «Mi ficha»: pedir uno nuevo anula los anteriores (auditoría 2026-11-19)", () => {
  it("el viejo deja de valer, el nuevo vale, y otros propósitos no se tocan", async () => {
    const e = ejecutorSqlite(new DatabaseSync(":memory:"));
    const email = "luna@example.com";
    const viejo = await crearToken(e, { proposito: "ficha", email });
    const codigo = await crearToken(e, { proposito: "modificacion", email });
    expect((await correoDelToken(e, viejo, "ficha"))?.email ?? null).toBe(
      email,
    );

    const nuevo = await crearToken(e, { proposito: "ficha", email });
    expect((await correoDelToken(e, viejo, "ficha"))?.email ?? null).toBeNull();
    expect((await correoDelToken(e, nuevo, "ficha"))?.email ?? null).toBe(
      email,
    );
    expect(
      (await correoDelToken(e, codigo, "modificacion"))?.email ?? null,
    ).toBe(email);
  });
});
