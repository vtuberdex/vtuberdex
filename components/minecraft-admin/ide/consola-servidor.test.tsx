/**
 * Consola del servidor (pestaña fija del panel de abajo de «Archivos»): sigue el registro sin repetir
 * líneas, manda comandos por RCON con X-Panel y pinta la respuesta o el error del servidor.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CADA_MS, ConsolaServidor, lineasNuevas } from "./consola-servidor";

const json = (c: unknown, status = 200) => ({ ok: status < 400, status, json: async () => c }) as unknown as Response;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("lineasNuevas", () => {
  it("devuelve solo lo que viene después de lo ya visto", () => {
    expect(lineasNuevas([], ["a", "b"])).toEqual(["a", "b"]);
    expect(lineasNuevas(["a", "b", "c"], ["b", "c", "d", "e"])).toEqual(["d", "e"]);
    expect(lineasNuevas(["a", "b", "c"], ["a", "b", "c"])).toEqual([]);
  });

  it("usa la última aparición del ancla aunque haya líneas repetidas", () => {
    expect(lineasNuevas(["x", "y", "x", "y"], ["x", "y", "x", "y", "z"])).toEqual(["z"]);
  });

  it("si el registro empezó de nuevo, todo es nuevo", () => {
    expect(lineasNuevas(["a", "b", "c"], ["1", "2"])).toEqual(["1", "2"]);
  });
});

describe("ConsolaServidor", () => {
  it("pinta el registro y, al sondear, añade solo las líneas nuevas", async () => {
    let cola = ["[10:00:00 INFO]: Done", "[10:00:01 WARN]: lento"];
    const fetch = vi.fn(async (u: unknown) => {
      expect(String(u)).toMatch(/^\/api\/minecraft-admin\/registros\?lineas=300$/);
      return json({ lineas: cola });
    });
    vi.stubGlobal("fetch", fetch);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<ConsolaServidor visible />);
    expect(await screen.findByText("[10:00:01 WARN]: lento")).toBeTruthy();

    cola = [...cola, "[10:00:02 INFO]: Steve joined the game"];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CADA_MS);
    });
    expect(await screen.findByText(/Steve joined/)).toBeTruthy();
    expect(screen.getAllByText("[10:00:00 INFO]: Done")).toHaveLength(1);
  });

  it("no sondea mientras está oculta", async () => {
    const fetch = vi.fn(async () => json({ lineas: [] }));
    vi.stubGlobal("fetch", fetch);
    render(<ConsolaServidor visible={false} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("manda el comando (sin la barra) con X-Panel y muestra la respuesta", async () => {
    const llamadas: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: unknown, init?: RequestInit) => {
        llamadas.push({ url: String(u), init });
        if (init?.method === "POST") {
          return json({ ok: true, comando: "list", respuesta: "There are 1 of a max of 20 players online: Steve" });
        }
        return json({ lineas: [] });
      }),
    );
    render(<ConsolaServidor visible />);
    const campo = screen.getByRole("textbox", { name: "Comando del servidor" });
    fireEvent.change(campo, { target: { value: "/list" } });
    fireEvent.submit(campo);
    expect(await screen.findByText(/max of 20 players online/)).toBeTruthy();
    expect(screen.getByText("> list")).toBeTruthy();
    const post = llamadas.find((l) => l.init?.method === "POST");
    expect(post?.url).toBe("/api/minecraft-admin/consola");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ comando: "list" });
    expect((post?.init?.headers as Record<string, string>)["x-panel"]).toBe("1");

    // ↑ recupera el último comando.
    fireEvent.keyDown(campo, { key: "ArrowUp" });
    expect((campo as HTMLInputElement).value).toBe("list");
  });

  it("si el servidor rechaza el comando, muestra el motivo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_u: unknown, init?: RequestInit) =>
        init?.method === "POST"
          ? json({ error: "comando_no_permitido", detail: "solo admin" }, 403)
          : json({ lineas: [] }),
      ),
    );
    render(<ConsolaServidor visible />);
    const campo = screen.getByRole("textbox", { name: "Comando del servidor" });
    fireEvent.change(campo, { target: { value: "op Steve" } });
    fireEvent.submit(campo);
    expect(await screen.findByText(/comando no permitido: solo admin/)).toBeTruthy();
  });
});
