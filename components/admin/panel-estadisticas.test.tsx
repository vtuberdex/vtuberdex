import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { AdminStats } from "@/lib/types";
import { PanelEstadisticas } from "@/components/admin/panel-estadisticas";

const base: AdminStats = {
  totals: { total: 10, withDetail: 7, notPublished: 3, sinProblemas: 6 },
  estados: { published: 7, draft: 2, hidden: 1 },
  themes: 4,
  quality: [],
  paises: [],
  facciones: [],
  grados: [],
  correo: null,
  solicitudes: null,
};

describe("PanelEstadisticas · EXP de editor", () => {
  test("pinta el valor de expEditor que devuelve la API", () => {
    render(
      <PanelEstadisticas
        stats={{ ...base, expEditor: { actor: "admin", total: 120 } }}
      />,
    );
    const etiqueta = screen.getByText("EXP de editor");
    expect(etiqueta.parentElement).toHaveTextContent("120");
  });

  test("sin expEditor muestra 0 y no se rompe", () => {
    render(<PanelEstadisticas stats={base} />);
    expect(screen.getByText("EXP de editor").parentElement).toHaveTextContent(
      "0",
    );
  });
});
