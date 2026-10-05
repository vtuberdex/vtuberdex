import { describe, expect, it } from 'vitest';

import { FILTROS, ORDENES, coincideConTexto, contarPorFiltro, ordenar, paginar, perteneceAlFiltro, porSubir } from '@/components/admin/premium-lista';
import { makeCard } from '@/test/fixtures';
import type { PremiumInfo } from '@/lib/types';

const AHORA = '2026-10-15';
const p = (grade: string, gradedAt = '2026-01-05', cert = 'VTD-001'): PremiumInfo => ({ grade: grade as never, since: '2026-01-01', gradedAt, cert });
const carta = (id: number, name: string, premium: PremiumInfo | null) => makeCard({ id, dexNumber: id, slug: name.toLowerCase(), name, premium });

describe('porSubir: el gesto mensual', () => {
  it('cuenta a quien puede subir y no cambió de grado este mes', () => {
    expect(porSubir(carta(1, 'A', p('8', '2026-09-30')), AHORA)).toBe(true);
    expect(porSubir(carta(1, 'A', p('8', '2026-10-01')), AHORA)).toBe(false); // ya subió este mes
  });
  it('no cuenta la Black Label (no hay más), ni las deterioradas, ni lo que no es premium', () => {
    expect(porSubir(carta(1, 'A', p('BL')), AHORA)).toBe(false);
    expect(porSubir(carta(1, 'A', p('3')), AHORA)).toBe(false);
    expect(porSubir(carta(1, 'A', null), AHORA)).toBe(false);
  });
  it('el 10 sí puede subir (a Black Label)', () => {
    expect(porSubir(carta(1, 'A', p('10')), AHORA)).toBe(true);
  });
});

describe('perteneceAlFiltro / contarPorFiltro', () => {
  const rows = [
    carta(1, 'A', p('6')), carta(2, 'B', p('7.5')), carta(3, 'C', p('8')), carta(4, 'D', p('9.5')),
    carta(5, 'E', p('10')), carta(6, 'F', p('BL')), carta(7, 'G', p('5')), carta(8, 'H', p('1')),
  ];
  it('cada grado cae en un solo tramo', () => {
    const tramos = ['bajos', 'medios', 'diez', 'bl', 'deterioradas'] as const;
    for (const r of rows) expect(tramos.filter((t) => perteneceAlFiltro(r, t, AHORA))).toHaveLength(1);
  });
  it('los contadores suman al total y «todas» las cuenta a todas', () => {
    const c = contarPorFiltro(rows, AHORA);
    expect(c.todas).toBe(8);
    expect(c.bajos + c.medios + c.diez + c.bl + c.deterioradas).toBe(8);
    expect(c).toMatchObject({ bajos: 2, medios: 2, diez: 1, bl: 1, deterioradas: 2 });
  });
  it('hay un filtro por cada entrada del selector y los ids no se repiten', () => {
    expect(new Set(FILTROS.map((f) => f.id)).size).toBe(FILTROS.length);
  });
});

describe('coincideConTexto', () => {
  const c = carta(16, 'Papá Noel', p('9', '2026-01-05', 'VTD-016'));
  it('ignora tildes y mayúsculas', () => {
    expect(coincideConTexto(c, 'papa')).toBe(true);
    expect(coincideConTexto(c, 'NOEL')).toBe(true);
  });
  it('encuentra por número (con o sin #) y por certificado', () => {
    expect(coincideConTexto(c, '#016')).toBe(true);
    expect(coincideConTexto(c, '16')).toBe(true);
    expect(coincideConTexto(c, 'vtd-016')).toBe(true);
  });
  it('un texto que no está no coincide; vacío coincide con todo', () => {
    expect(coincideConTexto(c, 'zzz')).toBe(false);
    expect(coincideConTexto(c, '   ')).toBe(true);
  });
});

describe('ordenar', () => {
  const rows = [carta(3, 'Carla', p('8', '2026-03-01')), carta(1, 'Ana', p('10', '2026-01-01')), carta(2, 'beto', p('BL', '2026-02-01')), carta(4, 'Dani', p('3', '2026-04-01'))];
  const n = (o: (typeof ORDENES)[number]['id']) => ordenar(rows, o).map((r) => r.name);
  it('por grado, de mayor a menor (la Black Label arriba, las deterioradas al final)', () => {
    expect(n('grado-desc')).toEqual(['beto', 'Ana', 'Carla', 'Dani']);
    expect(n('grado-asc')).toEqual(['Dani', 'Carla', 'Ana', 'beto']);
  });
  it('por nombre sin distinguir mayúsculas, por dex y por último cambio más antiguo', () => {
    expect(n('nombre')).toEqual(['Ana', 'beto', 'Carla', 'Dani']);
    expect(n('dex')).toEqual(['Ana', 'beto', 'Carla', 'Dani']);
    expect(n('cambio-antiguo')).toEqual(['Ana', 'beto', 'Carla', 'Dani']);
  });
  it('no modifica el arreglo original', () => {
    const antes = rows.map((r) => r.name);
    ordenar(rows, 'nombre');
    expect(rows.map((r) => r.name)).toEqual(antes);
  });
});

describe('paginar', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  it('trozos de 20 con el rango mostrado', () => {
    expect(paginar(items, 1)).toMatchObject({ pagina: 1, paginas: 3, desde: 1, hasta: 20, total: 45 });
    expect(paginar(items, 3)).toMatchObject({ pagina: 3, desde: 41, hasta: 45 });
    expect(paginar(items, 3).items).toHaveLength(5);
  });
  it('acota una página fuera de rango y soporta la lista vacía', () => {
    expect(paginar(items, 99).pagina).toBe(3);
    expect(paginar(items, -4).pagina).toBe(1);
    expect(paginar([], 1)).toMatchObject({ paginas: 1, desde: 0, hasta: 0, total: 0, items: [] });
  });
});
