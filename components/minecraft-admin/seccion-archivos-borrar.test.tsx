// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * El botón de borrar del explorador de archivos (`SeccionArchivos`).
 *
 * Lo que se pinta en la lista tiene que portarse bien con el servidor: preguntar antes de borrar,
 * mandar la ruta tal cual, no llamar a la API si se cancela, contar el error en amable cuando el
 * servidor dice que no, y no ofrecer el botón en un archivo de solo lectura (no habría nada que
 * hacer al pulsarlo).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeccionArchivos } from "./seccion-archivos";

type Llamada = { url: string; metodo: string | undefined };

const llamadas: Llamada[] = [];

function respuesta(cuerpo: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => cuerpo,
    text: async () => JSON.stringify(cuerpo),
  } as unknown as Response;
}

const CARPETA = {
  ruta: "plugins/VTuberDex",
  migas: [
    { nombre: "plugins", ruta: "plugins" },
    { nombre: "VTuberDex", ruta: "plugins/VTuberDex" },
  ],
  carpetas: [],
  archivos: [
    {
      ruta: "plugins/VTuberDex/config.yml",
      nombre: "config.yml",
      bytes: 24,
      modificado: "2026-11-16T09:00:00.000Z",
    },
    {
      ruta: "plugins/VTuberDex/del-servidor.yml",
      nombre: "del-servidor.yml",
      bytes: 12,
      modificado: "2026-11-16T09:00:00.000Z",
      escribible: false,
    },
  ],
  comprimidos: [
    {
      ruta: "plugins/VTuberDex/recursos.zip",
      nombre: "recursos.zip",
      bytes: 4096,
      modificado: "2026-11-16T09:00:00.000Z",
    },
  ],
  escribible: true,
  legible: true,
};

/** El listado responde siempre lo mismo; el borrado, lo que diga `alBorrar`. */
function montarFetch(alBorrar: () => Response = () => respuesta({ ok: true })) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, metodo: init?.method });
      if (init?.method === "DELETE") {
        return alBorrar();
      }
      return respuesta(CARPETA);
    }),
  );
}

const confirmar = (valor: boolean) =>
  vi.stubGlobal("confirm", vi.fn(() => valor));

const borrados = () => llamadas.filter((l) => l.metodo === "DELETE");

beforeEach(() => {
  llamadas.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("borrar un archivo desde el explorador", () => {
  it("pregunta antes, borra y avisa de la copia .bak", async () => {
    montarFetch();
    confirmar(true);
    render(<SeccionArchivos />);

    fireEvent.click(await screen.findByLabelText("Borrar config.yml"));

    await waitFor(() => expect(borrados()).toHaveLength(1));
    expect(borrados()[0].url).toContain(
      `ruta=${encodeURIComponent("plugins/VTuberDex/config.yml")}`,
    );
    expect(
      await screen.findByText(
        "Borrado plugins/VTuberDex/config.yml (queda plugins/VTuberDex/config.yml.bak).",
      ),
    ).toBeTruthy();
  });

  it("si se cancela la pregunta no se llama al servidor", async () => {
    montarFetch();
    confirmar(false);
    render(<SeccionArchivos />);

    fireEvent.click(await screen.findByLabelText("Borrar config.yml"));

    await waitFor(() => expect(llamadas.length).toBeGreaterThan(0));
    expect(borrados()).toHaveLength(0);
  });

  it("el error del servidor se cuenta en amable", async () => {
    montarFetch(() => respuesta({ error: "sin_permiso" }, false, 403));
    confirmar(true);
    render(<SeccionArchivos />);

    fireEvent.click(await screen.findByLabelText("Borrar config.yml"));

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Borrar archivos del servidor es de admin y de mantenedor.",
    );
  });

  it("un archivo de solo lectura no ofrece botón de borrar", async () => {
    montarFetch();
    confirmar(true);
    render(<SeccionArchivos />);

    await screen.findByLabelText("Borrar config.yml");
    expect(screen.queryByLabelText("Borrar del-servidor.yml")).toBeNull();
  });

  it("el .zip de la carpeta también se puede borrar", async () => {
    montarFetch();
    confirmar(true);
    render(<SeccionArchivos />);

    fireEvent.click(await screen.findByLabelText("Borrar recursos.zip"));

    await waitFor(() => expect(borrados()).toHaveLength(1));
    expect(borrados()[0].url).toContain(
      `ruta=${encodeURIComponent("plugins/VTuberDex/recursos.zip")}`,
    );
  });

  it("un cuerpo sin listas no rompe el explorador", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        llamadas.push({ url: String(entrada), metodo: undefined });
        return respuesta({});
      }),
    );
    render(<SeccionArchivos />);

    expect(await screen.findByText("Carpeta vacía.")).toBeTruthy();
  });
});
