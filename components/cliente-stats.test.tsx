// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const ruta = vi.hoisted(() => ({ actual: "/" }));
const sesion = vi.hoisted(() => ({
  asegurarSesion: vi.fn(() => Promise.resolve()),
  mantenerSesion: vi.fn(() => () => undefined),
}));
vi.mock("next/navigation", () => ({ usePathname: () => ruta.actual }));
vi.mock("@/lib/sesion-cliente", () => sesion);
vi.mock("@/lib/telemetria-cliente", async (original) => ({
  ...(await original<typeof import("@/lib/telemetria-cliente")>()),
  iniciarTelemetria: () => ({
    detener: () => undefined,
    navegar: () => undefined,
  }),
}));

import { ClienteStats } from "@/components/cliente-stats";

afterEach(() => vi.clearAllMocks());

describe("ClienteStats: la sesión de visitante solo donde se usa", () => {
  it("en una página de texto no resuelve la prueba de trabajo", () => {
    ruta.actual = "/terminos";
    render(<ClienteStats />);
    expect(sesion.asegurarSesion).not.toHaveBeenCalled();
    expect(sesion.mantenerSesion).not.toHaveBeenCalled();
  });

  it("al llegar al catálogo la abre UNA vez y la mantiene al seguir a una ficha", () => {
    ruta.actual = "/terminos";
    const { rerender } = render(<ClienteStats />);
    ruta.actual = "/";
    rerender(<ClienteStats />);
    ruta.actual = "/v/alguien";
    rerender(<ClienteStats />);
    expect(sesion.asegurarSesion).toHaveBeenCalledTimes(1);
    expect(sesion.mantenerSesion).toHaveBeenCalledTimes(1);
  });
});
