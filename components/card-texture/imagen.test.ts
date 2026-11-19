// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  REINTENTOS_MS,
  __limpiarImagenes,
  loadImage,
} from "@/components/card-texture/imagen";
import { fuentesCompletas } from "@/components/card-texture/fabrica";
import { makeCard } from "@/test/fixtures";

/** Image falsa: falla las primeras `fallos` veces por URL (como un 429 pasajero) y luego carga. */
function instalarImagen(fallosPorUrl: number) {
  const intentos = new Map<string, number>();
  class ImagenFalsa {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    crossOrigin = "";
    decoding = "";
    set src(url: string) {
      const n = (intentos.get(url) ?? 0) + 1;
      intentos.set(url, n);
      setTimeout(
        () => (n > fallosPorUrl ? this.onload?.() : this.onerror?.()),
        0,
      );
    }
  }
  vi.stubGlobal("Image", ImagenFalsa);
  return intentos;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __limpiarImagenes();
});

const esperarTodo = async () => {
  for (let i = 0; i < 10; i += 1) {
    await vi.runAllTimersAsync();
  }
};

describe("loadImage reintenta (pasar páginas rápido daba 429 y «SIN IMAGEN»)", () => {
  it("una imagen que falla una vez se carga en el reintento", async () => {
    const intentos = instalarImagen(1);
    const promesa = loadImage("/images/character/a.webp");
    await esperarTodo();
    expect(await promesa).not.toBeNull();
    expect(intentos.get("/images/character/a.webp")).toBe(2);
  });

  it("tras agotar los reintentos devuelve null y no memoiza el fallo", async () => {
    const intentos = instalarImagen(99);
    const promesa = loadImage("/images/logo/b.webp");
    await esperarTodo();
    expect(await promesa).toBeNull();
    expect(intentos.get("/images/logo/b.webp")).toBe(1 + REINTENTOS_MS.length);
    void loadImage("/images/logo/b.webp");
    await esperarTodo();
    expect(intentos.get("/images/logo/b.webp")).toBe(
      2 * (1 + REINTENTOS_MS.length),
    );
  });

  it("sin URL no pide nada", async () => {
    const intentos = instalarImagen(0);
    expect(await loadImage("")).toBeNull();
    expect(intentos.size).toBe(0);
  });
});

describe("fuentesCompletas: no se cachea una carta con una imagen que falló", () => {
  const img = {} as HTMLImageElement;
  it("falta una imagen que la carta SÍ tiene -> incompleta", () => {
    const card = makeCard({
      images: { character: "/c.webp", logo: "/l.webp", background: null },
    } as never);
    expect(
      fuentesCompletas(card, { art: img, logo: null, background: null }),
    ).toBe(false);
    expect(
      fuentesCompletas(card, { art: img, logo: img, background: null }),
    ).toBe(true);
  });
});
