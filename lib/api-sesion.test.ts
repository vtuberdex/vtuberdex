import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import { DEFAULT_SEARCH } from "./query";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

afterEach(() => vi.unstubAllGlobals());

describe("sesión de visitante en el cliente", () => {
  it("ante 401 sesion_requerida abre la sesión (reto + prueba) y repite la petición una vez", async () => {
    const llamadas: string[] = [];
    let sesion = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        llamadas.push(`${init?.method ?? "GET"} ${url}`);
        if (url === "/api/sesion" && !init?.method)
          return json(200, { reto: "1.a.b", bits: 1 });
        if (url === "/api/sesion") {
          sesion = true;
          return new Response(null, { status: 204 });
        }
        return sesion
          ? json(200, {
              items: [],
              total: 0,
              page: 1,
              perPage: 8,
              pageCount: 0,
              facets: null,
            })
          : json(401, { error: "sesion_requerida" });
      }),
    );
    const r = await api.list(DEFAULT_SEARCH);
    expect(r.total).toBe(0);
    expect(
      llamadas.filter((l) => l.startsWith("GET /api/vtubers")),
    ).toHaveLength(2);
    expect(llamadas).toContain("POST /api/sesion");
  });

  it("si tras abrir la sesión sigue el 401, falla en vez de repetir sin fin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/sesion" && !init?.method)
          return json(200, { reto: "1.a.b", bits: 1 });
        if (url === "/api/sesion") return new Response(null, { status: 204 });
        return json(401, { error: "sesion_requerida" });
      }),
    );
    await expect(api.list(DEFAULT_SEARCH)).rejects.toMatchObject({
      status: 401,
    });
  });
});
