import { describe, expect, it } from 'vitest';

import { LOCALES } from './i18n/locales';
import { CLAUSULAS } from './terminos';
import { terminosDe } from './terminos-i18n';

describe('terminos traducidos', () => {
  for (const locale of LOCALES) {
    it(`${locale}: mismas cláusulas, mismos ids y mismo número de párrafos que el español`, () => {
      const t = terminosDe(locale);
      expect(t.clausulas.map((c) => c.id)).toEqual(CLAUSULAS.map((c) => c.id));
      expect(t.clausulas.map((c) => c.parrafos.length)).toEqual(CLAUSULAS.map((c) => c.parrafos.length));
      expect(t.preambulo.length).toBe(terminosDe('es').preambulo.length);
      for (const c of t.clausulas) {
        expect(c.titulo.trim()).not.toBe('');
        for (const p of c.parrafos) expect(p.trim()).not.toBe('');
      }
    });
  }
  it('los párrafos numerados conservan su numeración (3.1, 8.2…)', () => {
    const numero = (p: string) => p.match(/^\d+\.\d+/)?.[0];
    const es = terminosDe('es');
    for (const locale of LOCALES) {
      const t = terminosDe(locale);
      expect(t.clausulas.map((c) => c.parrafos.map(numero))).toEqual(es.clausulas.map((c) => c.parrafos.map(numero)));
    }
  });
  it('en y ja avisan de que el español prevalece; el español no', () => {
    expect(terminosDe('es').textosPagina.notaTraduccion).toBe('');
    expect(terminosDe('en').textosPagina.notaTraduccion).not.toBe('');
    expect(terminosDe('ja').textosPagina.notaTraduccion).not.toBe('');
  });
});
