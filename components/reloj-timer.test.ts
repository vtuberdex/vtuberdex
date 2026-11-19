// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { afterEach, describe, expect, it, vi } from "vitest";
import { Clock } from "three";
import { RelojTimer } from "@/components/reloj-timer";

afterEach(() => vi.restoreAllMocks());

describe("RelojTimer (Clock sobre THREE.Timer)", () => {
  it("arranca solo en el primer getDelta y luego mide en segundos", () => {
    let ahora = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => ahora);
    const reloj = new RelojTimer();
    expect(reloj.getDelta()).toBe(0);
    expect(reloj.running).toBe(true);
    ahora += 250;
    expect(reloj.getDelta()).toBeCloseTo(0.25);
    ahora += 500;
    expect(reloj.getDelta()).toBeCloseTo(0.5);
    expect(reloj.elapsedTime).toBeCloseTo(0.75);
  });

  it("detenido no avanza (como Clock.stop)", () => {
    let ahora = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ahora);
    const reloj = new RelojTimer();
    reloj.start();
    ahora += 100;
    reloj.stop();
    ahora += 5000;
    expect(reloj.getDelta()).toBe(0);
    expect(reloj.elapsedTime).toBeCloseTo(0.1);
  });

  it("con la pestaña oculta el delta es 0 (Page Visibility de Timer)", () => {
    let ahora = 0;
    vi.spyOn(performance, "now").mockImplementation(() => ahora);
    const oculto = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const reloj = new RelojTimer();
    reloj.start();
    oculto.mockReturnValue(true);
    ahora += 60_000;
    expect(reloj.getDelta()).toBe(0);
    reloj.dispose();
  });
});

describe("aviso de Clock obsoleto", () => {
  it("se calla SOLO el aviso de construcción de Clock (el que provoca R3F)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    new Clock();
    expect(warn).not.toHaveBeenCalled();
  });
});
