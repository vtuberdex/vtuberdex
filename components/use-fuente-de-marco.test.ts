// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFuenteDeMarco } from "./use-fuente-de-marco";

describe("useFuenteDeMarco", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sin fuente propia no carga nada y la versión se queda en 0", () => {
    const load = vi.fn();
    vi.stubGlobal("document", Object.assign(document, { fonts: { load } }));
    const { result } = renderHook(() => useFuenteDeMarco(undefined));
    expect(result.current).toBe(0);
    expect(load).not.toHaveBeenCalled();
  });

  it("con Minecrafter la pide y sube la versión al estar lista, para redibujar la hoja", async () => {
    const load = vi.fn().mockResolvedValue([{}]);
    vi.stubGlobal("document", Object.assign(document, { fonts: { load } }));
    const { result } = renderHook(() => useFuenteDeMarco("Minecrafter"));
    await waitFor(() => expect(result.current).toBe(1));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("si la fuente no carga la versión no sube (la hoja ya se dibujó con la de respaldo)", async () => {
    const load = vi.fn().mockRejectedValue(new Error("red"));
    vi.stubGlobal("document", Object.assign(document, { fonts: { load } }));
    const { result } = renderHook(() => useFuenteDeMarco("Minecrafter"));
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBe(0);
  });
});
