import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { VrtonBanners } from "@/components/vrton-banners";

describe("VrtonBanners", () => {
  it("pone un pendón a cada lado del contenido y ambos enlazan a vrton.org (licencia de los assets)", () => {
    render(
      <VrtonBanners>
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
});
