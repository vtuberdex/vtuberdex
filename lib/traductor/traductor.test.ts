import { afterEach, describe, expect, it, vi } from 'vitest';

import { idiomaDelTexto } from './idioma-texto';
import { __vaciarMemoriaDeTraducciones, rutaDeTraduccion, traducirTexto, trocear } from './traductor';

describe('idiomaDelTexto', () => {
  it('reconoce español, inglés y japonés', () => {
    expect(idiomaDelTexto('Nació en una pequeña ciudad y desde niña soñaba con ser streamer para todos.')).toBe('es');
    expect(idiomaDelTexto('She was born in a small town and has dreamed of being a streamer since she was a child.')).toBe('en');
    expect(idiomaDelTexto('小さな町で生まれ、子供の頃からストリーマーになるのが夢でした。')).toBe('ja');
  });
  it('lo dudoso o demasiado corto no se clasifica', () => {
    expect(idiomaDelTexto('hola')).toBeNull();
    expect(idiomaDelTexto('1234567890 !!!! ???? ....')).toBeNull();
  });
});

describe('rutaDeTraduccion', () => {
  it('pares con modelo directo no pivotan; es↔ja pasan por inglés', () => {
    expect(rutaDeTraduccion('es', 'en')).toEqual([['es', 'en']]);
    expect(rutaDeTraduccion('es', 'ja')).toEqual([['es', 'en'], ['en', 'ja']]);
    expect(rutaDeTraduccion('ja', 'es')).toEqual([['ja', 'en'], ['en', 'es']]);
    expect(rutaDeTraduccion('en', 'en')).toEqual([]);
  });
});

describe('trocear', () => {
  it('respeta el máximo, no pierde texto y conserva los saltos de línea', () => {
    const texto = `${'Una frase de prueba. '.repeat(40).trim()}\n\nSegundo párrafo.`;
    const tramos = trocear(texto, 120);
    for (const tramo of tramos) expect(tramo.length).toBeLessThanOrEqual(120);
    expect(tramos.join('').replace(/\s+/g, '')).toBe(texto.replace(/\s+/g, ''));
    expect(tramos.filter((t) => t === '\n')).toHaveLength(2);
  });
  it('una palabra interminable se corta en vez de pasarse', () => {
    for (const tramo of trocear('a'.repeat(50) + ' ' + 'b'.repeat(50), 60)) expect(tramo.length).toBeLessThanOrEqual(60);
  });
});

describe('traducirTexto con la API nativa', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __vaciarMemoriaDeTraducciones();
  });

  it('usa Translator del navegador, une los saltos de línea y memoiza', async () => {
    const translate = vi.fn(async (t: string) => `[${t}]`);
    const create = vi.fn(async () => ({ translate }));
    vi.stubGlobal('Translator', { availability: async () => 'available', create });
    const salida = await traducirTexto('Hola mundo.\nAdiós.', 'es', 'en');
    expect(salida).toBe('[Hola mundo.]\n[Adiós.]');
    await traducirTexto('Hola mundo.\nAdiós.', 'es', 'en');
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('mismo idioma: devuelve el texto sin tocar nada', async () => {
    await expect(traducirTexto('Hola', 'es', 'es')).resolves.toBe('Hola');
  });
});
