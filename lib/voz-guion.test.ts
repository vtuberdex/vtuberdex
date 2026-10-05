import { describe, expect, it } from 'vitest';

import { guionDeFicha, idiomaProbable, limpiarTexto, MAX_HISTORIA, recortarHistoria } from './voz-guion.mjs';

const FICHA = {
  name: 'madKoding',
  slug: 'madkoding',
  countries: [{ name: 'Chile' }],
  cardText: 'Vivía tranquilamente en el Mundo VR hasta que la magia colapsó. Así llegué al mundo terrenal.',
};

describe('guionDeFicha', () => {
  it('dice nombre, país e historia, cada uno como frase', () => {
    expect(guionDeFicha(FICHA)).toEqual({
      texto: 'madKoding. Chile. Vivía tranquilamente en el Mundo VR hasta que la magia colapsó. Así llegué al mundo terrenal.',
      motivo: null,
    });
  });

  it('sin país, lo omite; no deja «undefined» ni puntos dobles', () => {
    const { texto } = guionDeFicha({ ...FICHA, countries: [] });
    expect(texto).toBe('madKoding. Vivía tranquilamente en el Mundo VR hasta que la magia colapsó. Así llegué al mundo terrenal.');
    expect(texto).not.toMatch(/undefined|\.\./);
  });

  it('sin historia no hay voz', () => {
    expect(guionDeFicha({ ...FICHA, cardText: '   ' })).toEqual({ texto: null, motivo: 'sin_historia' });
    expect(guionDeFicha({ ...FICHA, cardText: null }).motivo).toBe('sin_historia');
  });

  it('una carta de baja (grado 1) NUNCA se lee, aunque traiga datos', () => {
    expect(guionDeFicha({ ...FICHA, slug: 'deteriorada-42' })).toEqual({ texto: null, motivo: 'deteriorada' });
  });

  it('un texto en otro idioma no se lee con voz española', () => {
    expect(guionDeFicha({ ...FICHA, cardText: 'I am a virtual streamer and I love playing games with my friends.' }).motivo).toBe('idioma');
    expect(guionDeFicha({ ...FICHA, cardText: 'こんにちは、私はバーチャルYouTuberです。ゲームが大好きです。' }).motivo).toBe('idioma');
    expect(guionDeFicha({ ...FICHA, cardText: 'Привет, я виртуальный ютубер и люблю играть.' }).motivo).toBe('idioma');
  });

  it('la historia larga se corta en una frase completa, nunca a media palabra', () => {
    const frase = 'Esta es una frase de prueba bastante larga para llenar el espacio. ';
    const larga = frase.repeat(40).trim();
    const { texto } = guionDeFicha({ ...FICHA, cardText: larga });
    const historia = (texto as string).replace(/^madKoding\. Chile\. /, '');
    expect(historia.length).toBeLessThanOrEqual(MAX_HISTORIA);
    expect(historia.endsWith('.')).toBe(true);
    expect(historia.endsWith('prueba bastante larga para llenar el espacio.')).toBe(true);
  });
});

describe('limpiarTexto / idiomaProbable / recortarHistoria', () => {
  it('quita enlaces, emojis y marcas de formato', () => {
    expect(limpiarTexto('Hola 😀 **mundo** https://x.com/a  _fin_')).toBe('Hola mundo fin');
  });

  it('normaliza las letras matemáticas de Unicode de algunos nombres', () => {
    expect(limpiarTexto('𝑷𝒉𝒊𝒍𝒖𝒇𝒇𝒚 𝗚𝗜𝗙𝗧𝗦')).toBe('Philuffy GIFTS');
  });

  it('un texto español corto o sin palabras reconocibles cuenta como español', () => {
    expect(idiomaProbable('Soy un gamer tranquilo que ama la IA.')).toBe('es');
    expect(idiomaProbable('xD')).toBe('es');
    expect(idiomaProbable('')).toBe('es');
  });

  it('sin frase que quepa, corta en la última palabra y cierra con punto', () => {
    const r = recortarHistoria('palabra '.repeat(200).trim(), 50);
    expect(r.length).toBeLessThanOrEqual(51);
    expect(r.endsWith('palabra.')).toBe(true);
  });
});
