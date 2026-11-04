import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import MinecraftAdminPage, { metadata } from "../../app/minecraft-admin/page";

type Llamada = { url: string; init?: RequestInit };

const llamadas: Llamada[] = [];

function respuesta(cuerpo: unknown, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    json: async () => cuerpo,
    text: async () => (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo)),
  } as unknown as Response;
}

function montarFetch(estado: unknown = { plugins: ["Vault.jar"], sesion: "dentro" }) {
  const mock = vi.fn(async (entrada: unknown, init?: RequestInit) => {
    const url = String(entrada);
    llamadas.push({ url, init });
    if (url.includes("/api/minecraft-admin/estado")) return respuesta(estado);
    if (url.includes("/api/minecraft-admin/enlace")) return respuesta({ enviado: true });
    if (url.includes("/api/minecraft-admin/sesion")) return respuesta({ sesion: "dentro" });
    if (url.includes("/api/minecraft-admin/plugins")) return respuesta({ plugin: "Nuevo.jar" });
    if (url.includes("/api/minecraft-admin/configuracion")) {
      if (init?.method === "PUT") return respuesta({ guardado: true });
      return respuesta({ contenido: "motd=Hola\n" });
    }
    return respuesta({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  llamadas.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("/minecraft-admin", () => {
  it("renderiza el listado de plugins, la subida y el editor de configuración", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    expect(await screen.findByText("Vault.jar")).toBeTruthy();
    expect(screen.getByText("Plugins instalados")).toBeTruthy();
    expect(screen.getByText("Subir plugin")).toBeTruthy();
    expect(screen.getByLabelText("Contenido de la configuración")).toBeTruthy();
  });

  it("no se indexa y la ruta pública es /minecraft-admin", () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
    expect(metadata.title).toContain("Minecraft");
  });

  it("pide el enlace mágico con el correo del mantenedor", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    fireEvent.change(screen.getByPlaceholderText("correo@example.com"), {
      target: { value: "mantenedor@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el enlace" }));
    await waitFor(() => {
      const llamada = llamadas.find((l) => l.url.includes("/api/minecraft-admin/enlace"));
      expect(llamada).toBeTruthy();
    });
    const llamada = llamadas.find((l) => l.url.includes("/api/minecraft-admin/enlace"))!;
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
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
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
    fireEvent.click(screen.getByRole("radio", { name: /server\.properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const area = screen.getByLabelText("Contenido de la configuración") as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toContain("motd=Hola"));
    fireEvent.change(area, { target: { value: "motd=Nuevo\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
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
    fireEvent.click(screen.getByRole("radio", { name: /Plugin/ }));
    fireEvent.change(screen.getByLabelText("Archivo del plugin"), {
      target: { value: "config.yml" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    await waitFor(() => {
      const abierta = llamadas.find(
        (l) => l.url.includes("/configuracion?") && l.url.includes("tipo=plugin"),
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
        if (url.includes("/plugins")) return respuesta({ error: "solo .jar" }, false);
        return respuesta({ plugins: [] });
      }),
    );
    const { container } = render(<MinecraftAdminPage />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
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
        if (url.includes("/sesion")) return respuesta({ error: "enlace_invalido" }, false);
        return respuesta({ plugins: [] });
      }),
    );
    window.location.hash = "#t=token-caducado";
    render(<MinecraftAdminPage />);
    expect(await screen.findByText("el enlace caducó o ya se usó: pide otro")).toBeTruthy();
    expect(window.location.hash).toBe("");
  });

  it("muestra el mensaje del error cuando la petición del enlace revienta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        const url = String(entrada);
        llamadas.push({ url });
        if (url.includes("/estado")) return respuesta({ plugins: [] });
        throw new Error("sin red");
      }),
    );
    render(<MinecraftAdminPage />);
    fireEvent.change(screen.getByPlaceholderText("correo@example.com"), {
      target: { value: "mantenedor@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviarme el enlace" }));
    expect(await screen.findByText("sin red")).toBeTruthy();
  });

  it("no intenta subir nada si no hay archivo elegido", async () => {
    montarFetch();
    render(<MinecraftAdminPage />);
    fireEvent.click(screen.getByRole("button", { name: "Subir .jar" }));
    expect(await screen.findByText("elige un archivo .jar")).toBeTruthy();
    expect(llamadas.some((l) => l.url.includes("/plugins?nombre="))).toBe(false);
  });

  it("muestra el error de la api al abrir la configuración", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (entrada: unknown) => {
        const url = String(entrada);
        llamadas.push({ url });
        if (url.includes("/configuracion")) return respuesta({ error: "no_existe" }, false);
        return respuesta({ plugins: [] });
      }),
    );
    render(<MinecraftAdminPage />);
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
        return respuesta({ plugins: [] });
      }),
    );
    render(<MinecraftAdminPage />);
    fireEvent.click(screen.getByRole("radio", { name: /server\.properties/ }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const area = screen.getByLabelText("Contenido de la configuración") as HTMLTextAreaElement;
    await waitFor(() => expect(area.value).toContain("motd=Hola"));
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
    expect(await screen.findByText("se cayó el guardado")).toBeTruthy();
  });
});
