// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { resolverReto } from "@/lib/reto-pow";

describe("resolverReto (la prueba de trabajo que corre en el worker)", () => {
  it("devuelve un n cuyo sha256(reto:n) empieza con los ceros pedidos", async () => {
    const solucion = await resolverReto("reto-de-prueba", 8);
    const digest = createHash("sha256")
      .update(`reto-de-prueba:${solucion}`)
      .digest();
    expect(digest[0]).toBe(0);
  });
});
