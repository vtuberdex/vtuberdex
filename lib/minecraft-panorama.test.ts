import { beforeEach, describe, expect, it } from "vitest";
import {
  analizarJugadores,
  analizarMspt,
  analizarTps,
  obtenerPanorama,
  olvidarPanorama,
} from "./minecraft-panorama.mjs";

const TPS = "§6TPS from last 1m, 5m, 15m: §a20.0§r, §a19.5§r, §a*20.0\n";
const MSPT =
  "§6Server tick times §e(§7avg§e/§7min§e/§7max§e)§6 from last 5s§7,§6 10s§7,§6 1m§e:\n§6◴ §a1.8§7/§a0.9§7/§a18.9§e, §a1.7§7/§a0.9§7/§a18.9\n";

describe("analizadores", () => {
  it("jugadores", () => {
    expect(
      analizarJugadores(
        "There are 2 of a max of 20 players online: Ana, Beto_1",
      ),
    ).toEqual({ enLinea: 2, maximo: 20, nombres: ["Ana", "Beto_1"] });
    expect(
      analizarJugadores("There are 0 of a max of 20 players online: "),
    ).toEqual({
      enLinea: 0,
      maximo: 20,
      nombres: [],
    });
    expect(analizarJugadores("otra cosa")).toBeNull();
  });
  it("tps con colores y asterisco", () => {
    expect(analizarTps(TPS)).toEqual([20, 19.5, 20]);
    expect(analizarTps("nada")).toBeNull();
  });
  it("mspt toma la ventana de 5 s", () => {
    expect(analizarMspt(MSPT)).toEqual({
      promedio: 1.8,
      minimo: 0.9,
      maximo: 18.9,
    });
    expect(analizarMspt("nada")).toBeNull();
  });
});

describe("obtenerPanorama", () => {
  beforeEach(() => olvidarPanorama());
  const falso = (ok: boolean) => {
    const llamadas: string[] = [];
    const ejecutar = async (a: string) => {
      llamadas.push(a);
      if (!ok) {
        return { ok: false, status: 502 };
      }
      return {
        ok: true,
        respuesta:
          a === "jugadores"
            ? "There are 1 of a max of 20 players online: Ana"
            : a === "tps"
              ? TPS
              : MSPT,
      };
    };
    return { ejecutar, llamadas };
  };

  it("junta los tres comandos y reutiliza el resultado reciente", async () => {
    const { ejecutar, llamadas } = falso(true);
    const a = await obtenerPanorama({
      ejecutar: ejecutar as never,
      ahora: 1000,
    });
    const b = await obtenerPanorama({
      ejecutar: ejecutar as never,
      ahora: 2000,
    });
    expect(a.rcon).toBe("ok");
    expect(a.jugadores?.enLinea).toBe(1);
    expect(b).toBe(a);
    expect(llamadas).toHaveLength(3);
  });

  it("si RCON cae, igual devuelve el sistema", async () => {
    const { ejecutar } = falso(false);
    const r = await obtenerPanorama({
      ejecutar: ejecutar as never,
      ahora: 1000,
    });
    expect(r.rcon).toBe("caido");
    expect(r.jugadores).toBeNull();
    expect(r.sistema.nucleos).toBeGreaterThan(0);
  });
});
