// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `toPayload` se partió en un lector por sección (dex, nivel, perfil, atributos, habilidades, redes) para
 * bajar su complejidad. Estas pruebas fijan la salida y los mensajes de error de cada sección, que es lo
 * único que ven `buildPatch` y el asistente: el refactor no podía cambiar ni una cosa ni la otra.
 */
import { describe, expect, it } from "vitest";

import {
  createBody,
  emptyForm,
  slugifyUrl,
  toPayload,
  type EditorForm,
} from "@/components/admin/form-model";

const base = (parche: Partial<EditorForm> = {}): EditorForm => ({
  ...emptyForm(),
  name: "Ficha",
  ...parche,
});

describe("slugifyUrl", () => {
  it("normaliza a ascii con guiones y recorta los de los extremos", () => {
    expect(slugifyUrl("  ¡Hola, Señor Ñandú!  ")).toBe("hola-senor-nandu");
    expect(slugifyUrl("--a--b--")).toBe("a-b");
    expect(slugifyUrl("!!!")).toBe("");
    expect(slugifyUrl("-")).toBe("");
    expect(slugifyUrl("abc")).toBe("abc");
  });

  it("no se atasca con una cadena larga de separadores", () => {
    const largo = `${"-".repeat(50_000)}x${"!".repeat(50_000)}`;
    expect(slugifyUrl(largo)).toBe("x");
  });
});

describe("toPayload", () => {
  it("exige nombre, slug con letras y color #rrggbb", () => {
    const { errors } = toPayload(
      base({ name: " ", slug: "¡¡", themeColor: "rojo" }),
    );
    expect(errors.name).toBe("El nombre es obligatorio.");
    expect(errors.slug).toBe("La URL necesita letras o números.");
    expect(errors.themeColor).toBe("El color de marca debe ser #rrggbb.");
  });

  it("número de dex: «al final», entero, vacío o inválido", () => {
    expect(toPayload(base({ dexEnd: true })).payload.dexNumber).toBe("end");
    expect(
      toPayload(base({ dexEnd: false, dexNumber: "12" })).payload.dexNumber,
    ).toBe(12);
    const vacio = toPayload(base({ dexEnd: false, dexNumber: " " }));
    expect("dexNumber" in vacio.payload).toBe(false);
    const malo = toPayload(base({ dexEnd: false, dexNumber: "1.5" }));
    expect(malo.errors.dexNumber).toBe(
      "El número debe ser un entero positivo.",
    );
    expect("dexNumber" in malo.payload).toBe(false);
    expect(
      toPayload(base({ dexEnd: false, dexNumber: "0" })).errors.dexNumber,
    ).toBeDefined();
  });

  it("nivel: vacío es null, entero ≥ 0, y error si no", () => {
    expect(toPayload(base({ level: "" })).payload.level).toBeNull();
    expect(toPayload(base({ level: "0" })).payload.level).toBe(0);
    const malo = toPayload(base({ level: "-1" }));
    expect(malo.payload.level).toBeNull();
    expect(malo.errors.level).toBe("El nivel debe ser un entero.");
  });

  it("perfil: salta filas vacías y pide nombre", () => {
    const { payload, errors } = toPayload(
      base({
        profile: [
          { label: " ", value: " " },
          { label: " Color ", value: " Rojo " },
          { label: "", value: "suelto" },
        ],
      }),
    );
    expect(payload.profile).toEqual([{ label: "Color", value: "Rojo" }]);
    expect(errors.profile).toBe("Cada dato del perfil necesita un nombre.");
  });

  it("atributos: vacíos, sin nombre, no enteros y slug", () => {
    const vacio = { label: "", value: "", max: "", valueText: "", slug: "" };
    const { payload, errors } = toPayload(
      base({
        stats: [
          vacio,
          { ...vacio, value: "3" },
          { ...vacio, label: "ATQ", value: "2.5" },
          {
            ...vacio,
            label: " DEF ",
            value: "10",
            max: "",
            valueText: " alto ",
            slug: " def ",
          },
          { ...vacio, label: "VEL" },
        ],
      }),
    );
    expect(payload.stats).toEqual([
      { label: "DEF", value: 10, max: null, valueText: "alto", slug: "def" },
      { label: "VEL", value: null, max: null, valueText: null },
    ]);
    // El último error escrito es el que queda (el orden de las filas manda).
    expect(errors.stats).toBe(
      "El valor y el máximo de «ATQ» deben ser enteros.",
    );
    const soloSinNombre = toPayload(base({ stats: [{ ...vacio, max: "5" }] }));
    expect(soloSinNombre.errors.stats).toBe(
      "Cada atributo necesita un nombre.",
    );
  });

  it("habilidades: salta las vacías y conserva effectHtml", () => {
    const { payload } = toPayload(
      base({
        skills: [
          {
            category: "active",
            section: " ",
            type: "",
            name: "",
            effect: "",
            effectHtml: "<b>x</b>",
            factions: [],
          },
          {
            category: "passive",
            section: "",
            type: " Soporte ",
            name: " A ",
            effect: "",
            effectHtml: "",
            factions: [],
          },
        ],
      }),
    );
    expect(payload.skills).toEqual([
      {
        category: "passive",
        section: null,
        type: "Soporte",
        name: "A",
        effect: null,
        effectHtml: null,
        factions: [],
      },
    ]);
  });

  it("redes: saltan las vacías, piden plataforma y URL http(s)", () => {
    const vacia = { platform: "", label: "", url: "", icon: "" };
    const { payload, errors } = toPayload(
      base({
        socials: [
          vacia,
          { ...vacia, url: "https://x.com/a" },
          { ...vacia, platform: "YouTube", url: "ftp://a" },
          {
            ...vacia,
            platform: " X ",
            url: " https://x.com/b ",
            label: " ",
            icon: "x",
          },
        ],
      }),
    );
    expect(payload.socials).toEqual([
      { platform: "X", label: null, url: "https://x.com/b", icon: "x" },
    ]);
    expect(errors.socials).toBe(
      "La URL de «YouTube» debe empezar con http:// o https://.",
    );
  });

  it("máximo de facciones", () => {
    expect(toPayload(base({ factions: ["a", "b", "c"] })).errors.factions).toBe(
      "Máximo 2 facciones.",
    );
  });
});

describe("createBody", () => {
  it("pide nombre y valida el número", () => {
    expect(createBody(base({ name: "" })).problem).toBe(
      "Escribe un nombre para continuar.",
    );
    expect(createBody(base({ dexEnd: false, dexNumber: "x" })).problem).toBe(
      "El número debe ser un entero positivo.",
    );
    expect(
      createBody(
        base({
          slug: "Mi Ficha",
          dexEnd: false,
          dexNumber: "7",
          countries: ["cl"],
        }),
      ).body,
    ).toEqual({
      name: "Ficha",
      slug: "mi-ficha",
      dexNumber: 7,
      countries: ["cl"],
    });
  });
});
