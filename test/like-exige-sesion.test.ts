// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Si la ruta pasara la sesión, llegaría a la base: que se note.
const darLike = vi.hoisted(() => vi.fn());
vi.mock("@/lib/likes.mjs", async (original) => ({
  ...(await original<typeof import("@/lib/likes.mjs")>()),
  darLike,
}));

const { POST } = await import("@/app/api/vtubers/[slug]/like/route.js");

describe("POST like: exige la sesión de visitante (auditoría 2026-11-19)", () => {
  it("sin cookie de sesión responde 401 sesion_requerida y no toca los likes", async () => {
    const respuesta = await POST(
      new Request("http://local/api/vtubers/alguien/like", {
        method: "POST",
        headers: {
          "x-real-ip": "203.0.113.9",
          "x-forwarded-for": "6.6.6.6, 203.0.113.9",
          "user-agent": "Mozilla/5.0",
        },
      }),
      { params: Promise.resolve({ slug: "alguien" }) },
    );
    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ error: "sesion_requerida" });
    expect(darLike).not.toHaveBeenCalled();
  });
});
