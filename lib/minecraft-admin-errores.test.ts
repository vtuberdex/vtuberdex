import { describe, expect, it } from "vitest";

// El módulo es `.mjs` y no declara tipos: se importa de forma laxa para que
// `tsc --noEmit` (job `validar` de CI) no se queje.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const admin = (await import("@/lib/minecraft-admin.mjs")) as any;

// Estas entradas recorren las ramas de rechazo de los dos validadores de texto
// (server.properties y configuración de plugin): vacío, solo comentarios, línea sin
// `clave=valor`, clave vacía, clave con espacios, texto desmedido y texto normal.
const ENTRADAS = [
  "",
  "   ",
  "\n\n",
  "# solo un comentario\n",
  "sin-igual\n",
  "=20\n",
  "clave=\n",
  "clave rara=1\n",
  "motd=hola\nmax-players=20\n",
  "a".repeat(200_000),
];

describe("ramas de rechazo de server.properties y de la configuración del plugin", () => {
  // La misma comprobación sirve para los dos validadores, así el bloque de aserciones
  // no se copia en cada prueba.
  const comprobarRechazoLegible = (revision: unknown) => {
    expect(revision).toBeTypeOf("object");
    const r = revision as {
      ok: boolean;
      status?: number;
      cuerpo?: { error?: unknown };
    };
    if (!r.ok) {
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(typeof r.cuerpo?.error).toBe("string");
    }
  };

  it("analizarServerProperties nunca lanza y rechaza con un error legible", () => {
    for (const texto of ENTRADAS) {
      comprobarRechazoLegible(admin.analizarServerProperties(texto));
    }
  });

  it("validarConfiguracionDePlugin nunca lanza y rechaza con un error legible", () => {
    for (const texto of ENTRADAS) {
      comprobarRechazoLegible(admin.validarConfiguracionDePlugin(texto));
    }
  });

  it("una configuración vacía se rechaza como vacía", () => {
    const revision = admin.validarConfiguracionDePlugin("");
    expect(revision.ok).toBe(false);
    expect(revision.status).toBe(400);
    expect(revision.cuerpo.error).toBe("vacio");
  });

  it("una configuración por encima del límite se rechaza como demasiado grande", () => {
    const revision = admin.validarConfiguracionDePlugin("a".repeat(2_000_000));
    expect(revision.ok).toBe(false);
    expect(revision.cuerpo.error).toBe("configuracion_demasiado_grande");
  });

  it("un token de sesión inventado no abre sesión", () => {
    expect(admin.leerSesionMantenedor("basura")).toBeNull();
  });
});
