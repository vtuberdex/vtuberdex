/**
 * Pestaña «Archivos y plugins» (`EspacioArchivos`): explorador sobre toda la carpeta, editor y el
 * estado de los plugins en el árbol. Monaco y xterm se sustituyen por dobles (no corren en jsdom).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { EditorDoble } = vi.hoisted(() => ({
  EditorDoble: ({
    ruta,
    valorInicial,
    alCambiar,
    alGuardar,
  }: {
    ruta: string;
    valorInicial: string;
    alCambiar: (v: string) => void;
    alGuardar: () => void;
  }) => (
    <div>
      <textarea aria-label={`editor ${ruta}`} defaultValue={valorInicial} onChange={(e) => alCambiar(e.target.value)} />
      <button type="button" onClick={alGuardar}>
        guardar-doble
      </button>
    </div>
  ),
}));
// `next/dynamic` carga Monaco en el navegador; aquí se sustituye por el doble directamente.
vi.mock("next/dynamic", () => ({ default: () => EditorDoble }));
vi.mock("./panel-terminal", () => ({
  PanelTerminal: ({ pedido }: { pedido: { texto: string } | null }) => <div data-testid="terminal">{pedido?.texto ?? ""}</div>,
}));

import { EspacioArchivos } from "./espacio-archivos";

type Llamada = { url: string; init?: RequestInit };
const llamadas: Llamada[] = [];

const json = (cuerpo: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => cuerpo }) as unknown as Response;

const RAIZ = {
  ruta: "",
  modo: "770",
  entradas: [
    { nombre: "plugins", tipo: "dir", bytes: 0, modificado: 1, modo: "770" },
    { nombre: "server.properties", tipo: "archivo", bytes: 10, modificado: 1, modo: "660" },
  ],
};
const PLUGINS = {
  ruta: "plugins",
  modo: "770",
  entradas: [
    { nombre: "Foo", tipo: "dir", bytes: 0, modificado: 1, modo: "770" },
    { nombre: "Foo.jar", tipo: "archivo", bytes: 2048, modificado: 1, modo: "660" },
  ],
};

function montar(respuestas: (url: string, init?: RequestInit) => Response | undefined = () => undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, init });
      const propia = respuestas(url, init);
      if (propia) {return propia;}
      if (url.includes("op=listar") && url.includes("ruta=plugins")) {return json(PLUGINS);}
      if (url.includes("op=listar")) {return json(RAIZ);}
      if (url.includes("op=leer")) {
        return json({ ruta: "server.properties", bytes: 10, modificado: 111, modo: "660", contenido: "motd=Hola\n" });
      }
      if (url.endsWith("/api/minecraft-admin/plugins")) {
        return json({
          plugins: [
            {
              archivo: "Foo.jar",
              nombre: "Foo",
              version: "1.2",
              descripcion: "Un plugin",
              autores: ["Ana"],
              bytes: 2048,
              habilitado: true,
              cargado: true,
              estado: "activo",
              protegido: false,
            },
          ],
        });
      }
      return json({ ok: true });
    }),
  );
}

beforeEach(() => {
  llamadas.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const cabecera = (init: RequestInit | undefined, nombre: string) =>
  (init?.headers as Record<string, string> | undefined)?.[nombre];

describe("EspacioArchivos", () => {
  it("lista la raíz del servidor, abre carpetas y marca el estado de cada plugin", async () => {
    montar();
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("plugins"));
    expect(await screen.findByText("Foo.jar")).toBeTruthy();
    expect(await screen.findByLabelText("Activo")).toBeTruthy();
  });

  it("un jar de plugins abre su ficha y se desactiva con X-Panel", async () => {
    montar();
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("plugins"));
    await screen.findByLabelText("Activo");
    fireEvent.click(screen.getByText("Foo.jar"));
    expect(await screen.findByText("Un plugin")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desactivar" }));
    await waitFor(() => {
      const l = llamadas.find((x) => x.url.includes("/plugins/estado"));
      expect(l).toBeTruthy();
      expect(JSON.parse(String(l?.init?.body))).toEqual({ archivo: "Foo.jar", habilitado: false });
      expect(cabecera(l?.init, "x-panel")).toBe("1");
    });
  });

  it("abre un archivo, lo edita y guarda con la fecha que leyó", async () => {
    montar();
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("server.properties"));
    const editor = await screen.findByLabelText("editor server.properties");
    fireEvent.change(editor, { target: { value: "motd=Chao\n" } });
    fireEvent.click(screen.getByText("guardar-doble"));
    await waitFor(() => {
      const put = llamadas.find((x) => x.init?.method === "PUT");
      expect(put?.url).toContain("ruta=server.properties");
      expect(put?.url).toContain("modificado=111");
      expect(put?.init?.body).toBe("motd=Chao\n");
      expect(cabecera(put?.init, "x-panel")).toBe("1");
    });
  });

  it("si el archivo cambió en disco pregunta y reintenta forzando", async () => {
    let intentos = 0;
    montar((url, init) => {
      if (init?.method !== "PUT") {return undefined;}
      intentos += 1;
      return intentos === 1
        ? json({ error: "cambiado_en_disco", detail: "server.properties" }, 409)
        : json({ bytes: 10, modificado: 222 });
    });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("server.properties"));
    fireEvent.change(await screen.findByLabelText("editor server.properties"), { target: { value: "x=1\n" } });
    fireEvent.click(screen.getByText("guardar-doble"));
    await waitFor(() => expect(intentos).toBe(2));
    expect(confirmar).toHaveBeenCalled();
    expect(llamadas.filter((x) => x.init?.method === "PUT")[1].url).toContain("forzar=1");
  });

  it("el menú contextual cambia permisos y abre una terminal en la carpeta", async () => {
    montar();
    render(<EspacioArchivos />);
    fireEvent.contextMenu(await screen.findByText("plugins"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Permisos…" }));
    fireEvent.change(screen.getByLabelText("Permisos en octal"), { target: { value: "755" } });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar 755" }));
    await waitFor(() => {
      const l = llamadas.find((x) => String(x.init?.body ?? "").includes('"permisos"'));
      expect(JSON.parse(String(l?.init?.body))).toMatchObject({ accion: "permisos", ruta: "plugins", modo: "755" });
    });

    fireEvent.contextMenu(screen.getByText("plugins"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Abrir terminal aquí" }));
    expect(screen.getByTestId("terminal").textContent).toContain("cd '/srv/minecraft/plugins'");
  });

  it("borrar pide confirmación y no hace nada si se cancela", async () => {
    montar();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EspacioArchivos />);
    fireEvent.contextMenu(await screen.findByText("server.properties"));
    fireEvent.click(screen.getByRole("menuitem", { name: /Borrar/ }));
    expect(llamadas.some((x) => String(x.init?.body ?? "").includes('"borrar"'))).toBe(false);
  });
});
