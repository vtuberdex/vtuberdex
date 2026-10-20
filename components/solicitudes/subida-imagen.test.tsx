import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SubidaImagen } from "@/components/solicitudes/subida-imagen";
import { ApiError, api } from "@/lib/api";
import * as imagen from "@/lib/imagen-cliente";

vi.mock("@/lib/imagen-cliente", async (original) => ({
  ...(await original<typeof import("@/lib/imagen-cliente")>()),
  normalizarImagenDeSolicitud: vi.fn(),
}));

const normalizar = vi.mocked(imagen.normalizarImagenDeSolicitud);
const WEBP = () => new Blob(["webp"], { type: "image/webp" });
const archivo = () => new File(["x"], "arte.png", { type: "image/png" });

/** El padre guarda el id, como los formularios. */
function Montada({ inicial = "" }: { inicial?: string }) {
  const [id, setId] = useState(inicial);
  return (
    <>
      <SubidaImagen
        formulario="inscripcion"
        credencial="SESION"
        tipo="character"
        campo="imageId"
        etiqueta="Avatar"
        obligatorio
        id={id}
        onId={setId}
      />
      <output data-testid="id">{id}</output>
    </>
  );
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:vista");
  URL.revokeObjectURL = vi.fn();
  normalizar.mockResolvedValue(WEBP());
  vi.spyOn(api, "subirImagenDeSolicitud").mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    tipo: "character",
    ancho: 720,
    alto: 1008,
    size: 1000,
  });
  vi.spyOn(api, "imagenDeSolicitud").mockResolvedValue(WEBP());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  normalizar.mockReset();
});

describe("SubidaImagen", () => {
  it("elegir un archivo lo convierte, muestra cómo queda y lo sube con la credencial", async () => {
    render(<Montada />);
    expect(
      screen.getByRole("button", { name: /elegir imagen/i }),
    ).toBeEnabled();
    expect(screen.queryByRole("img")).toBeNull();
    await userEvent.upload(screen.getByTestId("archivo-imageId"), archivo());
    await waitFor(() =>
      expect(screen.getByTestId("estado-imageId")).toHaveTextContent(/lista/i),
    );
    expect(normalizar).toHaveBeenCalledWith(expect.any(File), "character");
    expect(api.subirImagenDeSolicitud).toHaveBeenCalledWith(
      "inscripcion",
      "SESION",
      "character",
      expect.any(Blob),
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "blob:vista");
    expect(screen.getByTestId("id")).toHaveTextContent(/^1{8}-/);
    // Ya hay imagen: se ofrece cambiarla o quitarla.
    expect(screen.getByRole("button", { name: /cambiar/i })).toBeEnabled();
  });

  it("quitar la deja vacía y borra el id", async () => {
    render(<Montada />);
    await userEvent.upload(screen.getByTestId("archivo-imageId"), archivo());
    await screen.findByRole("img");
    await userEvent.click(screen.getByRole("button", { name: /quitar/i }));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByTestId("id")).toHaveTextContent("");
    expect(
      screen.getByRole("button", { name: /elegir imagen/i }),
    ).toBeInTheDocument();
  });

  it("una imagen que el navegador no puede preparar muestra el motivo y no sube nada", async () => {
    normalizar.mockRejectedValue(new imagen.ErrorDeImagen("chica"));
    render(<Montada />);
    await userEvent.upload(screen.getByTestId("archivo-imageId"), archivo());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /demasiado pequeña/i,
    );
    expect(api.subirImagenDeSolicitud).not.toHaveBeenCalled();
    expect(screen.getByTestId("id")).toHaveTextContent("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("si el servidor la rechaza, lo dice y conserva la imagen anterior", async () => {
    render(<Montada inicial="22222222-2222-4222-8222-222222222222" />);
    await screen.findByRole("img");
    vi.mocked(api.subirImagenDeSolicitud).mockRejectedValue(
      new ApiError("El archivo está dañado.", 400),
    );
    await userEvent.upload(screen.getByTestId("archivo-imageId"), archivo());
    expect(await screen.findByRole("alert")).toHaveTextContent(/dañado/i);
    expect(screen.getByTestId("id")).toHaveTextContent(/^2{8}-/);
  });

  it("al recuperar un borrador pide la vista previa al servidor con la credencial", async () => {
    render(<Montada inicial="33333333-3333-4333-8333-333333333333" />);
    expect(await screen.findByRole("img")).toHaveAttribute("src", "blob:vista");
    expect(api.imagenDeSolicitud).toHaveBeenCalledWith(
      "inscripcion",
      "SESION",
      "33333333-3333-4333-8333-333333333333",
    );
  });

  it("si la imagen del borrador ya caducó, borra el id y avisa", async () => {
    vi.mocked(api.imagenDeSolicitud).mockResolvedValue(null);
    render(<Montada inicial="33333333-3333-4333-8333-333333333333" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/caducó/i);
    expect(screen.getByTestId("id")).toHaveTextContent("");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("marca el campo cuando falta y lleva el ancla para «Ir al campo»", () => {
    const { container } = render(
      <SubidaImagen
        formulario="inscripcion"
        credencial="S"
        tipo="logo"
        campo="logoId"
        etiqueta="Logo"
        id=""
        onId={() => {}}
        invalido
      />,
    );
    expect(container.querySelector('[data-campo="logoId"]')).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
});
