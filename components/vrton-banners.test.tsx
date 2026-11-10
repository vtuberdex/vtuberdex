import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VRTON_VISIBLE, VrtonBanners } from "@/components/vrton-banners";

describe("VrtonBanners", () => {
  it("pone un pendón a cada lado del contenido y ambos enlazan a vrton.org (licencia de los assets)", () => {
    render(
      <VrtonBanners visible>
        <main>galería</main>
      </VrtonBanners>,
    );
    const pendones = screen.getAllByTestId("pendon-vrton");
    expect(pendones).toHaveLength(2);
    const [izq, der] = pendones;
    const centro = screen.getByText("galería");
    expect(
      izq.compareDocumentPosition(centro) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      centro.compareDocumentPosition(der) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const p of pendones) {
      expect(p.querySelector("a")?.getAttribute("href")).toBe(
        "https://vrton.org/",
      );
    }
  });

  it("lleva un estandarte horizontal para tablet y celular que también enlaza a vrton.org", () => {
    render(
      <VrtonBanners visible>
        <main>galería</main>
      </VrtonBanners>,
    );
    const estandarte = screen.getByTestId("estandarte-vrton");
    expect(estandarte.querySelector("a")?.getAttribute("href")).toBe(
      "https://vrton.org/",
    );
    // Solo se ve debajo de `xl`: arriba lo sustituyen los pendones laterales.
    expect(estandarte.className).toContain("xl:hidden");
  });

  it("ocultos por defecto: sin pendones ni estandarte, y el contenido se muestra igual", () => {
    expect(VRTON_VISIBLE).toBe(false);
    const { container } = render(
      <VrtonBanners>
        <main>galería</main>
      </VrtonBanners>,
    );
    expect(screen.getByText("galería")).toBeTruthy();
    expect(screen.queryByTestId("pendon-vrton")).toBeNull();
    expect(screen.queryByTestId("estandarte-vrton")).toBeNull();
    expect(container.querySelector('a[href="https://vrton.org/"]')).toBeNull();
    // Sin `.pendon-h` en la página, globals.css no reserva el alto del estandarte.
    expect(container.querySelector(".pendon-h")).toBeNull();
  });
});
