/**
 * Pestaña «Archivos y plugins» (`EspacioArchivos`): explorador sobre toda la carpeta, editor y el
 * estado de los plugins en el árbol. Monaco y xterm se sustituyen por dobles (no corren en jsdom).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    { nombre: "pack.zip", tipo: "archivo", bytes: 300, modificado: 1, modo: "664" },
    { nombre: "mundo.dat", tipo: "archivo", bytes: 99, modificado: 1, modo: "664" },
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

/** Cuerpos JSON de las acciones mandadas a `/fs` (POST sin `op`). */
const acciones = () =>
  llamadas
    .filter((x) => x.url === "/api/minecraft-admin/fs" && x.init?.method === "POST")
    .map((x) => JSON.parse(String(x.init?.body)) as Record<string, unknown>);

async function menuSobre(texto: string, opcion: string | RegExp) {
  const arbol = await screen.findByRole("tree");
  fireEvent.contextMenu(await within(arbol).findByText(texto, { exact: true }));
  fireEvent.click(screen.getByRole("menuitem", { name: opcion }));
}

function escribirEnDialogo(valor: string) {
  const campo = screen.getByRole("dialog").querySelector("input") as HTMLInputElement;
  fireEvent.focus(campo);
  fireEvent.change(campo, { target: { value: valor } });
  fireEvent.click(screen.getByRole("button", { name: "Aceptar" }));
}

describe("EspacioArchivos: operaciones", () => {
  it("nuevo archivo y nueva carpeta desde el menú de una carpeta", async () => {
    montar();
    render(<EspacioArchivos />);
    await menuSobre("plugins", "Nuevo archivo…");
    escribirEnDialogo("nuevo.yml");
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "archivo", ruta: "plugins/nuevo.yml" }));
    await menuSobre("plugins", "Nueva carpeta…");
    escribirEnDialogo("Datos");
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "carpeta", ruta: "plugins/Datos" }));
  });

  it("renombrar (menú y F2), mover a y duplicar", async () => {
    montar();
    render(<EspacioArchivos />);
    await menuSobre("server.properties", /^Renombrar…/);
    escribirEnDialogo("server.old");
    await waitFor(() =>
      expect(acciones()).toContainEqual({ accion: "mover", de: "server.properties", a: "server.old" }),
    );

    fireEvent.contextMenu(screen.getByText("pack.zip"));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    escribirEnDialogo("otro.zip");
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "mover", de: "pack.zip", a: "otro.zip" }));

    await menuSobre("pack.zip", "Mover a…");
    escribirEnDialogo("/plugins/pack.zip");
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "mover", de: "pack.zip", a: "plugins/pack.zip" }));

    await menuSobre("pack.zip", "Duplicar");
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "copiar", de: "pack.zip", a: "pack copia.zip" }));
  });

  it("si el destino existe pide confirmación y reintenta sobrescribiendo", async () => {
    let veces = 0;
    montar((url, init) => {
      if (url !== "/api/minecraft-admin/fs" || init?.method !== "POST") {return undefined;}
      veces += 1;
      return veces === 1 ? json({ error: "ya_existe" }, 409) : json({ ok: true });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EspacioArchivos />);
    await menuSobre("pack.zip", "Duplicar");
    await waitFor(() => expect(acciones()[1]).toMatchObject({ accion: "copiar", sobrescribir: true }));
  });

  it("extraer aquí, extraer en carpeta y comprimir", async () => {
    montar();
    render(<EspacioArchivos />);
    await menuSobre("pack.zip", "Extraer aquí");
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "descomprimir", ruta: "pack.zip", destino: "" }));
    await menuSobre("pack.zip", "Extraer en «pack/»");
    await waitFor(() =>
      expect(acciones()).toContainEqual({ accion: "descomprimir", ruta: "pack.zip", destino: "pack" }),
    );
    await menuSobre("plugins", "Comprimir en .zip");
    await waitFor(() =>
      expect(acciones()).toContainEqual({ accion: "comprimir", rutas: ["plugins"], destino: "plugins.zip" }),
    );
  });

  it("borrar con confirmación manda la acción", async () => {
    montar();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<EspacioArchivos />);
    await screen.findByText("pack.zip");
    fireEvent.click(screen.getByText("plugins"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "Delete" });
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "borrar", rutas: ["plugins"] }));
  });

  it("permisos con casillas y recursivo", async () => {
    montar();
    render(<EspacioArchivos />);
    await menuSobre("plugins", "Permisos…");
    fireEvent.click(screen.getByLabelText("Otros: Leer"));
    fireEvent.click(screen.getByLabelText("Grupo: Escribir"));
    fireEvent.click(screen.getByLabelText("Aplicar a todo lo que hay dentro"));
    fireEvent.click(screen.getByRole("button", { name: "Aplicar 754" }));
    await waitFor(() =>
      expect(acciones()).toContainEqual({ accion: "permisos", ruta: "plugins", modo: "754", recursivo: true }),
    );
  });

  it("descargar abre la URL y copiar ruta usa el portapapeles", async () => {
    montar();
    const abrir = vi.spyOn(window, "open").mockReturnValue(null);
    const copiar = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: copiar }, configurable: true });
    render(<EspacioArchivos />);
    await menuSobre("plugins", "Descargar (.tar.gz)");
    expect(abrir).toHaveBeenCalledWith("/api/minecraft-admin/fs?op=descargar&ruta=plugins", "_blank");
    await menuSobre("plugins", "Copiar ruta");
    expect(copiar).toHaveBeenCalledWith("/srv/minecraft/plugins");
  });

  it("sube archivos elegidos y una carpeta con sus rutas relativas", async () => {
    montar();
    const { container } = render(<EspacioArchivos />);
    await menuSobre("plugins", "Subir archivos…");
    const [archivos, carpeta] = container.querySelectorAll('input[type="file"]');
    fireEvent.change(archivos, { target: { files: [new File(["a"], "a.yml")] } });
    await waitFor(() =>
      expect(llamadas.some((x) => x.url.includes("op=subir") && x.url.includes("ruta=plugins%2Fa.yml"))).toBe(true),
    );
    await menuSobre("plugins", "Subir carpeta…");
    const enCarpeta = new File(["b"], "b.yml");
    Object.defineProperty(enCarpeta, "webkitRelativePath", { value: "Pack/sub/b.yml" });
    fireEvent.change(carpeta, { target: { files: [enCarpeta] } });
    await waitFor(() =>
      expect(llamadas.some((x) => x.url.includes("ruta=plugins%2FPack%2Fsub%2Fb.yml"))).toBe(true),
    );
  });

  it("si al subir ya existe pregunta una vez y sobrescribe", async () => {
    montar((url) =>
      url.includes("op=subir") && !url.includes("sobrescribir") ? json({ error: "ya_existe" }, 409) : undefined,
    );
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { container } = render(<EspacioArchivos />);
    await menuSobre("plugins", "Subir archivos…");
    fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [new File(["a"], "a.yml"), new File(["b"], "b.yml")] },
    });
    await waitFor(() => expect(llamadas.filter((x) => x.url.includes("sobrescribir=1")).length).toBe(2));
    expect(confirmar).toHaveBeenCalledTimes(1);
  });

  it("instalar .zip: sube a un temporal, extrae en la carpeta y borra el temporal", async () => {
    montar();
    const { container } = render(<EspacioArchivos />);
    await menuSobre("plugins", "Instalar .zip aquí (subir y extraer)…");
    const zip = container.querySelectorAll('input[type="file"]')[2];
    fireEvent.change(zip, { target: { files: [new File(["z"], "pack.zip")] } });
    await waitFor(() => {
      const a = acciones();
      expect(a.find((x) => x.accion === "descomprimir")).toMatchObject({ destino: "plugins" });
      expect(a.find((x) => x.accion === "borrar")).toBeTruthy();
    });
    expect(llamadas.some((x) => x.url.includes("op=subir") && x.url.includes(".subida-"))).toBe(true);
  });

  it("arrastrar dentro del árbol mueve; soltar archivos del escritorio los sube", async () => {
    montar();
    render(<EspacioArchivos />);
    const zip = await screen.findByText("pack.zip");
    const destino = screen.getByText("plugins");
    const datos: Record<string, string> = {};
    const dataTransfer = {
      setData: (k: string, v: string) => {
        datos[k] = v;
      },
      getData: (k: string) => datos[k] ?? "",
      types: ["application/x-mc-ruta"],
      items: [],
      files: [],
      dropEffect: "",
      effectAllowed: "",
    };
    fireEvent.dragStart(zip, { dataTransfer });
    fireEvent.dragOver(destino, { dataTransfer });
    fireEvent.drop(destino, { dataTransfer });
    await waitFor(() => expect(acciones()).toContainEqual({ accion: "mover", de: "pack.zip", a: "plugins/pack.zip" }));

    const archivo = new File(["x"], "suelto.txt");
    fireEvent.drop(destino, {
      dataTransfer: { getData: () => "", types: ["Files"], items: [], files: [archivo] },
    });
    await waitFor(() => expect(llamadas.some((x) => x.url.includes("ruta=plugins%2Fsuelto.txt"))).toBe(true));
  });

  it("un binario no se edita, ofrece descargar; cerrar con cambios pregunta", async () => {
    montar((url) =>
      url.includes("op=leer") && url.includes("mundo.dat")
        ? json({ ruta: "mundo.dat", bytes: 99, modificado: 1, modo: "664", binario: true })
        : undefined,
    );
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("mundo.dat"));
    expect(await screen.findByText(/es binario/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Descargar" }).getAttribute("href")).toContain("ruta=mundo.dat");

    fireEvent.click(screen.getByText("server.properties"));
    fireEvent.change(await screen.findByLabelText("editor server.properties"), { target: { value: "x" } });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar server.properties" }));
    expect(confirmar).toHaveBeenCalled();
    expect(screen.getByLabelText("editor server.properties")).toBeTruthy();
    confirmar.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar server.properties" }));
    await waitFor(() => expect(screen.queryByLabelText("editor server.properties")).toBeNull());
  });

  it("recargar del disco vuelve a leer; la barra alterna terminal y pantalla completa", async () => {
    montar();
    const { container } = render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("server.properties"));
    await screen.findByLabelText("editor server.properties");
    const lecturas = () => llamadas.filter((x) => x.url.includes("op=leer")).length;
    const antes = lecturas();
    fireEvent.click(screen.getByRole("button", { name: "Recargar del disco" }));
    await waitFor(() => expect(lecturas()).toBe(antes + 1));
    expect(await screen.findByLabelText("editor server.properties")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Ocultar terminal/ }));
    expect(screen.queryByTestId("terminal")).toBeNull();
    fireEvent.keyDown(window, { key: "`", ctrlKey: true });
    expect(screen.getByTestId("terminal")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pantalla completa" }));
    expect(container.firstElementChild?.className).toContain("fixed");
  });

  it("la ficha del plugin muestra su registro y abre su carpeta", async () => {
    montar((url) =>
      url.includes("/registros") ? json({ lineas: ["[Foo] cargado", "[Foo] listo"] }) : undefined,
    );
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("plugins"));
    await screen.findByLabelText("Activo");
    fireEvent.click(screen.getByText("Foo.jar"));
    fireEvent.click(await screen.findByRole("button", { name: "Ver registro" }));
    expect(await screen.findByText(/\[Foo\] listo/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Abrir su carpeta de configuración" }));
    await waitFor(() => expect(llamadas.some((x) => x.url.includes("ruta=plugins%2FFoo"))).toBe(true));
  });

  it("los errores de la API salen en la barra de estado", async () => {
    montar((url) => (url.includes("op=leer") ? json({ error: "agente_caido" }, 502) : undefined));
    render(<EspacioArchivos />);
    fireEvent.click(await screen.findByText("server.properties"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/no responde/);
    fireEvent.click(screen.getByRole("button", { name: "Cerrar aviso" }));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
