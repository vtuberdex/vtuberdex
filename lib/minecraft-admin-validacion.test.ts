// @vitest-environment node
import { describe, expect, it } from "vitest";

import { analizarServerProperties } from "./minecraft-admin.mjs";

describe("analizarServerProperties: rechazos de configuración", () => {
  it("rechaza un contenido vacío", () => {
    expect(analizarServerProperties("  \n\n")).toMatchObject({
      ok: false,
      status: 400,
      cuerpo: { error: "vacio" },
    });
  });

  it("rechaza un contenido por encima del límite", () => {
    const enorme = `motd=${"x".repeat(5_000_000)}`;
    expect(analizarServerProperties(enorme)).toMatchObject({
      ok: false,
      status: 413,
      cuerpo: { error: "configuracion_demasiado_grande" },
    });
  });

  it("rechaza un byte nulo en el contenido", () => {
    expect(analizarServerProperties("motd=hola\u0000mundo")).toMatchObject({
      ok: false,
      status: 400,
      cuerpo: { error: "contenido_invalido" },
    });
  });

  it("señala la línea a la que le falta el '='", () => {
    expect(analizarServerProperties("motd\nonline-mode=false")).toMatchObject({
      ok: false,
      status: 400,
      cuerpo: {
        error: "linea_invalida",
        detail: expect.stringContaining("línea 1"),
      },
    });
  });

  it("señala la línea con una clave no permitida", () => {
    expect(analizarServerProperties("clave rara=valor")).toMatchObject({
      ok: false,
      status: 400,
      cuerpo: {
        error: "clave_invalida",
        detail: expect.stringContaining("línea 1"),
      },
    });
  });

  it("rechaza un contenido con solo comentarios", () => {
    expect(analizarServerProperties("# vacío\n\n# otra vez")).toMatchObject({
      ok: false,
      status: 400,
      cuerpo: { error: "sin_valores" },
    });
  });

  it("acepta un contenido con claves válidas", () => {
    expect(
      analizarServerProperties("motd=hola\nonline-mode=false\r\n"),
    ).toEqual({
      ok: true,
      valores: { motd: "hola", "online-mode": "false" },
    });
  });
});
