import { describe, expect, test } from "vitest";

import {
  correoDeAcceso,
  correoDeBienvenida,
  correoDeSolicitud,
  correoSinFicha,
  urlDelSitio,
} from "@/lib/correo.mjs";

const env = { SITE_URL: "https://vtuberdex.com/" } as never;
const token = "abcDEF123_-abcDEF123_-abcDEF123_-abcDEF123";

describe("correos de solicitud", () => {
  test.each(["inscripcion", "modificacion", "baja"] as const)(
    "%s: enlace con el token en el fragmento, en HTML y en texto plano",
    (tipo) => {
      const { asunto, texto, html } = correoDeSolicitud({ tipo, token }, env);
      // La inscripción y los cambios abren el formulario en el paso del código; la baja confirma en `/verificar`.
      const enlace = `https://vtuberdex.com/${tipo === "baja" ? "verificar" : tipo}#t=${token}`;
      expect(texto).toContain(enlace);
      expect(html).toContain(`href="${enlace}"`);
      expect(asunto).toMatch(/^(Confirma|Tu código)/);
      expect(texto).toMatch(/(24 horas|1 hora)/);
    },
  );

  test("el correo de baja NO repite lo que escribió quien la pidió (podía ser otra persona)", () => {
    const { asunto, html, texto } = correoDeSolicitud(
      { tipo: "baja", token, nombre: '<script>alert(1)</script> "x"' } as never,
      env,
    );
    expect(html).not.toContain("script");
    expect(texto).not.toContain("Ficha:");
    expect(asunto).not.toMatch(/script/);
  });

  test("el aviso «sin ficha» no lleva código ni enlace de confirmación, solo el de inscribirse", () => {
    for (const tipo of ["baja", "modificacion"] as const) {
      const { asunto, texto } = correoSinFicha({ tipo }, env);
      expect(asunto).toMatch(/No encontramos tu ficha/);
      expect(texto).toContain("/inscripcion");
      expect(texto).not.toMatch(/#t=/);
    }
  });

  test("la inscripción y los cambios llevan el código en claro para pegarlo en el formulario; la baja también", () => {
    for (const tipo of ["inscripcion", "modificacion", "baja"] as const) {
      expect(correoDeSolicitud({ tipo, token }, env).texto).toMatch(
        new RegExp(`O pega este código en [^\\n]+:\\n${token}`),
      );
    }
  });

  test("la inscripción cuenta que lo escrito queda como borrador", () => {
    expect(
      correoDeSolicitud({ tipo: "inscripcion", token }, env).texto,
    ).toMatch(/borrador/);
  });

  test("la baja avisa de que es irreversible", () => {
    expect(correoDeSolicitud({ tipo: "baja", token }, env).texto).toMatch(
      /irreversible/,
    );
  });

  test("un tipo desconocido falla en vez de mandar un correo vacío", () => {
    expect(() =>
      correoDeSolicitud({ tipo: "otro" as never, token }, env),
    ).toThrow();
  });
});

describe("correo de acceso", () => {
  test("lleva el enlace al mantenedor, vale 15 minutos y avisa de no reenviarlo", () => {
    const { asunto, texto, html } = correoDeAcceso({ token }, env);
    expect(texto).toContain(`https://vtuberdex.com/admin#entrar=${token}`);
    expect(html).toContain("/admin#entrar=");
    expect(texto).toMatch(/15 minutos/);
    expect(texto).toMatch(/no reenvíes/);
    expect(asunto).toMatch(/mantenedor/);
  });
});

test("la URL sale de SITE_URL sin barra final, nunca de una cabecera", () => {
  expect(urlDelSitio({ SITE_URL: "https://vtuberdex.com/" } as never)).toBe(
    "https://vtuberdex.com",
  );
  expect(urlDelSitio({} as never)).toBe("http://localhost:3000");
});

describe("correo de bienvenida", () => {
  test("lleva el enlace público de la ficha y ningún token", () => {
    const { asunto, texto, html } = correoDeBienvenida(
      { nombre: "Luna", slug: "luna" },
      env,
    );
    expect(asunto).toContain("Luna");
    expect(texto).toContain("https://vtuberdex.com/v/luna");
    expect(html).toContain('href="https://vtuberdex.com/v/luna"');
    expect(texto).not.toContain("#t=");
  });

  test("el nombre se escapa en el HTML", () => {
    const { html } = correoDeBienvenida(
      { nombre: "<script>x</script>", slug: "a" },
      env,
    );
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script&gt;");
  });
});
