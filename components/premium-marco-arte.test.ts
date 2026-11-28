// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PremiumInfo } from "@/lib/types";

import { marcoDe } from "./card3d-config";
import { dibujarHojaInterior } from "./premium-label";
import { slabLayout } from "./premium-layout";
import {
  arteDeMarco,
  cargarArteDeMarco,
  olvidarArtesDeMarco,
  registrarArteDeMarco,
} from "./premium-marco-arte";
import { useArteDeMarco } from "./use-arte-de-marco";

const layout = slabLayout(2.2, 3.08, 0.09);

const datos = (origin: PremiumInfo["origin"]) => ({
  name: "madKoding",
  dexNumber: 16,
  country: "Chile",
  premium: {
    grade: "8",
    cert: "VTD-000017",
    since: "2026-01-01T00:00:00.000Z",
    gradedAt: "2026-02-01T00:00:00.000Z",
    origin,
  } as PremiumInfo,
});

/** Contexto 2D de mentira que anota las llamadas a `drawImage`. */
function grabador() {
  const imagenes: unknown[][] = [];
  /** Orden de lo dibujado: "arte" al pintar la imagen y "texto" con cada `fillText`. */
  const orden: string[] = [];
  const estado: Record<string, unknown> = {};
  const ctx = new Proxy(estado, {
    get(destino, propiedad: string) {
      if (propiedad === "drawImage") {
        return (...args: unknown[]) => {
          imagenes.push(args);
          orden.push("arte");
        };
      }
      if (propiedad === "fillText") {
        return () => void orden.push("texto");
      }
      if (propiedad === "measureText") {
        return (t: string) => ({ width: t.length * 5 });
      }
      if (propiedad === "createLinearGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      return propiedad in destino ? destino[propiedad] : () => undefined;
    },
    set(destino, propiedad: string, valor) {
      destino[propiedad] = valor;
      return true;
    },
  });
  return { ctx, imagenes, orden };
}

describe("marco de donación: arte ornamentado", () => {
  beforeEach(() => {
    olvidarArtesDeMarco();
    vi.restoreAllMocks();
  });

  it("solo el marco de donación pide el arte ornamentado (hoja negra con filigrana dorada)", () => {
    expect(marcoDe("donacion").insert.arte).toBe("donacion");
    expect(marcoDe(undefined).insert.arte).toBe("donacion");
    for (const o of ["premium8", "misiones"] as const) {
      expect(marcoDe(o).insert.arte).toBeUndefined();
    }
  });

  it("la hoja de donación es oscura y se distingue de las otras dos", () => {
    const luz = (hex: string) =>
      [1, 3, 5].reduce((s, i) => s + parseInt(hex.slice(i, i + 2), 16), 0);
    expect(luz(marcoDe("donacion").insert.frame)).toBeLessThan(120);
    expect(marcoDe("donacion").insert.frame).not.toBe(
      marcoDe("premium8").insert.frame,
    );
  });

  it("con el arte cargado lo dibuja UNA vez, a todo el lienzo, DEBAJO de la etiqueta (las volutas no pisan el texto)", () => {
    const g = grabador();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      g.ctx as never,
    );
    const arte = document.createElement("canvas");
    registrarArteDeMarco("donacion", arte as unknown as HTMLImageElement);
    const lienzo = dibujarHojaInterior(layout, datos("donacion"));
    expect(g.imagenes).toHaveLength(1);
    expect(g.imagenes[0]).toEqual([arte, 0, 0, lienzo.width, lienzo.height]);
    expect(g.orden.indexOf("arte")).toBeLessThan(g.orden.indexOf("texto"));
  });

  it("sin el arte cargado (aún bajando) dibuja la hoja igual, sin lanzar", () => {
    const g = grabador();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      g.ctx as never,
    );
    expect(() => dibujarHojaInterior(layout, datos("donacion"))).not.toThrow();
    expect(g.imagenes).toHaveLength(0);
  });

  it("Premium 8 y misiones no dibujan ningún arte, aunque haya uno cargado", () => {
    registrarArteDeMarco(
      "donacion",
      document.createElement("canvas") as unknown as HTMLImageElement,
    );
    for (const o of ["premium8", "misiones"] as const) {
      const g = grabador();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
        g.ctx as never,
      );
      dibujarHojaInterior(layout, datos(o));
      expect(g.imagenes).toHaveLength(0);
    }
  });
});

describe("carga del arte", () => {
  beforeEach(() => olvidarArtesDeMarco());
  afterEach(() => vi.unstubAllGlobals());

  function imagenFalsa(resultado: "ok" | "error") {
    class Falsa {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      decode = undefined;
      set src(_: string) {
        queueMicrotask(() =>
          resultado === "ok" ? this.onload?.() : this.onerror?.(),
        );
      }
    }
    vi.stubGlobal("Image", Falsa);
  }

  it("al cargar guarda la imagen y avisa; una segunda petición no vuelve a bajarla", async () => {
    imagenFalsa("ok");
    expect(arteDeMarco("donacion")).toBeNull();
    await expect(cargarArteDeMarco("donacion")).resolves.toBe(true);
    expect(arteDeMarco("donacion")).not.toBeNull();
    const primera = arteDeMarco("donacion");
    await expect(cargarArteDeMarco("donacion")).resolves.toBe(true);
    expect(arteDeMarco("donacion")).toBe(primera);
  });

  it("si la imagen falla devuelve false y se puede reintentar (no se memoiza el fallo)", async () => {
    imagenFalsa("error");
    await expect(cargarArteDeMarco("donacion")).resolves.toBe(false);
    expect(arteDeMarco("donacion")).toBeNull();
    imagenFalsa("ok");
    await expect(cargarArteDeMarco("donacion")).resolves.toBe(true);
  });
});

describe("useArteDeMarco", () => {
  beforeEach(() => olvidarArtesDeMarco());
  afterEach(() => vi.unstubAllGlobals());

  it("sin arte no carga nada y la versión se queda en 0", () => {
    const { result } = renderHook(() => useArteDeMarco(undefined));
    expect(result.current).toBe(0);
  });

  it("al terminar de cargar sube la versión para repintar la hoja", async () => {
    class Falsa {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal("Image", Falsa);
    const { result } = renderHook(() => useArteDeMarco("donacion"));
    await waitFor(() => expect(result.current).toBe(1));
  });

  it("si falla la versión no sube", async () => {
    class Falsa {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", Falsa);
    const { result } = renderHook(() => useArteDeMarco("donacion"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toBe(0);
  });
});
