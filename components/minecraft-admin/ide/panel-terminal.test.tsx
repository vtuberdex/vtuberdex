/**
 * Terminal de la pestaña «Archivos»: abre o reengancha sesiones, pinta la salida que llega por SSE,
 * agrupa lo tecleado en POST con X-Panel, redimensiona y cierra. xterm y EventSource son dobles.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { terminales, fuentes } = vi.hoisted(() => ({
  terminales: [] as Array<{
    escrito: Uint8Array[];
    reiniciada: number;
    alTeclear: (d: string) => void;
    rows: number;
    cols: number;
  }>,
  fuentes: [] as Array<{
    url: string;
    onopen: (() => void) | null;
    onmessage: ((ev: { data: string }) => void) | null;
    onerror: (() => void) | null;
    readyState: number;
    oyentes: Record<string, () => void>;
    cerrada: boolean;
  }>,
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    rows = 30;
    cols = 120;
    escrito: Uint8Array[] = [];
    reiniciada = 0;
    alTeclear: (d: string) => void = () => {};
    constructor() {
      terminales.push(this);
    }
    loadAddon() {}
    open() {}
    write(b: Uint8Array) {
      this.escrito.push(b);
    }
    reset() {
      this.reiniciada += 1;
    }
    onData(fn: (d: string) => void) {
      this.alTeclear = fn;
      return { dispose() {} };
    }
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { PanelTerminal } from "./panel-terminal";

class FuenteDoble {
  static CLOSED = 2;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 1;
  oyentes: Record<string, () => void> = {};
  cerrada = false;
  constructor(url: string) {
    this.url = url;
    fuentes.push(this);
  }
  addEventListener(nombre: string, fn: () => void) {
    this.oyentes[nombre] = fn;
  }
  close() {
    this.cerrada = true;
    this.readyState = 2;
  }
}

type Llamada = { url: string; init?: RequestInit };
const llamadas: Llamada[] = [];
const json = (c: unknown, status = 200) => ({ ok: status < 400, status, json: async () => c }) as unknown as Response;

function montar(abiertas: unknown[] = []) {
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (u: unknown, init?: RequestInit) => {
      const url = String(u);
      llamadas.push({ url, init });
      if (url === "/api/minecraft-admin/terminal" && !init?.method) {return json({ terminales: abiertas });}
      if (url === "/api/minecraft-admin/terminal" && init?.method === "POST") {
        n += 1;
        return json({ id: `nueva-${n}-xxxxxx`, titulo: "bash", creada: 1, terminada: false }, 201);
      }
      return json({ ok: true });
    }),
  );
}

beforeEach(() => {
  llamadas.length = 0;
  terminales.length = 0;
  fuentes.length = 0;
  vi.stubGlobal("EventSource", FuenteDoble);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PanelTerminal", () => {
  it("sin sesiones abre una, pinta la salida y manda lo tecleado con X-Panel", async () => {
    montar();
    render(<PanelTerminal pedido={null} alError={() => {}} />);
    await waitFor(() => expect(fuentes.length).toBe(1));
    expect(fuentes[0].url).toBe("/api/minecraft-admin/terminal/nueva-1-xxxxxx");
    await waitFor(() => expect(terminales.length).toBe(1));

    act(() => fuentes[0].onmessage?.({ data: btoa("hola") }));
    expect(new TextDecoder().decode(terminales[0].escrito[0])).toBe("hola");

    act(() => {
      terminales[0].alTeclear("l");
      terminales[0].alTeclear("s\r");
    });
    await waitFor(() => {
      const entrada = llamadas.find((l) => l.url.includes("op=entrada"));
      expect(entrada).toBeTruthy();
      expect(new TextDecoder().decode(entrada?.init?.body as Uint8Array)).toBe("ls\r");
      expect((entrada?.init?.headers as Record<string, string>)["x-panel"]).toBe("1");
    });
  });

  it("reengancha las abiertas, limpia al reconectar y marca el fin", async () => {
    montar([{ id: "vieja-123456", titulo: "bash", creada: 1, terminada: false }]);
    render(<PanelTerminal pedido={null} alError={() => {}} />);
    await waitFor(() => expect(terminales.length).toBe(1));
    expect(llamadas.some((l) => l.init?.method === "POST")).toBe(false);
    act(() => fuentes[0].onopen?.());
    act(() => fuentes[0].onopen?.());
    expect(terminales[0].reiniciada).toBe(1);
    act(() => fuentes[0].oyentes.fin());
    expect(fuentes[0].cerrada).toBe(true);
    expect(await screen.findByText(/✕ bash 1/)).toBeTruthy();
  });

  it("un pedido del explorador se escribe en la terminal activa", async () => {
    montar([{ id: "vieja-123456", titulo: "bash", creada: 1, terminada: false }]);
    const { rerender } = render(<PanelTerminal pedido={null} alError={() => {}} />);
    await waitFor(() => expect(terminales.length).toBe(1));
    rerender(<PanelTerminal pedido={{ texto: "cd '/srv/minecraft/plugins'\r", n: 1 }} alError={() => {}} />);
    await waitFor(() => {
      const entrada = llamadas.find((l) => l.url.includes("op=entrada"));
      expect(new TextDecoder().decode(entrada?.init?.body as Uint8Array)).toContain("cd '/srv/minecraft/plugins'");
    });
  });

  it("«+ Nueva» abre otra y la × la cierra con DELETE", async () => {
    montar([{ id: "vieja-123456", titulo: "bash", creada: 1, terminada: false }]);
    render(<PanelTerminal pedido={null} alError={() => {}} />);
    await waitFor(() => expect(terminales.length).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "+ Nueva" }));
    expect(await screen.findByText(/bash 2/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar terminal 1" }));
    await waitFor(() =>
      expect(llamadas.some((l) => l.init?.method === "DELETE" && l.url.endsWith("/vieja-123456"))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText(/bash 2/)).toBeNull());
    expect(screen.getByText(/bash 1/)).toBeTruthy();
  });

  it("si la API falla lo avisa", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "agente_caido" }, 502)),
    );
    const alError = vi.fn();
    render(<PanelTerminal pedido={null} alError={alError} />);
    await waitFor(() => expect(alError).toHaveBeenCalled());
    expect(String(alError.mock.calls[0][0])).toMatch(/no responde/);
    expect(await screen.findByText(/Sin terminales/)).toBeTruthy();
  });
});
