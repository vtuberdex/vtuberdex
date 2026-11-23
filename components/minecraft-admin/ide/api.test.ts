import { describe, expect, it } from "vitest";

import { esComprimido, esJar, lenguajeDe, nombreDe, padre, tamanoLegible, unir } from "./api";

describe("utilidades de rutas y tipos", () => {
  it("une, separa y nombra rutas relativas", () => {
    expect(unir("", "a")).toBe("a");
    expect(unir("plugins", "a.yml")).toBe("plugins/a.yml");
    expect(padre("plugins/a/b.yml")).toBe("plugins/a");
    expect(padre("b.yml")).toBe("");
    expect(nombreDe("plugins/a/b.yml")).toBe("b.yml");
  });

  it("tamaños legibles", () => {
    expect(tamanoLegible(10)).toBe("10 B");
    expect(tamanoLegible(2048)).toBe("2.0 KB");
    expect(tamanoLegible(50 * 1024 * 1024)).toBe("50 MB");
    expect(tamanoLegible(3 * 1024 ** 3)).toBe("3.0 GB");
  });

  it("lenguaje de Monaco por extensión", () => {
    expect(lenguajeDe("plugins/x/config.yml")).toBe("yaml");
    expect(lenguajeDe("server.properties")).toBe("ini");
    expect(lenguajeDe("a.json")).toBe("json");
    expect(lenguajeDe("start.sh")).toBe("shell");
    expect(lenguajeDe("Dockerfile")).toBe("dockerfile");
    expect(lenguajeDe("LEEME")).toBe("plaintext");
  });

  it("reconoce comprimidos y jars", () => {
    expect(esComprimido("a.zip")).toBe(true);
    expect(esComprimido("a.tar.gz")).toBe(true);
    expect(esComprimido("a.yml")).toBe(false);
    expect(esJar("Foo.jar")).toBe(true);
    expect(esJar("Foo.jar.disabled")).toBe(true);
    expect(esJar("Foo.zip")).toBe(false);
  });
});
