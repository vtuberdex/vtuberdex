import { describe, expect, it } from "vitest";

import {
  guionDeFicha,
  idiomaProbable,
  limpiarTexto,
  MAX_HISTORIA,
  quitarPreambuloDeIA,
  recortarHistoria,
} from "./voz-guion.mjs";

const FICHA = {
  name: "madKoding",
  slug: "madkoding",
  countries: [{ name: "Chile" }],
  cardText:
    "Vivía tranquilamente en el Mundo VR hasta que la magia colapsó. Así llegué al mundo terrenal.",
};

describe("guionDeFicha", () => {
  it("dice nombre, país e historia, cada uno como frase", () => {
    expect(guionDeFicha(FICHA)).toEqual({
      texto:
        "madKoding. Chile. Vivía tranquilamente en el Mundo VR hasta que la magia colapsó. Así llegué al mundo terrenal.",
      motivo: null,
    });
  });

  it("sin país, lo omite; no deja «undefined» ni puntos dobles", () => {
    const { texto } = guionDeFicha({ ...FICHA, countries: [] });
    expect(texto).toBe(
      "madKoding. Vivía tranquilamente en el Mundo VR hasta que la magia colapsó. Así llegué al mundo terrenal.",
    );
    expect(texto).not.toMatch(/undefined|\.\./);
  });

  it("sin historia no hay voz", () => {
    expect(guionDeFicha({ ...FICHA, cardText: "   " })).toEqual({
      texto: null,
      motivo: "sin_historia",
    });
    expect(guionDeFicha({ ...FICHA, cardText: null }).motivo).toBe(
      "sin_historia",
    );
  });

  it("una carta de baja (grado 1) NUNCA se lee, aunque traiga datos", () => {
    expect(guionDeFicha({ ...FICHA, slug: "deteriorada-42" })).toEqual({
      texto: null,
      motivo: "deteriorada",
    });
  });

  it("un texto en otro idioma no se lee con voz española", () => {
    expect(
      guionDeFicha({
        ...FICHA,
        cardText:
          "I am a virtual streamer and I love playing games with my friends.",
      }).motivo,
    ).toBe("idioma");
    expect(
      guionDeFicha({
        ...FICHA,
        cardText:
          "こんにちは、私はバーチャルYouTuberです。ゲームが大好きです。",
      }).motivo,
    ).toBe("idioma");
    expect(
      guionDeFicha({
        ...FICHA,
        cardText: "Привет, я виртуальный ютубер и люблю играть.",
      }).motivo,
    ).toBe("idioma");
  });

  it("la historia larga se corta en una frase completa, nunca a media palabra", () => {
    const frase =
      "Esta es una frase de prueba bastante larga para llenar el espacio. ";
    const larga = frase.repeat(40).trim();
    const { texto } = guionDeFicha({ ...FICHA, cardText: larga });
    const historia = (texto as string).replace(/^madKoding\. Chile\. /, "");
    expect(historia.length).toBeLessThanOrEqual(MAX_HISTORIA);
    expect(historia.endsWith(".")).toBe(true);
    expect(
      historia.endsWith("prueba bastante larga para llenar el espacio."),
    ).toBe(true);
  });
});

describe("limpiarTexto / idiomaProbable / recortarHistoria", () => {
  it("quita enlaces, emojis y marcas de formato", () => {
    expect(limpiarTexto("Hola 😀 **mundo** https://x.com/a  _fin_")).toBe(
      "Hola mundo fin",
    );
  });

  it("normaliza las letras matemáticas de Unicode de algunos nombres", () => {
    expect(limpiarTexto("𝑷𝒉𝒊𝒍𝒖𝒇𝒇𝒚 𝗚𝗜𝗙𝗧𝗦")).toBe("Philuffy GIFTS");
  });

  it("un texto español corto o sin palabras reconocibles cuenta como español", () => {
    expect(idiomaProbable("Soy un gamer tranquilo que ama la IA.")).toBe("es");
    expect(idiomaProbable("xD")).toBe("es");
    expect(idiomaProbable("")).toBe("es");
  });

  it("sin frase que quepa, corta en la última palabra y cierra con punto", () => {
    const r = recortarHistoria("palabra ".repeat(200).trim(), 50);
    expect(r.length).toBeLessThanOrEqual(51);
    expect(r.endsWith("palabra.")).toBe(true);
  });
});

describe("quitarPreambuloDeIA", () => {
  it("quita la cortesía del chatbot pegada al inicio de la historia", () => {
    const f = {
      ...FICHA,
      cardText:
        "¡Hola, Paima! Aquí tienes la versión corregida y pulida de tu presentación, manteniendo toda la esencia de tu historia: ¡Soy Paima! Un ingeniero autodidacta.",
    };
    expect(guionDeFicha(f).texto).toBe(
      "madKoding. Chile. ¡Soy Paima! Un ingeniero autodidacta.",
    );
  });

  it("no toca historias reales que usan frases parecidas", () => {
    for (const t of [
      "Pensé que debería grabarlas, así que aquí estamos: a jugar.",
      "Aquí tienes a un gamer tranquilo. Por supuesto: me gusta dormir.",
      "Claro, soy un zorro: nada más.",
    ]) {
      expect(quitarPreambuloDeIA(t)).toBe(t);
    }
  });

  it("da lo mismo que el regex original (antes de recorrerlo a mano)", () => {
    // El patrón de antes, tal cual: la referencia de la semántica.
    const original =
      /^(?:[¡!]?\s*(?:hola|claro|por supuesto|vale|listo)\b[^:.!?]{0,40}[!.,]?\s*)?(?:aqu[ií] (?:tienes|est[aá]|va)|te (?:dejo|paso|presento))\b[^:]{0,200}(?:versi[oó]n|texto|presentaci[oó]n|descripci[oó]n|historia|biograf[ií]a|lore)[^:]{0,200}:\s*/i;
    const conOriginal = (t: string) => {
      const m = original.exec(t);
      return m ? t.slice(m[0].length) : t;
    };
    const piezas = [
      "¡", "!", " ", "  ", "\n", "Hola", "hola", "CLARO", "Por supuesto", "vale", "listo",
      "listos", ",", ".", "?", ":", " Paima", "aquí tienes", "Aquí está", "aqui va", "te dejo",
      "te paso", "te presento", "tienes", "la versión", "tu texto", "LORE", "historia", "biografía",
      "x".repeat(35), "y".repeat(190), "z".repeat(9), "ñ", "á",
    ];
    // Generador determinista (Park-Miller: el producto cabe exacto en un double), para que la prueba
    // no cambie de una corrida a otra.
    let semilla = 12345;
    const azar = (n: number) => {
      semilla = (semilla * 48271) % 2147483647;
      return semilla % n;
    };
    let conPreambulo = 0;
    for (let k = 0; k < 4000; k += 1) {
      let t = "";
      const n = 1 + azar(12);
      for (let j = 0; j < n; j += 1) {
        t += piezas[azar(piezas.length)];
      }
      if (azar(2)) {
        t = `${["", "¡Hola, Paima! ", "Claro, ", "Por supuesto. "][azar(4)]}${["Aquí tienes", "te dejo", "aquí va"][azar(3)]}${t}`;
      }
      if (azar(2)) {
        t += ["la historia", " texto", "lore"][azar(3)] + [": fin", ":  ¡Soy yo!", ""][azar(3)];
      }
      const esperado = conOriginal(t);
      if (esperado !== t) {
        conPreambulo += 1;
      }
      expect(quitarPreambuloDeIA(t), JSON.stringify(t)).toBe(esperado);
    }
    // Que la comparación ejercite los dos caminos, no solo «no toca nada».
    expect(conPreambulo).toBeGreaterThan(100);
  });
});
