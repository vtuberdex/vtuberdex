// @vitest-environment node
import { describe, expect, it } from "vitest";

import { validarArchivoSuelto } from "./minecraft-archivos.mjs";

/** Rechazo de la validación. */
type Rechazo = { ok: boolean; status: number; cuerpo: { error: string } };

const valida = (nombre: string) =>
  validarArchivoSuelto({ nombre, tamano: 10 }) as unknown as Rechazo & {
    nombre?: string;
  };

/**
 * Un resource pack de CraftEngine (overlay de armadura 3D) son shaders GLSL y texturas: antes la
 * lista cerrada los rechazaba y el equipo no podía subirlos por el panel.
 */
describe("validarArchivoSuelto y los recursos de resource pack", () => {
  it("acepta shaders y texturas del pack", () => {
    for (const nombre of [
      "armadura_abisal.fsh",
      "armadura_abisal.vsh",
      "overlay.glsl",
      "overlay.frag",
      "overlay.vert",
      "overlay.geom",
      "pack.mcmeta",
      "textura.png",
    ]) {
      expect(valida(nombre).ok, nombre).toBe(true);
    }
  });

  it("no distingue mayúsculas en la extensión", () => {
    expect(valida("OVERLAY.FSH").ok).toBe(true);
    expect(valida("Textura.PNG").ok).toBe(true);
  });

  it("sigue aceptando lo de siempre (configuración y modelos)", () => {
    for (const nombre of ["config.yml", "items.json", "notas.txt", "moto.bbmodel"]) {
      expect(valida(nombre).ok, nombre).toBe(true);
    }
  });

  it("sigue cerrada a lo que no hace falta en un pack", () => {
    for (const nombre of ["pack.rar", "textura.psd", "notas.doc", "pack"]) {
      const r = valida(nombre);
      expect(r.ok, nombre).toBe(false);
      expect(r.status).toBe(415);
    }
  });

  it("nunca acepta ejecutables ni scripts, aunque el pack los lleve dentro", () => {
    for (const nombre of [
      "instalar.sh",
      "arranque.bat",
      "script.py",
      "plugin.jar",
      "core.class",
      "lib.dll",
      "atajo.lnk",
    ]) {
      const r = valida(nombre);
      expect(r.ok, nombre).toBe(false);
      expect(r.status).toBe(415);
    }
  });
});
