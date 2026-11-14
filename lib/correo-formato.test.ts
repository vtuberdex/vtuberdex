import { describe, expect, it } from "vitest";

import { esCorreoBienFormado } from "./correo-formato.mjs";

// El regex al que sustituye: la prueba compara las dos reglas en los mismos casos.
const ANTES = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ANTES_TLD1 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CASOS = [
  "a@b.co",
  "ana.perez@correo.cl",
  "a@b.co.uk",
  "a@.co",
  "a@b..co",
  "a@b.c",
  "a@b.",
  "a@bco",
  "@b.co",
  "a@@b.co",
  "a@b@c.co",
  "a b@c.co",
  "a@b.co ",
  "a@b.c\to",
  "",
  "a",
  "a@",
  "a@...",
  "a@b.c.",
  "ñandú@dominio.es",
];

describe("esCorreoBienFormado", () => {
  it.each(CASOS)("coincide con el regex anterior: %j", (caso) => {
    expect(esCorreoBienFormado(caso)).toBe(ANTES.test(caso));
    expect(esCorreoBienFormado(caso, { tldMinimo: 1 })).toBe(
      ANTES_TLD1.test(caso),
    );
  });

  it("no acepta lo que no es texto", () => {
    expect(esCorreoBienFormado(undefined)).toBe(false);
    expect(esCorreoBienFormado(42)).toBe(false);
  });

  it("responde en tiempo lineal con un dominio lleno de puntos", () => {
    const largo = `a@${"b.".repeat(50_000)}`;
    const t0 = performance.now();
    expect(esCorreoBienFormado(largo)).toBe(true);
    expect(esCorreoBienFormado(`${largo} `)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
