import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatBars } from '@/components/stat-bars';
import { StatRadar } from '@/components/stat-radar';
import { EJES_DE_RADAR, poligono, puntoDeEje, verticesDeRadar } from '@/lib/radar';
import type { StatRow } from '@/lib/types';

const palette = { accent: '#6b44e7', secondary: '#ffffff' };
const fila = (slug: string, value: number | null, max: number | null = null): StatRow => ({ label: slug, slug, value, valueText: null, max, position: 0 });
const completo = [
  fila('hp', 1700, 1700), fila('mp', 1200, 1200), ...EJES_DE_RADAR.map((e) => fila(e.slug, e.ref / 2)),
];

describe('lib/radar', () => {
  it('normaliza cada eje contra su referencia y respeta el orden del gráfico', () => {
    const v = verticesDeRadar(completo);
    expect(v.map((x) => x.slug)).toEqual(EJES_DE_RADAR.map((e) => e.slug));
    for (const x of v) expect(x.ratio).toBeCloseTo(0.5);
  });
  it('acota por arriba y deja un piso para que un valor bajo no desaparezca', () => {
    const v = verticesDeRadar([fila('attack', 99999), fila('luck', 0), fila('speed', 10)]);
    expect(v.find((x) => x.slug === 'attack')?.ratio).toBe(1);
    expect(v.find((x) => x.slug === 'luck')?.ratio).toBeGreaterThan(0);
  });
  it('omite lo que la ficha no tiene y no cuenta HP/MP como eje', () => {
    expect(verticesDeRadar([fila('hp', 10), fila('attack', null), fila('speed', 5)]).map((x) => x.slug)).toEqual(['speed']);
  });
  it('el primer eje apunta arriba y el polígono tiene un punto por eje', () => {
    const p = puntoDeEje(0, 5, 100, 50, 50);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(-50);
    expect(poligono([1, 1, 1, 1], 10, 0, 0).split(' ')).toHaveLength(4);
  });
});

describe('StatRadar', () => {
  it('dibuja la telaraña con descripción accesible', () => {
    render(<StatRadar stats={completo} palette={palette} />);
    expect(screen.getByRole('img', { name: /Gráfico de atributos/ })).toBeInTheDocument();
    expect(screen.getByTestId('stat-radar-shape')).toBeInTheDocument();
  });
  it('con menos de tres ejes no dibuja nada', () => {
    const { container } = render(<StatRadar stats={[fila('attack', 10), fila('speed', 5)]} palette={palette} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('StatBars con telaraña', () => {
  it('deja HP y MP en barras y no repite en barras lo que ya está en la telaraña', () => {
    render(<StatBars stats={completo} palette={palette} level={1} experience={{ current: 0, max: 100 }} />);
    expect(screen.getByTestId('stat-radar')).toBeInTheDocument();
    expect(screen.getByText('hp')).toBeInTheDocument();
    expect(screen.queryByText('attack')).not.toBeInTheDocument();
  });
  it('con pocos atributos todo sigue en barras', () => {
    render(<StatBars stats={[fila('attack', 10)]} palette={palette} level={1} experience={null} />);
    expect(screen.queryByTestId('stat-radar')).not.toBeInTheDocument();
    expect(screen.getByText('attack')).toBeInTheDocument();
  });
});
