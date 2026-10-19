import { beforeEach, describe, expect, it } from "vitest";

import {
  __reiniciar,
  gastarFichas,
  redDeLaPeticion,
  redExenta,
} from "./anti-scraping.mjs";

const ids = (desde: number, n: number) =>
  Array.from({ length: n }, (_, i) => desde + i);

describe("gastarFichas", () => {
  beforeEach(() => __reiniciar());

  it("deja pasar un uso humano", () => {
    expect(gastarFichas("1.2.3.4", ids(1, 8)).permitido).toBe(true);
  });

  it("corta al pasar de 300 fichas distintas en una hora", () => {
    const t0 = 1_000_000;
    expect(gastarFichas("1.2.3.4", ids(1, 300), t0).permitido).toBe(true);
    const r = gastarFichas("1.2.3.4", [301], t0 + 1000);
    expect(r).toMatchObject({ permitido: false, ventana: "hora" });
    expect(r.reintentarEnS).toBeGreaterThan(0);
  });

  it("repetir fichas ya vistas no gasta cupo", () => {
    for (let i = 0; i < 50; i++)
      expect(gastarFichas("1.2.3.4", ids(1, 8), 1000 + i).permitido).toBe(true);
  });

  it("el tope diario (600) impide completar el catálogo desde una red", () => {
    const h = 60 * 60 * 1000;
    let t = 0;
    for (let bloque = 0; bloque < 2; bloque++) {
      expect(
        gastarFichas("1.2.3.4", ids(bloque * 300 + 1, 300), t).permitido,
      ).toBe(true);
      t += h + 1000; // la ventana horaria se vació, la diaria no
    }
    const r = gastarFichas("1.2.3.4", [601], t);
    expect(r).toMatchObject({ permitido: false, ventana: "dia" });
  });

  it("una red bloqueada no amplía su lista y otra red no se ve afectada", () => {
    gastarFichas("1.2.3.4", ids(1, 300), 0);
    expect(gastarFichas("1.2.3.4", ids(301, 5), 10).permitido).toBe(false);
    expect(gastarFichas("5.6.7.8", ids(301, 5), 10).permitido).toBe(true);
  });

  it("loopback y VPN están exentos", () => {
    for (const ip of ["127.0.0.1", "::1", "10.8.0.5", null])
      expect(gastarFichas(ip, ids(1, 5000)).permitido).toBe(true);
  });
});

describe("red de la petición", () => {
  it("usa X-Real-IP y no el X-Forwarded-For que escribe el cliente", () => {
    const h = new Headers({
      "x-real-ip": "9.9.9.9",
      "x-forwarded-for": "1.1.1.1, 9.9.9.9",
    });
    expect(redDeLaPeticion(h)).toBe("9.9.9.9");
    expect(redExenta(redDeLaPeticion(new Headers()))).toBe(true);
  });
});
