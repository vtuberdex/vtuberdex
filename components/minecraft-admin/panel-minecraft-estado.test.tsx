import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MinecraftAdminPage from "../../app/minecraft-admin/page";

function fetchCon(status: number) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
      text: async () => "{}",
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("panel: lectura del estado", () => {
  it.each([401, 403])("con %i muestra el acceso por correo", async (status) => {
    fetchCon(status);
    render(<MinecraftAdminPage />);
    expect(
      await screen.findByPlaceholderText("correo@example.com"),
    ).toBeTruthy();
  });

  it("con un error del servidor muestra el aviso", async () => {
    fetchCon(500);
    render(<MinecraftAdminPage />);
    expect(await screen.findByText(/no se pudo leer el estado/i)).toBeTruthy();
  });
});
