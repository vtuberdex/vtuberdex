import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  FactionManager,
  esSubfaccionHuerfana,
} from "@/components/admin/faction-manager";
import { FactionWizard, faltaMadre } from "@/components/admin/faction-wizard";
import type { FactionRow } from "@/lib/types";

/** Una facción del catálogo con lo mínimo que pinta el mantenedor. */
const faccion = (parche: Partial<FactionRow>): FactionRow => ({
  id: 1,
  slug: "glovecaller",
  label: "Glovecaller",
  icon: "images/faction/glovecaller.png",
  parentId: null,
  parentSlug: null,
  parentLabel: null,
  total: 3,
  publicadas: 2,
  ...parche,
});

describe("subfacciones del catálogo", () => {
  it("detecta la huérfana: nombre «Madre (Propia)» sin madre guardada", () => {
    expect(esSubfaccionHuerfana(faccion({ label: "Glovecaller (Elfs)" }))).toBe(
      true,
    );
    expect(
      esSubfaccionHuerfana(
        faccion({ label: "Glovecaller (Elfs)", parentId: 1, parentSlug: "glovecaller" }),
      ),
    ).toBe(false);
    expect(esSubfaccionHuerfana(faccion({ label: "Glovecaller" }))).toBe(false);
  });

  it("la madre solo es obligatoria cuando se marca que es una subfacción", () => {
    expect(faltaMadre(false, null)).toBe(false);
    expect(faltaMadre(true, null)).toBe(true);
    expect(faltaMadre(true, 7)).toBe(false);
  });

  it("avisa en el mantenedor de la subfacción que se quedó sin madre", () => {
    render(
      <FactionManager
        token="token"
        factions={[
          faccion({}),
          faccion({
            id: 2,
            slug: "glovecaller-elfs",
            label: "Glovecaller (Elfs)",
            icon: null,
          }),
        ]}
        onItems={() => {}}
      />,
    );
    const avisos = screen.getByTestId("faction-huerfanas");
    expect(avisos).toHaveTextContent("Glovecaller (Elfs)");
    expect(avisos).toHaveTextContent(/no tiene facción madre/);
  });
});

describe("alta de facción", () => {
  it("pide la facción madre solo al marcar que pertenece a otra", () => {
    render(
      <FactionWizard
        token="token"
        factions={[faccion({})]}
        onItems={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Glovecaller (Elfs)" },
    });
    // Por defecto es raíz: no hay desplegable de madre ni se exige.
    expect(screen.queryByLabelText("Facción madre")).toBeNull();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();

    fireEvent.click(
      screen.getByLabelText("Sí: pertenece a una facción madre"),
    );
    expect(screen.getByLabelText("Facción madre")).toBeInTheDocument();
    // Marcada como subfacción sin madre no deja avanzar, y dice por qué.
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDisabled();
    expect(
      screen.getByText(/Elige la facción madre, o marca que no pertenece/),
    ).toBeInTheDocument();
  });

  it("al elegir la madre escribe el nombre como «Madre (Propia)» y deja continuar", () => {
    render(
      <FactionWizard
        token="token"
        factions={[
          faccion({}),
          faccion({ id: 2, slug: "mythical-legacy", label: "Mythical Legacy" }),
        ]}
        onItems={() => {}}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Elfs" },
    });
    fireEvent.click(
      screen.getByLabelText("Sí: pertenece a una facción madre"),
    );
    fireEvent.change(screen.getByLabelText("Facción madre"), {
      target: { value: "1" },
    });
    expect(screen.getByRole("textbox")).toHaveValue("Glovecaller (Elfs)");
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeEnabled();
  });
});
