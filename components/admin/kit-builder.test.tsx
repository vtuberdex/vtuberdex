import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { emptySkill, type SkillForm } from '@/components/admin/form-model';
import { KitBuilder } from '@/components/admin/kit-builder';

const span = (color: string, nombre: string) => `<span style="color:${color}; font-weight:bold;">${nombre}</span>`;

describe('KitBuilder', () => {
  it('muestra qué reglas rompe el kit actual sin abrir el asistente', () => {
    const skills: SkillForm[] = [
      { ...emptySkill(), name: 'A', effectHtml: `Ataque Base +45 y obtienes ${span('#074fcc', 'Miedo')} durante 2 turnos.` },
    ];
    render(<KitBuilder skills={skills} facciones={['abyssal']} onApply={() => {}} />);
    const lista = screen.getByTestId('kit-problemas');
    expect(lista.textContent).toContain('«Miedo» es negativo: se aplica, no se obtiene');
    expect(lista.textContent).toContain('se esperaban 2 passive');
  });

  it('arma un kit con los menús y lo pone en el formulario conservando las «otras»', () => {
    const onApply = vi.fn();
    const otra = { ...emptySkill(), category: 'other' as const, name: 'Extra' };
    render(<KitBuilder skills={[otra]} facciones={['abyssal']} onApply={onApply} />);
    fireEvent.click(screen.getByRole('button', { name: 'Armar el kit con el asistente' }));

    const usar = screen.getByRole('button', { name: 'Usar este kit' });
    expect(usar).toBeDisabled();

    const nombres = screen.getAllByLabelText(/^Nombre/);
    ['Bite', 'Hymn', 'Pressure', 'Tide', 'Leviathan'].forEach((n, i) => fireEvent.change(nombres[i], { target: { value: n } }));
    const efectos = screen.getAllByLabelText(/^Efecto(?!\s*adicional)/);
    fireEvent.change(efectos[0], { target: { value: 'Recuperas 10 MP.' } });
    fireEvent.change(efectos[1], { target: { value: 'Obtienes +10 Velocidad.' } });
    fireEvent.change(screen.getByLabelText('Estado 1'), { target: { value: 'Miedo' } });
    fireEvent.change(screen.getByLabelText('Estado 2'), { target: { value: 'Revitalia' } });

    expect(screen.getByTestId('kit-ok')).toBeInTheDocument();
    const previa = within(screen.getByTestId('kit-vista-previa'));
    expect(previa.getAllByText('Terror Primordial').length).toBeGreaterThan(0);

    fireEvent.click(usar);
    const nuevas: SkillForm[] = onApply.mock.calls[0][0];
    expect(nuevas.map((s) => s.name)).toEqual(['Bite', 'Hymn', 'Pressure', 'Tide', 'Leviathan', 'Extra']);
    expect(nuevas[4].effectHtml).toContain('Renacimiento');
  });

  it('los estados exclusivos de otra facción salen deshabilitados', () => {
    render(<KitBuilder skills={[]} facciones={['abyssal']} onApply={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Armar el kit con el asistente' }));
    const opcion = within(screen.getByLabelText('Estado 1')).getByRole('option', { name: /Sacramentum Aeternum/ });
    expect(opcion).toBeDisabled();
  });
});
