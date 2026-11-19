// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  reducir,
  yaReducida,
  EMBLEMA_LADO,
  LOGO_LADO,
} from "../scripts/reducir-imagenes.mjs";

const sharp = createRequire(new URL("../server/package.json", import.meta.url))(
  "sharp",
);
const imagen = (w: number, h: number) =>
  sharp({
    create: {
      width: w,
      height: h,
      channels: 4,
      background: { r: 200, g: 30, b: 90, alpha: 0.8 },
    },
  });

describe("reducir-imagenes", () => {
  it("el emblema baja a 256 px y sigue siendo PNG (su ruta canónica es .png)", async () => {
    const r = (await reducir(
      "faction",
      await imagen(600, 600).png().toBuffer(),
    ))!;
    expect([r.w, r.h]).toEqual([EMBLEMA_LADO, EMBLEMA_LADO]);
    expect((await sharp(r.bytes).metadata()).format).toBe("png");
  });

  it("el logo se topa al ancho de la textura conservando la proporción", async () => {
    const r = (await reducir(
      "logo",
      await imagen(3000, 1000).webp().toBuffer(),
    ))!;
    expect([r.w, r.h]).toEqual([LOGO_LADO, 336]);
    expect((await sharp(r.bytes).metadata()).format).toBe("webp");
  });

  it("el personaje NO cambia de tamaño (solo se recodifica) y nada se agranda", async () => {
    const r = await reducir(
      "character",
      await imagen(720, 1008).webp({ quality: 95 }).toBuffer(),
    );
    expect([r!.w, r!.h]).toEqual([720, 1008]);
  });

  it("no vuelve a tocar lo que ya está dentro de los límites (cada pasada lossy pierde algo)", async () => {
    expect(
      await reducir("faction", await imagen(256, 256).png().toBuffer()),
    ).toBeNull();
    expect(
      await reducir("logo", await imagen(300, 100).webp().toBuffer()),
    ).toBeNull();
    expect(yaReducida("logo", 1000, 1000, 300 * 1024)).toBe(false);
    expect(yaReducida("character", 720, 1008, 10)).toBe(false);
  });
});
