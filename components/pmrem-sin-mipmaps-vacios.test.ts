// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { describe, expect, it, vi } from "vitest";
import { PMREMGenerator, type WebGLRenderer } from "three";
import {
  ladoDeOrigen,
  prepararOrigenDePmrem,
} from "@/components/pmrem-sin-mipmaps-vacios";

type Origen = {
  width: number;
  depthBuffer: boolean;
  texture: { generateMipmaps: boolean };
};
const origenDe = (p: PMREMGenerator) =>
  (p as unknown as { _sourceTarget: Origen | null })._sourceTarget;

describe("PMREM sin mipmaps sobre caras vacías", () => {
  it("calcula el lado como PMREMGenerator (potencia de 2, mínimo 256)", () => {
    expect(ladoDeOrigen(1024 / 4)).toBe(256);
    expect(ladoDeOrigen(4096 / 4)).toBe(1024);
    expect(ladoDeOrigen(3000 / 4)).toBe(512);
    expect(ladoDeOrigen(10)).toBe(256);
  });

  it("reserva el origen SIN mipmaps y los enciende después (los genera el render, ya con datos)", () => {
    const renderer = { initRenderTarget: vi.fn() };
    const pmrem = new PMREMGenerator(renderer as unknown as WebGLRenderer);
    // El campo privado tiene que existir y valer null: si three lo cambia, la prueba avisa.
    expect(origenDe(pmrem)).toBeNull();

    expect(prepararOrigenDePmrem(pmrem, renderer, 2048 / 4, false)).toBe(true);
    const origen = origenDe(pmrem)!;
    expect(renderer.initRenderTarget).toHaveBeenCalledWith(origen);
    // Al reservar no había mipmaps que generar; ahora sí, para después de dibujar.
    const alReservar = renderer.initRenderTarget.mock.calls[0][0] as Origen;
    expect(alReservar).toBe(origen);
    expect(origen.texture.generateMipmaps).toBe(true);
    expect(origen.width).toBe(512);
    expect(origen.depthBuffer).toBe(false);
  });

  it("no pisa un origen que ya existe ni falla sin initRenderTarget", () => {
    const renderer = { initRenderTarget: vi.fn() };
    const pmrem = new PMREMGenerator(renderer as unknown as WebGLRenderer);
    prepararOrigenDePmrem(pmrem, renderer, 256, true);
    const primero = origenDe(pmrem);
    expect(prepararOrigenDePmrem(pmrem, renderer, 256, true)).toBe(false);
    expect(origenDe(pmrem)).toBe(primero);

    const otro = new PMREMGenerator(renderer as unknown as WebGLRenderer);
    expect(
      prepararOrigenDePmrem(
        otro,
        {} as Pick<WebGLRenderer, "initRenderTarget">,
        256,
        false,
      ),
    ).toBe(false);
    expect(origenDe(otro)).toBeNull();
  });
});
