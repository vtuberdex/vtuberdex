import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SideMenu } from "@/components/side-menu";
import { LanguageSwitcher } from "@/components/language-switcher";
import { I18nProvider } from "@/lib/i18n";

/** Los enlaces viven en el menú lateral, que solo existe abierto. */
async function abrirMenu() {
  await userEvent.click(await screen.findByTestId("menu-abrir"));
}

function ver() {
  return render(
    <I18nProvider>
      <LanguageSwitcher />
      <SideMenu />
    </I18nProvider>,
  );
}

describe("idioma de la interfaz", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("sin preferencia ni navegador soportado, español", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["fr-FR"]);
    ver();
    await abrirMenu();
    expect(
      await screen.findByText("Términos y Condiciones"),
    ).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("es");
  });

  it("detecta el idioma del navegador", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue([
      "ja-JP",
      "en",
    ]);
    ver();
    await abrirMenu();
    expect(await screen.findByText("利用規約")).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("ja");
  });

  it("el selector cambia el idioma y lo recuerda por encima del navegador", async () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["ja"]);
    const { unmount } = ver();
    await userEvent.selectOptions(screen.getByTestId("selector-idioma"), "en");
    await abrirMenu();
    expect(await screen.findByText("Terms and Conditions")).toBeInTheDocument();
    unmount();
    ver();
    await abrirMenu();
    expect(await screen.findByText("Terms and Conditions")).toBeInTheDocument();
  });
});
