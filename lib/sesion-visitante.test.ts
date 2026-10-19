import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  BITS_PRUEBA,
  MAX_SESIONES_POR_RED_HORA,
  __reiniciar,
  bitsInicialesEnCero,
  crearReto,
  renovarSesion,
  sesionValida,
  sesionesAgotadas,
  solucionValida,
  valorDeSesion,
} from "./sesion-visitante.mjs";

function resolver(reto: string): string {
  for (let n = 0; ; n++) {
    const d = createHash("sha256").update(`${reto}:${n}`).digest();
    if (bitsInicialesEnCero(d) >= BITS_PRUEBA) return String(n);
  }
}

describe("prueba de trabajo", () => {
  beforeEach(() => __reiniciar());

  it("acepta una solución correcta una sola vez", () => {
    const { reto } = crearReto();
    const n = resolver(reto);
    expect(solucionValida(reto, n)).toBe(true);
    expect(solucionValida(reto, n)).toBe(false);
  });

  it("rechaza una solución falsa, un reto adulterado y uno caducado", () => {
    const { reto } = crearReto(1000);
    expect(solucionValida(reto, "1")).toBe(false);
    const n = resolver(reto);
    expect(solucionValida(reto.replace(/.$/, "x"), n)).toBe(false);
    expect(solucionValida(reto, n, 1000 + 61_000)).toBe(false);
    expect(solucionValida("basura", n)).toBe(false);
  });

  it("cuenta bien los ceros iniciales", () => {
    expect(bitsInicialesEnCero(Buffer.from([0, 0, 0x10]))).toBe(19);
    expect(bitsInicialesEnCero(Buffer.from([0x80]))).toBe(0);
  });
});

describe("cookie de sesión", () => {
  beforeEach(() => __reiniciar());
  const cookie = (v: string) => `otra=1; vtd_s=${v}`;

  it("vale para la misma red y User-Agent", () => {
    const v = valorDeSesion("1.2.3.4", "UA");
    expect(sesionValida(cookie(v), "1.2.3.4", "UA")).toBe(true);
  });

  it("no vale en otra red, con otro User-Agent, caducada ni adulterada", () => {
    const v = valorDeSesion("1.2.3.4", "UA", 0);
    expect(sesionValida(cookie(v), "9.9.9.9", "UA", 1000)).toBe(false);
    expect(sesionValida(cookie(v), "1.2.3.4", "otro", 1000)).toBe(false);
    expect(sesionValida(cookie(v), "1.2.3.4", "UA", 3_600_000)).toBe(false);
    expect(sesionValida(cookie(v + "x"), "1.2.3.4", "UA", 1000)).toBe(false);
    expect(sesionValida(undefined, "1.2.3.4", "UA")).toBe(false);
  });

  it("la cookie dura 5 min y se renueva con la cookie vigente, sin repetir la prueba", () => {
    const v0 = valorDeSesion("1.2.3.4", "UA", 0);
    expect(sesionValida(cookie(v0), "1.2.3.4", "UA", 4 * 60_000)).toBe(true);
    expect(sesionValida(cookie(v0), "1.2.3.4", "UA", 6 * 60_000)).toBe(false);
    const v1 = renovarSesion(cookie(v0), "1.2.3.4", "UA", 4 * 60_000)!;
    expect(sesionValida(cookie(v1), "1.2.3.4", "UA", 8 * 60_000)).toBe(true);
  });

  it("no renueva una caducada, de otra red ni pasadas 2 h desde el reto", () => {
    const v0 = valorDeSesion("1.2.3.4", "UA", 0);
    expect(renovarSesion(cookie(v0), "1.2.3.4", "UA", 6 * 60_000)).toBeNull();
    expect(renovarSesion(cookie(v0), "9.9.9.9", "UA", 1000)).toBeNull();
    // Renovando cada 3 min se llega a las 2 h, y ahí se corta.
    let v = v0;
    let t = 0;
    while (t + 180_000 <= 2 * 3600_000) {
      t += 180_000;
      v = renovarSesion(cookie(v), "1.2.3.4", "UA", t)!;
      expect(v).not.toBeNull();
    }
    expect(renovarSesion(cookie(v), "1.2.3.4", "UA", t + 180_000)).toBeNull();
  });

  it("limita las sesiones nuevas por red y hora", () => {
    for (let i = 0; i < MAX_SESIONES_POR_RED_HORA; i++)
      expect(sesionesAgotadas("r", 1000)).toBe(false);
    expect(sesionesAgotadas("r", 1000)).toBe(true);
    expect(sesionesAgotadas("r", 1000 + 3_600_001)).toBe(false);
  });
});
