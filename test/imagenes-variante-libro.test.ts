// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { urlDelLibro } from "@/lib/variante-libro.mjs";

const sharp = createRequire(import.meta.url)("sharp");
const imagen = vi.hoisted(() => ({ bytes: null as Buffer | null }));

vi.mock("@/lib/ediciones.mjs", () => ({
  tursoConfigurado: () => true,
  leerAssetRemoto: async () => ({
    bytes: imagen.bytes,
    mime: "image/webp",
    origen: "mantenedor",
    actualizado: "2026-11-19T10:00:00.000Z",
  }),
}));

const { GET } = await import("@/app/images/[...path]/route.js");
const pedir = (ruta: string, cabeceras: Record<string, string> = {}) => {
  const [carpeta, archivo] = ruta.split("?")[0].split("/");
  return GET(
    new Request(`http://local/images/${ruta}`, { headers: cabeceras }),
    {
      params: Promise.resolve({ path: [carpeta, archivo] }),
    },
  );
};

beforeAll(async () => {
  imagen.bytes = await sharp({
    create: {
      width: 720,
      height: 1008,
      channels: 3,
      background: { r: 120, g: 30, b: 200 },
    },
  })
    .webp()
    .toBuffer();
});

describe("urlDelLibro", () => {
  it("añade ?w=512 a personaje, fondo y logo, y deja los emblemas", () => {
    expect(urlDelLibro("/images/character/a.webp?v=1")).toBe(
      "/images/character/a.webp?v=1&w=512",
    );
    expect(urlDelLibro("/images/logo/a.webp")).toBe(
      "/images/logo/a.webp?w=512",
    );
    expect(urlDelLibro("/images/faction/a.png?v=2")).toBe(
      "/images/faction/a.png?v=2",
    );
    expect(urlDelLibro("")).toBe("");
  });
});

describe("/images con ?w=512 (variante del libro)", () => {
  it("devuelve la imagen a 512 de ancho, en WebP y con su propio ETag", async () => {
    const original = await pedir("character/a.webp?v=1");
    const variante = await pedir("character/a.webp?v=1&w=512");
    expect(variante.status).toBe(200);
    const meta = await sharp(
      Buffer.from(await variante.arrayBuffer()),
    ).metadata();
    expect([meta.width, meta.height]).toEqual([512, 717]);
    expect(variante.headers.get("etag")).not.toBe(original.headers.get("etag"));
    expect(variante.headers.get("cache-control")).toBe(
      original.headers.get("cache-control"),
    );
  });

  it("revalida con su ETag (304 sin cuerpo)", async () => {
    const primera = await pedir("character/a.webp?w=512");
    const etag = primera.headers.get("etag")!;
    const segunda = await pedir("character/a.webp?w=512", {
      "if-none-match": etag,
    });
    expect(segunda.status).toBe(304);
  });

  it("otro ancho u otra carpeta no generan nada (404)", async () => {
    expect((await pedir("character/a.webp?w=300")).status).toBe(404);
    expect((await pedir("faction/a.png?w=512")).status).toBe(404);
  });
});
