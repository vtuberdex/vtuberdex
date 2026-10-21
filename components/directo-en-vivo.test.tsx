import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DirectoEnVivo } from "@/components/directo-en-vivo";
import { api } from "@/lib/api";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: { directo: vi.fn() } };
});

const palette = { accent: "#ff00aa", secondary: "#00aaff" };

beforeEach(() => vi.mocked(api.directo).mockReset());

describe("DirectoEnVivo", () => {
  it("sin canales no pinta nada", async () => {
    vi.mocked(api.directo).mockResolvedValue({ canales: [] });
    const { container } = render(<DirectoEnVivo slug="ana" palette={palette} />);
    await waitFor(() => expect(api.directo).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it("un error de red no rompe la ficha", async () => {
    // Función plana: el espía de vitest registra el resultado de una promesa rechazada y la da por no atendida.
    let llamadas = 0;
    const original = api.directo;
    api.directo = () => {
      llamadas += 1;
      return Promise.reject(new Error("red"));
    };
    const { container } = render(<DirectoEnVivo slug="ana" palette={palette} />);
    await waitFor(() => expect(llamadas).toBe(1));
    api.directo = original;
    expect(container).toBeEmptyDOMElement();
  });

  it("muestra el directo con título y espectadores, y los vídeos de YouTube", async () => {
    vi.mocked(api.directo).mockResolvedValue({
      canales: [
        { plataforma: "twitch", url: "https://www.twitch.tv/ana", enVivo: true, titulo: "Jugando Minecraft", espectadores: 12345, categoria: "Minecraft" },
        { plataforma: "kick", url: "https://kick.com/ana", enVivo: false },
        {
          plataforma: "youtube",
          url: "https://www.youtube.com/@ana",
          enVivo: false,
          estadisticas: { suscriptores: 50000, vistas: 100000, videos: 20 },
          videos: [{ id: "aaaaaaaaaaa", titulo: "Mi vídeo", publicado: null, miniatura: null, vistas: 10, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" }],
        },
      ],
    });
    render(<DirectoEnVivo slug="ana" palette={palette} />);
    expect(await screen.findByTestId("directo-en-vivo")).toBeInTheDocument();
    expect(screen.getByText("EN DIRECTO")).toBeInTheDocument();
    expect(screen.getByText("Jugando Minecraft")).toBeInTheDocument();
    expect(screen.getByText(/12\.345 espectadores/)).toBeInTheDocument();
    expect(screen.getByTestId("directo-kick")).toHaveTextContent("Kick: sin directo ahora");
    expect(screen.getByText(/50\.000 suscriptores/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Mi vídeo/ })).toHaveAttribute("href", "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  });
});
