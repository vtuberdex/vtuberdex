// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { describe, expect, it } from "vitest";
import { DEFAULT_SEARCH, searchParamsFromUrl } from "@/lib/query";

/** La validación era un esquema zod; se reescribió a mano con la MISMA regla (ver `validarBusqueda`). */
describe("searchParamsFromUrl: misma regla que el esquema zod que reemplaza", () => {
  it("lee filtros, orden y página válidos", () => {
    const p = searchParamsFromUrl(
      "?q=ana&countries=cl,mx&sort=name&premium=1&page=3&perPage=4",
    );
    expect(p).toMatchObject({
      q: "ana",
      countries: ["cl", "mx"],
      sort: "name",
      premium: true,
      page: 3,
      perPage: 4,
    });
  });

  it.each([
    "?page=0",
    "?page=1.5",
    "?page=abc",
    "?page=",
    "?page=10001",
    "?perPage=101",
    "?sort=random",
    "?premium=si",
    `?q=${"x".repeat(121)}`,
    "?language=demasiado-largo",
  ])("un campo inválido (%s) devuelve la búsqueda por defecto", (url) => {
    expect(searchParamsFromUrl(`${url}&countries=cl`)).toEqual({ ...DEFAULT_SEARCH });
  });

  it("acepta premium=true y deja fuera lo que no conoce", () => {
    expect(searchParamsFromUrl("?premium=true&otra=1").premium).toBe(true);
  });
});
