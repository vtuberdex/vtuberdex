import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MinecraftAdminPage, { metadata } from "../../app/minecraft-admin/page";

type Llamada = { url: string; init?: RequestInit };

const llamadas: Llamada[] = [];

function respuesta(cuerpo: unknown, ok = true, status = ok ? 200 : 400) {
  return {
    ok,
    status,
    json: async () => cuerpo,
    text: async () =>
      typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  } as unknown as Response;
}

function montarFetch(
  estado: unknown = { plugins: ["Vault.jar"], sesion: "dentro", rol: "admin" },
) {
  const mock = vi.fn(async (entrada: unknown, init?: RequestInit) => {
    const url = String(entrada);
    llamadas.push({ url, init });
    if (url.includes("/api/minecraft-admin/estado")) return respuesta(estado);
    if (url.includes("/api/minecraft-admin/enlace"))
      return respuesta({ enviado: true });
    if (url.includes("/api/minecraft-admin/sesion"))
      return respuesta({ sesion: "dentro" });
    if (url.includes("/api/minecraft-admin/plugins"))
      return respuesta({ plugin: "Nuevo.jar" });
    if (url.includes("/api/minecraft-admin/configuracion")) {
      if (init?.method === "PUT") return respuesta({ guardado: true });
      return respuesta({ contenido: "motd=Hola\n" });
    }
    return respuesta({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Espera a que la sesión se confirme y abre una pestaña del panel. */
async function abrirPestana(nombre: string) {
  fireEvent.click(await screen.findByRole("tab", { name: nombre }));
}

/** Sin sesión: `estado` responde 401, como la API real sin el rol de mantenedor. */
function montarSinSesion(resto?: (url: string) => Response | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, init });
      if (url.includes("/estado"))
        return respuesta({ error: "sin_sesion" }, false, 401);
      const otra = resto?.(url);
      if (otra) return otra;
      return respuesta({ enviado: true });
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

describe("dashboard en vivo", () => {
  const PANORAMA = {
    hora: "2026-11-04T12:00:00.000Z",
    rcon: "ok",
    jugadores: { enLinea: 2, maximo: 20, nombres: ["Ana", "Beto_1"] },
    tps: [19.9, 20, 20],
    mspt: { promedio: 1.8, minimo: 0.9, maximo: 18.9 },
    sistema: {
      cargaPorNucleo: 0.4,
      nucleos: 4,
      memoriaUsadaMb: 2000,
      memoriaTotalMb: 8000,
      encendidoHoras: 12,
    },
  };

  it("pinta las tarjetas con el panorama y lista a quién está en línea", async () => {
    const mock = montarFetch();
    mock.mockImplementation(async (entrada: unknown) => {
      const url = String(entrada);
      llamadas.push({ url });
      if (url.includes("/panorama")) return respuesta(PANORAMA);
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    expect(await screen.findByText("2/20")).toBeTruthy();
    expect(screen.getByText("19.9")).toBeTruthy();
    expect(screen.getByText("1.8 ms")).toBeTruthy();
    expect(screen.getByText("25 %")).toBeTruthy();
    expect(screen.getByText("Servidor en línea")).toBeTruthy();
    expect(screen.getByText("Beto_1")).toBeTruthy();
  });

  it("expulsar desde la lista manda la acción fija con ese jugador", async () => {
    const mock = montarFetch();
    mock.mockImplementation(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, init });
      if (url.includes("/panorama")) return respuesta(PANORAMA);
      if (url.includes("/rcon"))
        return respuesta({ ok: true, respuesta: "ok" });
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Expulsar a Ana" }),
    );
    await waitFor(() =>
      expect(llamadas.some((l) => l.url.includes("/rcon"))).toBe(true),
    );
    const cuerpo = String(
      llamadas.find((l) => l.url.includes("/rcon"))!.init?.body,
    );
    expect(cuerpo).toContain('"accion":"expulsar"');
    expect(cuerpo).toContain('"jugador":"Ana"');
  });

  it("con RCON caído lo dice y no inventa números", async () => {
    const mock = montarFetch();
    mock.mockImplementation(async (entrada: unknown) => {
      const url = String(entrada);
      if (url.includes("/panorama"))
        return respuesta({
          ...PANORAMA,
          rcon: "caido",
          jugadores: null,
          tps: null,
          mspt: null,
        });
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    expect(await screen.findByText("Servidor sin respuesta")).toBeTruthy();
    expect(screen.queryByText("2/20")).toBeNull();
  });
});

describe("experiencia manual", () => {
  const FICHA = {
    id: 7,
    slug: "ana",
    name: "Ana",
    dex: 7,
    level: 3,
    experience: { current: 20, max: 100, total: 220 },
    xpDeJuego: 50,
    likes: 4,
  };

  it("solo el admin ve la pestaña", async () => {
    montarFetch({ plugins: [], rol: "mantenedor" });
    const { unmount } = render(<MinecraftAdminPage />);
    await screen.findByRole("tab", { name: "Servidor" });
    expect(screen.queryByRole("tab", { name: "Experiencia" })).toBeNull();
    unmount();
    montarFetch({ plugins: [], rol: "admin" });
    render(<MinecraftAdminPage />);
    expect(
      await screen.findByRole("tab", { name: "Experiencia" }),
    ).toBeTruthy();
  });

  it("busca una ficha y manda el ajuste con cantidad y motivo", async () => {
    const mock = montarFetch({ plugins: [], rol: "admin" });
    mock.mockImplementation(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, init });
      if (url.includes("/experiencia?q="))
        return respuesta({
          fichas: [{ id: 7, slug: "ana", name: "Ana", dex: 7 }],
        });
      if (url.includes("/experiencia?ficha="))
        return respuesta({ ficha: FICHA, historial: [], maximo: 10000 });
      if (url.includes("/experiencia") && init?.method === "POST")
        return respuesta({ ok: true }, true, 201);
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Experiencia" }));
    fireEvent.change(screen.getByLabelText("Buscar ficha"), {
      target: { value: "an" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Ana/ }));
    expect(await screen.findByText("Nivel 3")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Cantidad de XP"), {
      target: { value: "150" },
    });
    fireEvent.change(screen.getByLabelText("Motivo del ajuste"), {
      target: { value: "Premio del evento" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ajuste" }));
    await waitFor(() =>
      expect(
        llamadas.some(
          (l) => l.init?.method === "POST" && l.url.includes("/experiencia"),
        ),
      ).toBe(true),
    );
    const cuerpo = String(
      llamadas.find(
        (l) => l.init?.method === "POST" && l.url.includes("/experiencia"),
      )!.init?.body,
    );
    expect(JSON.parse(cuerpo)).toEqual({
      ficha: 7,
      cantidad: 150,
      motivo: "Premio del evento",
    });
  });

  it("rechaza en el cliente una cantidad vacía o fuera de rango", async () => {
    const mock = montarFetch({ plugins: [], rol: "admin" });
    mock.mockImplementation(async (entrada: unknown) => {
      const url = String(entrada);
      llamadas.push({ url });
      if (url.includes("/experiencia?q="))
        return respuesta({
          fichas: [{ id: 7, slug: "ana", name: "Ana", dex: 7 }],
        });
      if (url.includes("/experiencia?ficha="))
        return respuesta({ ficha: FICHA, historial: [], maximo: 10000 });
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    fireEvent.click(await screen.findByRole("tab", { name: "Experiencia" }));
    fireEvent.change(screen.getByLabelText("Buscar ficha"), {
      target: { value: "an" },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Ana/ }));
    await screen.findByText("Nivel 3");
    fireEvent.change(screen.getByLabelText("Cantidad de XP"), {
      target: { value: "99999" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aplicar ajuste" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /hasta 10000/,
    );
    expect(llamadas.some((l) => l.init?.method === "POST")).toBe(false);
  });
});

describe("/minecraft-admin", () => {
  it("renderiza el listado de plugins, la subida y el editor de configuración", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    await abrirPestana("Plugins");
    expect(await screen.findByText("Vault.jar")).toBeTruthy();
    expect(screen.getByText(/Plugins instalados/)).toBeTruthy();
    expect(screen.getByText("Subir plugin")).toBeTruthy();
    await abrirPestana("Configuración");
    expect(screen.getByLabelText("Contenido de la configuración")).toBeTruthy();
  });

  it("sin sesión solo muestra el formulario del enlace: nada del mantenedor", async () => {
    montarSinSesion();
    render(<MinecraftAdminPage />);
    expect(await screen.findByText("Entrar con enlace mágico")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText(/Plugins instalados/)).toBeNull();
    expect(screen.queryByText("Subir plugin")).toBeNull();
    expect(screen.queryByLabelText("Contenido de la configuración")).toBeNull();
    expect(screen.queryByLabelText("Comando RCON")).toBeNull();
  });

  it("mientras comprueba la sesión no pinta nada del mantenedor", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<MinecraftAdminPage />);
    expect(screen.getByText("Comprobando la sesión…")).toBeTruthy();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Entrar con enlace mágico")).toBeNull();
  });

  it("no hay consola libre: ningún campo acepta un comando", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    await screen.findByRole("button", { name: "Quién juega" });
    expect(screen.queryByLabelText("Comando RCON")).toBeNull();
    expect(screen.queryByText(/consola rcon/i)).toBeNull();
  });

  it("un mantenedor que no es admin sube jars y edita la configuración, pero no veta", async () => {
    montarFetch({ plugins: ["Vault.jar"], rol: "mantenedor" });
    render(<MinecraftAdminPage />);
    await screen.findByRole("button", { name: "Quién juega" });
    expect(screen.getByRole("tab", { name: "Configuración" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Vetar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Quitar veto" })).toBeNull();
    expect(screen.getByRole("button", { name: "Expulsar" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Plugins" }));
    expect(await screen.findByText("Vault.jar")).toBeTruthy();
    expect(screen.getByText("Subir plugin")).toBeTruthy();
  });

  it("una acción rápida envía su comando fijo", async () => {
    const mock = montarFetch();
    mock.mockImplementation(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, init });
      if (url.includes("/rcon"))
        return respuesta({ ok: true, respuesta: "Saved" });
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Guardar mundo" }),
    );
    expect(await screen.findByText(/Saved/)).toBeTruthy();
    expect(
      String(llamadas.find((l) => l.url.includes("/rcon"))!.init?.body),
    ).toContain('"accion":"guardar"');
  });

  it("expulsar exige un nombre válido y lleva el motivo", async () => {
    const mock = montarFetch();
    mock.mockImplementation(async (entrada: unknown, init?: RequestInit) => {
      const url = String(entrada);
      llamadas.push({ url, init });
      if (url.includes("/rcon"))
        return respuesta({ ok: true, respuesta: "Kicked" });
      return respuesta({ plugins: [], rol: "admin" });
    });
    render(<MinecraftAdminPage />);
    const nombre = await screen.findByLabelText("Nombre del jugador");
    fireEvent.click(screen.getByRole("button", { name: "Expulsar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(llamadas.some((l) => l.url.includes("/rcon"))).toBe(false);
    fireEvent.change(nombre, { target: { value: "Steve" } });
    fireEvent.change(screen.getByLabelText("Motivo"), {
      target: { value: "spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Expulsar" }));
    expect(await screen.findByText(/Kicked/)).toBeTruthy();
    expect(
      String(llamadas.find((l) => l.url.includes("/rcon"))!.init?.body),
    ).toContain('"accion":"expulsar"');
  });

  it("no se indexa y la ruta pública es /minecraft-admin", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.title).toContain("Minecraft");
  });

  it("pide el enlace mágico con el correo del mantenedor", async () => {
    montarSinSesion();
    render(<MinecraftAdminPage />);
    fireEvent.change(await screen.findByPlaceholderText("correo@example.com"), {
      target: { value: "mantenedor@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el enlace" }));
    await waitFor(() => {
      const llamada = llamadas.find((l) =>
        l.url.includes("/api/minecraft-admin/enlace"),
      );
      expect(llamada).toBeTruthy();
    });
    const llamada = llamadas.find((l) =>
      l.url.includes("/api/minecraft-admin/enlace"),
    )!;
    if (typeof llamada.init?.body === "string") {
      expect(llamada.init.body).toContain("mantenedor@example.com");
    }
    expect(
      await screen.findByText(
        "Si el correo puede administrar el servidor, el enlace va en camino.",
      ),
    ).toBeTruthy();
  });

  it("sube el jar elegido con el nombre en la url", async () => {
    montarFetch();
    const { container } = render(<MinecraftAdminPage />);
    await abrirPestana("Plugins");
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const archivo = new File([new Uint8Array([1, 2, 3])], "Nuevo.jar", {
      type: "application/java-archive",
    });
    fireEvent.change(input, { target: { files: [archivo] } });
    fireEvent.click(screen.getByRole("button", { name: "Subir .jar" }));
    await waitFor(() => {
      const subida = llamadas.find((l) => l.url.includes("/plugins?nombre="));
      expect(subida).toBeTruthy();
    });
    const subida = llamadas.find((l) => l.url.includes("/plugins?nombre="))!;
    expect(decodeURIComponent(subida.url)).toContain("Nuevo.jar");
    expect(subida.init?.method).toBe("POST");
  });

  it("abre la configuración del servidor y la guarda", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    await abrirPestana("Configuración");
    fireEvent.click(screen.getByRole("radio", { name: /server\.properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const area = screen.getByLabelText(
      "Contenido de la configuración",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toContain("motd=Hola"));
    fireEvent.change(area, { target: { value: "motd=Nuevo\n" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar configuración" }),
    );
    await waitFor(() => {
      const guardado = llamadas.find(
        (l) => l.url.includes("/configuracion") && l.init?.method === "PUT",
      );
      expect(guardado).toBeTruthy();
      expect(String(guardado!.init!.body)).toContain("motd=Nuevo");
    });
  });

  it("abre la configuración de un plugin por su nombre de archivo", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    await abrirPestana("Configuración");
    fireEvent.click(screen.getByRole("radio", { name: /Plugin/ }));
    fireEvent.change(screen.getByLabelText("Archivo del plugin"), {
      target: { value: "config.yml" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await waitFor(() => {
      const abierta = llamadas.find(
        (l) =>
          l.url.includes("/configuracion?") && l.url.includes("tipo=plugin"),
      );
      expect(abierta).toBeTruthy();
      expect(decodeURIComponent(abierta!.url)).toContain("config.yml");
    });
  });

  it("muestra el error cuando la api rechaza la subida", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        const url = String(entrada);
        llamadas.push({ url });
        if (url.includes("/plugins"))
          return respuesta({ error: "solo .jar" }, false);
        return respuesta({ plugins: [], rol: "admin" });
      }),
    );
    const { container } = render(<MinecraftAdminPage />);
    await abrirPestana("Plugins");
    const input = container.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { files: [new File([new Uint8Array([1])], "malo.zip")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Subir .jar" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("avisa cuando el enlace del fragmento ya no se puede canjear", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        const url = String(entrada);
        llamadas.push({ url });
        if (url.includes("/sesion"))
          return respuesta({ error: "enlace_invalido" }, false);
        return respuesta({ plugins: [], rol: "admin" });
      }),
    );
    window.location.hash = "#t=token-caducado";
    render(<MinecraftAdminPage />);
    expect(
      await screen.findByText("el enlace caducó o ya se usó: pide otro"),
    ).toBeTruthy();
    expect(window.location.hash).toBe("");
  });

  it("muestra el mensaje del error cuando la petición del enlace revienta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        const url = String(entrada);
        llamadas.push({ url });
        if (url.includes("/estado"))
          return respuesta({ error: "sin_sesion" }, false, 401);
        throw new Error("sin red");
      }),
    );
    render(<MinecraftAdminPage />);
    fireEvent.change(await screen.findByPlaceholderText("correo@example.com"), {
      target: { value: "mantenedor@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el enlace" }));
    expect(await screen.findByText("sin red")).toBeTruthy();
  });

  it("no intenta subir nada si no hay archivo elegido", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    await abrirPestana("Plugins");
    fireEvent.click(screen.getByRole("button", { name: "Subir .jar" }));
    expect(await screen.findByText("elige un archivo .jar")).toBeTruthy();
    expect(llamadas.some((l) => l.url.includes("/plugins?nombre="))).toBe(
      false,
    );
  });

  it("muestra el error de la api al abrir la configuración", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        const url = String(entrada);
        llamadas.push({ url });
        if (url.includes("/configuracion"))
          return respuesta({ error: "no_existe" }, false);
        return respuesta({ plugins: [], rol: "admin" });
      }),
    );
    render(<MinecraftAdminPage />);
    await abrirPestana("Configuración");
    fireEvent.click(screen.getByRole("radio", { name: /server\.properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    expect(await screen.findByText("no_existe")).toBeTruthy();
  });

  it("muestra el error cuando el guardado de la configuración revienta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown, init?: RequestInit) => {
        const url = String(entrada);
        llamadas.push({ url, init });
        if (url.includes("/configuracion")) {
          if (init?.method === "PUT") throw new Error("se cayó el guardado");
          return respuesta({ contenido: "motd=Hola\n" });
        }
        return respuesta({ plugins: [], rol: "admin" });
      }),
    );
    render(<MinecraftAdminPage />);
    await abrirPestana("Configuración");
    fireEvent.click(screen.getByRole("radio", { name: /server\.properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const area = screen.getByLabelText(
      "Contenido de la configuración",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toContain("motd=Hola"));
    fireEvent.click(
      screen.getByRole("button", { name: "Guardar configuración" }),
    );
    expect(await screen.findByText("se cayó el guardado")).toBeTruthy();
  });
});
