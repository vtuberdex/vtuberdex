// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PremiumInfo } from "@/lib/types";

import { marcoDe } from "./card3d-config";
import { dibujarHojaInterior } from "./premium-label";
import { slabLayout } from "./premium-layout";
import {
  FUENTE_MINECRAFT,
  PALETA_MINECRAFT,
  bloquesDeFondo,
  cargarFuenteMinecraft,
} from "./premium-minecraft";

const layout = slabLayout(2.2, 3.08, 0.09);

function premium(origin: PremiumInfo["origin"], grade = "8"): PremiumInfo {
  return {
    grade,
    cert: "VTD-000017",
    since: "2026-01-01T00:00:00.000Z",
    gradedAt: "2026-02-01T00:00:00.000Z",
    origin,
  } as PremiumInfo;
}

const datos = (origin: PremiumInfo["origin"], grade = "8") => ({
  name: "madKoding",
  dexNumber: 16,
  country: "Chile",
  premium: premium(origin, grade),
});

/** Contexto 2D de mentira: anota con qué fuente se escribió cada texto y cuántos rectángulos se rellenaron. */
function grabador() {
  const escritos: { texto: string; fuente: string }[] = [];
  let rellenos = 0;
  const estado: Record<string, unknown> = {};
  const ctx = new Proxy(estado, {
    get(destino, propiedad: string) {
      if (propiedad === "fillText") {
        return (texto: string) =>
          void escritos.push({ texto, fuente: String(destino.font ?? "") });
      }
      if (propiedad === "fillRect") {
        return () => void (rellenos += 1);
      }
      if (propiedad === "measureText") {
        return (texto: string) => ({ width: texto.length * 5 });
      }
      if (propiedad === "createLinearGradient") {
        return () => ({ addColorStop: () => undefined });
      }
      if (propiedad in destino) {
        return destino[propiedad];
      }
      return () => undefined;
    },
    set(destino, propiedad: string, valor) {
      destino[propiedad] = valor;
      return true;
    },
  });
  return { ctx, escritos, rellenos: () => rellenos };
}

function dibujar(origin: PremiumInfo["origin"], grade = "8") {
  const g = grabador();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    g.ctx as never,
  );
  dibujarHojaInterior(layout, datos(origin, grade));
  return g;
}

describe("fondo de Minecraft: bloques", () => {
  it("es una cuadrícula del tamaño pedido con solo colores de la paleta", () => {
    const bloques = bloquesDeFondo(12, 18, 7);
    expect(bloques).toHaveLength(18);
    for (const fila of bloques) {
      expect(fila).toHaveLength(12);
      for (const b of fila) {
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(PALETA_MINECRAFT.length);
      }
    }
  });

  it("la misma semilla da el mismo fondo y otra semilla da otro", () => {
    expect(bloquesDeFondo(12, 18, 7)).toEqual(bloquesDeFondo(12, 18, 7));
    expect(bloquesDeFondo(12, 18, 7)).not.toEqual(bloquesDeFondo(12, 18, 8));
  });

  it("mezcla varios bloques (no es un color liso)", () => {
    const usados = new Set(bloquesDeFondo(12, 18, 7).flat());
    expect(usados.size).toBeGreaterThan(2);
  });
});

describe("marco de misiones: fondo y tipografía", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("solo el marco de misiones pide fondo y fuente de Minecraft", () => {
    expect(marcoDe("misiones").insert.fondo).toBe("minecraft");
    expect(marcoDe("misiones").etiqueta.fuente).toBe(FUENTE_MINECRAFT);
    for (const o of ["premium8", "donacion"] as const) {
      expect(marcoDe(o).insert.fondo).toBeUndefined();
      expect(marcoDe(o).etiqueta.fuente).toBeUndefined();
    }
  });

  it("la cabecera (VTUBERDEX y MISIONES) y la nota llevan Minecrafter", () => {
    const { escritos } = dibujar("misiones", "8");
    for (const texto of ["VTUBERDEX", "MISIONES", "8"]) {
      const e = escritos.find((x) => x.texto === texto);
      expect(e?.fuente, texto).toContain("Minecrafter");
    }
  });

  it("el nombre, el nombre del grado y el certificado conservan la fuente de siempre", () => {
    const { escritos } = dibujar("misiones", "8");
    for (const e of escritos.filter(
      (x) =>
        x.texto !== "VTUBERDEX" && x.texto !== "MISIONES" && x.texto !== "8",
    )) {
      expect(e.fuente, e.texto).not.toContain("Minecrafter");
    }
  });

  it("si Minecrafter no tiene un glifo (el punto de 8.5) el navegador cae a la fuente normal", () => {
    const { escritos } = dibujar("misiones", "8.5");
    const nota = escritos.find((x) => x.texto === "8.5");
    expect(nota?.fuente).toMatch(/Minecrafter.*(Helvetica|sans-serif)/);
  });

  it("Premium 8 y Donación no usan Minecrafter en ningún texto", () => {
    for (const o of ["premium8", "donacion"] as const) {
      const { escritos } = dibujar(o);
      expect(escritos.some((e) => e.fuente.includes("Minecrafter"))).toBe(
        false,
      );
    }
  });

  it("el fondo de Minecraft se pinta con muchos bloques; los otros marcos no", () => {
    const misiones = dibujar("misiones").rellenos();
    const donacion = dibujar("donacion").rellenos();
    expect(misiones).toBeGreaterThan(donacion + 100);
  });
});

describe("carga de la fuente Minecrafter", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("pide la fuente al navegador y avisa cuando ya se puede dibujar con ella", async () => {
    const load = vi.fn().mockResolvedValue([{}]);
    vi.stubGlobal("document", { fonts: { load } });
    await expect(cargarFuenteMinecraft()).resolves.toBe(true);
    expect(load).toHaveBeenCalledWith(expect.stringContaining("Minecrafter"));
  });

  it("si el navegador no la carga (o no sabe cargar fuentes) devuelve false sin lanzar", async () => {
    vi.stubGlobal("document", {
      fonts: { load: vi.fn().mockRejectedValue(new Error("red")) },
    });
    await expect(cargarFuenteMinecraft()).resolves.toBe(false);
    vi.stubGlobal("document", {});
    await expect(cargarFuenteMinecraft()).resolves.toBe(false);
  });

  it("si la lista de fuentes viene vacía (no existe la fuente) devuelve false", async () => {
    vi.stubGlobal("document", {
      fonts: { load: vi.fn().mockResolvedValue([]) },
    });
    await expect(cargarFuenteMinecraft()).resolves.toBe(false);
  });
});
