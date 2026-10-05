import { describe, expect, it } from 'vitest';

import { LOCALES, elegirLocale, localeDeEtiqueta } from './locales';
import { DICCIONARIOS, traducir } from './mensajes';
import { etiquetaDePerfil, etiquetaDeStat, isoDeBandera, nombreDeIdioma, nombreDePais, tipoDeHabilidad } from './nombres';

describe('elegirLocale', () => {
  it('lo guardado manda sobre el navegador', () => {
    expect(elegirLocale('ja', ['en-US'])).toBe('ja');
  });
  it('sin elección, el primer idioma soportado del navegador (con región)', () => {
    expect(elegirLocale(null, ['fr-FR', 'en-GB', 'ja'])).toBe('en');
    expect(elegirLocale(undefined, ['ja-JP'])).toBe('ja');
    expect(elegirLocale(null, ['es-CL'])).toBe('es');
  });
  it('si nada se soporta o lo guardado es basura, español', () => {
    expect(elegirLocale(null, ['fr', 'de'])).toBe('es');
    expect(elegirLocale('xx', [])).toBe('es');
    expect(elegirLocale(null)).toBe('es');
  });
  it('localeDeEtiqueta tolera guion bajo y mayúsculas', () => {
    expect(localeDeEtiqueta('JA_jp')).toBe('ja');
    expect(localeDeEtiqueta('pt-BR')).toBeNull();
  });
});

describe('diccionarios', () => {
  it('los tres idiomas tienen exactamente las mismas claves', () => {
    const base = Object.keys(DICCIONARIOS.es).sort();
    for (const locale of LOCALES) expect(Object.keys(DICCIONARIOS[locale]).sort()).toEqual(base);
  });
  it('ninguna traducción queda vacía y los marcadores {x} coinciden con el español', () => {
    const marcadores = (texto: string) => (texto.match(/\{\w+\}/g) ?? []).sort();
    for (const locale of LOCALES) {
      for (const [clave, texto] of Object.entries(DICCIONARIOS[locale])) {
        expect(texto, `${locale}:${clave}`).not.toBe('');
        expect(marcadores(texto), `${locale}:${clave}`).toEqual(marcadores((DICCIONARIOS.es as Record<string, string>)[clave]));
      }
    }
  });
});

describe('traducir', () => {
  it('sustituye variables y elige el plural del idioma', () => {
    expect(traducir('es', 'buscador.encontrados', { n: 1 })).toBe('1 VTuber encontrado');
    expect(traducir('es', 'buscador.encontrados', { n: 5 })).toBe('5 VTubers encontrados');
    expect(traducir('en', 'buscador.encontrados', { n: 1 })).toBe('1 VTuber found');
    expect(traducir('ja', 'buscador.encontrados', { n: 1 })).toBe('1人のVTuberが見つかりました');
  });
  it('una variable que falta se deja visible en vez de «undefined»', () => {
    expect(traducir('en', 'detalle.premiumDesde', {})).toBe('Premium since {fecha}');
  });
});

describe('nombres', () => {
  it('isoDeBandera lee los emoji de bandera', () => {
    expect(isoDeBandera('🇨🇱')).toBe('CL');
    expect(isoDeBandera('🏴')).toBeNull();
    expect(isoDeBandera(null)).toBeNull();
  });
  it('países e idiomas se nombran en el idioma activo, con respaldo', () => {
    expect(nombreDePais('en', { name: 'España', flag: '🇪🇸' })).toBe('Spain');
    expect(nombreDePais('es', { name: 'España', flag: '🇪🇸' })).toBe('España');
    expect(nombreDePais('en', { name: 'Cataluña', flag: '🏴' })).toBe('Cataluña');
    expect(nombreDeIdioma('en', 'ja', '日本語')).toBe('Japanese');
  });
  it('etiquetas de ficha con las variantes con errata del scrape', () => {
    expect(etiquetaDePerfil('en', 'Cumpleaños')).toBe('Birthday');
    expect(etiquetaDePerfil('en', 'Comida que detestas')).toBe('Food they dislike');
    expect(etiquetaDePerfil('ja', 'Pais')).toBe('国');
    expect(etiquetaDePerfil('en', 'Etiqueta rara')).toBe('Etiqueta rara');
    expect(etiquetaDePerfil('es', 'Cumpleaños')).toBe('Cumpleaños');
  });
  it('stats y tipos de habilidad', () => {
    expect(etiquetaDeStat('en', 'magicAttack', 'Ataque Mágico')).toBe('Magic Attack');
    expect(etiquetaDeStat('en', 'raro', 'Raro')).toBe('Raro');
    expect(tipoDeHabilidad('en', 'Ofensivo')).toBe('Offensive');
    expect(tipoDeHabilidad('ja', 'Soporte')).toBe('サポート');
  });
});
