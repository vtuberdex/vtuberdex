/**
 * Premium en la interfaz: la escala reexportada, las leyendas de la etiqueta, las cuentas de
 * meses del mantenedor y el filtro `premium` en la URL.
 */
import { describe, expect, test } from 'vitest';

import {
  GRADOS,
  GRADO_INICIAL,
  esBlackLabel,
  gradoSiguiente,
  leyendaDePremium,
  mesesEntre,
  mismoMes,
  nombreDeGrado,
  notaVisible,
} from '@/lib/premium';
import { DEFAULT_SEARCH, activeFilterCount, searchParamsFromUrl, searchParamsToQuery, searchParamsToUrl } from '@/lib/query';
import * as servidor from '@/server/src/premium.mjs';

describe('la escala', () => {
  test('el cliente usa la MISMA escala que el servidor (una sola definición)', () => {
    expect([...GRADOS]).toEqual([...servidor.GRADOS]);
    expect(GRADO_INICIAL).toBe('8');
  });

  test('cada grado tiene nombre y la Black Label se lee como un 10 pristino', () => {
    for (const grado of GRADOS) expect(nombreDeGrado(grado), grado).not.toBe('');
    expect(notaVisible('BL')).toBe('10');
    expect(notaVisible('8.5')).toBe('8.5');
    expect(esBlackLabel('BL')).toBe(true);
    expect(gradoSiguiente('10')).toBe('BL');
    expect(gradoSiguiente('BL')).toBeNull();
  });

  test('las leyendas', () => {
    expect(leyendaDePremium({ grade: '10' })).toBe('GEM MINT 10');
    expect(leyendaDePremium({ grade: '8' })).toBe('NM/MT 8');
    expect(leyendaDePremium({ grade: '8.5' })).toBe('NM/MT+ 8.5');
    expect(leyendaDePremium({ grade: 'BL' })).toBe('PRISTINE 10 · BLACK LABEL');
  });
});

describe('meses', () => {
  test('cuenta meses COMPLETOS', () => {
    expect(mesesEntre('2026-01-15', '2026-02-14')).toBe(0);
    expect(mesesEntre('2026-01-15', '2026-02-15')).toBe(1);
    expect(mesesEntre('2025-10-02', '2026-10-02')).toBe(12);
    expect(mesesEntre('2026-10-02', '2026-10-02')).toBe(0);
  });

  test('una fecha futura o rota no da negativos ni NaN', () => {
    expect(mesesEntre('2027-01-01', '2026-01-01')).toBe(0);
    expect(mesesEntre('basura', '2026-01-01')).toBe(0);
  });

  test('mismoMes compara año y mes', () => {
    expect(mismoMes('2026-10-01', '2026-10-30')).toBe(true);
    expect(mismoMes('2026-09-30', '2026-10-01')).toBe(false);
    expect(mismoMes('2025-10-01', '2026-10-01')).toBe(false);
  });
});

describe('el filtro premium en la URL', () => {
  test('por defecto está apagado y no viaja', () => {
    expect(DEFAULT_SEARCH.premium).toBe(false);
    expect(searchParamsToQuery(DEFAULT_SEARCH)).not.toContain('premium');
    expect(searchParamsToUrl(DEFAULT_SEARCH)).toBe('/');
  });

  test('encendido viaja a la API y a la URL, y vuelve al parsear', () => {
    const params = { ...DEFAULT_SEARCH, premium: true };
    expect(new URLSearchParams(searchParamsToQuery(params)).get('premium')).toBe('1');
    expect(searchParamsToUrl(params)).toBe('/?premium=1');
    expect(searchParamsFromUrl('?premium=1').premium).toBe(true);
    expect(searchParamsFromUrl('?premium=true').premium).toBe(true);
    expect(searchParamsFromUrl('').premium).toBe(false);
  });

  test('cuenta como filtro activo (el chip y el badge del panel móvil)', () => {
    expect(activeFilterCount({ ...DEFAULT_SEARCH, premium: true })).toBe(1);
    expect(activeFilterCount(DEFAULT_SEARCH)).toBe(0);
  });
});
