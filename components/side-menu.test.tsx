import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AppFooter } from "@/components/app-footer";
import { SideMenu } from "@/components/side-menu";

vi.mock("next/navigation", () => ({ usePathname: () => "/niveles" }));

describe("menú lateral", () => {
  it("nace cerrado, con el botón accesible", () => {
    render(<SideMenu />);
    const boton = screen.getByRole("button", { name: "Abrir menú" });
    expect(boton).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("al abrir muestra TODOS los enlaces del sitio y marca la página actual", async () => {
    render(<SideMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialogo = screen.getByRole("dialog");
    expect(dialogo).toHaveAttribute("aria-modal", "true");
    const hrefs = within(dialogo)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual([
      "/",
      "/?premium=1",
      "/inscripcion",
      "/modificacion",
      "/mi-ficha",
      "/niveles",
      "/minecraft",
      "/baja",
      "/terminos",
    ]);
    expect(
      within(dialogo).getByRole("link", { name: "Cómo funcionan los niveles" }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("se pinta en <body>, fuera de la cabecera (su backdrop-filter recortaría un fixed)", async () => {
    const { container } = render(
      <header style={{ backdropFilter: "blur(4px)" }}>
        <SideMenu />
      </header>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialogo = screen.getByRole("dialog");
    expect(container.contains(dialogo)).toBe(false);
    expect(document.body.contains(dialogo)).toBe(true);
  });

  it("Escape y el fondo lo cierran y el foco vuelve al botón", async () => {
    render(<SideMenu />);
    const boton = screen.getByRole("button", { name: "Abrir menú" });
    await userEvent.click(boton);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(boton).toHaveFocus();
    await userEvent.click(boton);
    await userEvent.click(
      screen.getByTestId("menu-lateral").firstElementChild as HTMLElement,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("el foco no se sale del panel con Tab", async () => {
    render(<SideMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    const dialogo = screen.getByRole("dialog");
    for (let i = 0; i < 20; i++) await userEvent.tab();
    expect(dialogo.contains(document.activeElement)).toBe(true);
  });

  it("bloquea el desplazamiento de la página mientras está abierto", async () => {
    render(<SideMenu />);
    await userEvent.click(screen.getByRole("button", { name: "Abrir menú" }));
    expect(document.body.style.overflow).toBe("hidden");
    await userEvent.keyboard("{Escape}");
    expect(document.body.style.overflow).not.toBe("hidden");
  });
});

describe("pie", () => {
  it("ya no lleva enlaces de navegación: solo el aviso de derechos y su enlace a la cláusula 18", () => {
    render(<AppFooter />);
    const visibles = screen
      .getAllByRole("link", { hidden: true })
      .map((a) => a.getAttribute("href"));
    expect(visibles).toEqual(["/v/archivo-completo", "/terminos#seguridad"]);
    expect(screen.getByText(/Prohibido el scraping/)).toBeInTheDocument();
  });
});
