import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ReclamosMisiones } from "@/components/admin/reclamos-misiones";

const mocks = vi.hoisted(() => ({ reclamosDeMisiones: vi.fn(), revocarReclamoDeMision: vi.fn() }));
vi.mock("@/lib/api", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/api")>();
  return { ...actual, api: { ...mocks } };
});

const reclamo = (extra = {}) => ({
  vtuberId: 7,
  misionId: "grado-7",
  mision: "Carta gradeada · 7",
  slug: "luna",
  name: "Luna",
  grado: "7",
  gradoPrevio: "6",
  gradoActual: "7",
  reclamado: "2026-10-21T10:00:00.000Z",
  revocado: null,
  ...extra,
});

afterEach(() => vi.clearAllMocks());

describe("ReclamosMisiones", () => {
  test("sin reclamos lo dice", async () => {
    mocks.reclamosDeMisiones.mockResolvedValue({ items: [] });
    render(<ReclamosMisiones token="t" notify={vi.fn()} />);
    expect(await screen.findByText(/Nadie ha reclamado/)).toBeTruthy();
  });

  test("revocar pide confirmación y avisa si la carta volvió al grado anterior", async () => {
    mocks.reclamosDeMisiones
      .mockResolvedValueOnce({ items: [reclamo()] })
      .mockResolvedValueOnce({ items: [reclamo({ revocado: "2026-10-22T10:00:00.000Z" })] });
    mocks.revocarReclamoDeMision.mockResolvedValue({ ok: true, cartaModificada: true });
    const notify = vi.fn();
    render(<ReclamosMisiones token="t" notify={notify} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revocar" }));
    expect(mocks.revocarReclamoDeMision).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sí, revocar" }));
    await waitFor(() => expect(mocks.revocarReclamoDeMision).toHaveBeenCalledWith("t", 7, "grado-7"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("ok", "Reclamo revocado: Luna vuelve a grado 6."));
    expect(await screen.findByText(/Revocado el/)).toBeTruthy();
  });

  test("si la carta ya llevaba otro grado, lo dice", async () => {
    mocks.reclamosDeMisiones.mockResolvedValue({ items: [reclamo({ gradoActual: "9" })] });
    mocks.revocarReclamoDeMision.mockResolvedValue({ ok: true, cartaModificada: false });
    const notify = vi.fn();
    render(<ReclamosMisiones token="t" notify={notify} />);
    fireEvent.click(await screen.findByRole("button", { name: "Revocar" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, revocar" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("ok", expect.stringContaining("no se tocó")));
  });
});
