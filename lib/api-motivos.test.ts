/**
 * El motivo que ve la persona cuando la API dice que no. Antes cualquier fallo raro (sin red, una respuesta que
 * no era JSON, un código sin explicación) acababa en el mismo «No se pudo enviar el código», así que varios
 * problemas distintos parecían el mismo y nadie sabía qué arreglar.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { api, motivoDeError } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("motivoDeError", () => {
  it("prefiere la explicación que manda el servidor", () => {
    expect(
      motivoDeError(503, {
        error: "correo_no_disponible",
        detail: "No pudimos enviar el correo. Revisa la dirección.",
      }),
    ).toBe("No pudimos enviar el correo. Revisa la dirección.");
  });

  it("traduce a una frase un código que llega sin explicación", () => {
    expect(motivoDeError(403, { error: "origen_no_permitido" })).toMatch(
      /seguridad/,
    );
    expect(motivoDeError(429, { error: "demasiados_correos" })).toMatch(
      /demasiadas veces/,
    );
  });

  it("cuenta el estado cuando la respuesta no era JSON", () => {
    expect(motivoDeError(502, null)).toMatch(/en unos minutos/);
    expect(motivoDeError(404, null)).toMatch(/No se pudo completar el envío/);
  });

  it("nombra el campo cuando la validación trae issues", () => {
    expect(
      motivoDeError(400, {
        error: "payload_invalido",
        issues: [{ path: "socials.0.url", message: "no es un enlace" }],
      }),
    ).toContain("socials.0.url: no es un enlace");
  });

  it("mete un código desconocido dentro de una frase en vez de enseñarlo a pelo", () => {
    expect(motivoDeError(400, { error: "algo_raro" })).toBe(
      "No se pudo completar (algo_raro). Inténtalo de nuevo.",
    );
  });
});

describe("el cliente de la API ante una caída", () => {
  it("sin red avisa de la conexión en vez de dejar el aviso genérico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await expect(
      api.pedirCodigoDeInscripcion("alguien@ejemplo.com"),
    ).rejects.toMatchObject({
      status: 0,
      message: expect.stringMatching(/conectar con la web/),
    });
  });

  it("una respuesta en texto (el 502 del proxy) explica lo que pasó", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response("<html>Bad gateway</html>", { status: 502 }),
      ),
    );
    await expect(
      api.pedirCodigoDeInscripcion("alguien@ejemplo.com"),
    ).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/en unos minutos/),
    });
  });
});
