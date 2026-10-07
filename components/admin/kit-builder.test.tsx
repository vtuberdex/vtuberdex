import { fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { emptyForm, emptySkill, type EditorForm, type SkillForm } from '@/components/admin/form-model';
import { KitBuilder } from '@/components/admin/kit-builder';
import { AttributesStep } from '@/components/admin/steps/attributes-step';
import { SkillsStep } from '@/components/admin/steps/skills-step';

const span = (color: string, nombre: string) => `<span style="color:${color}; font-weight:bold;">${nombre}</span>`;

/** Monta un paso con el formulario en estado real, como lo hace el asistente de la carta. */
function Paso({ inicial, Componente }: { inicial: Partial<EditorForm>; Componente: typeof SkillsStep }) {
  const [form, setForm] = useState<EditorForm>({ ...emptyForm(), ...inicial });
  return (
    <>
      <Componente form={form} set={(k, v) => setForm((f) => ({ ...f, [k]: v }))} />
      <output data-testid="skills-json">{JSON.stringify(form.skills.map((s) => s.name))}</output>
    </>
  );
}

describe('Paso «Habilidades»', () => {
  it('lista una línea por habilidad con su estado, y al abrirla muestra el efecto y sus problemas', () => {
    const skills: SkillForm[] = [
      { ...emptySkill(), name: 'Mordida', effectHtml: `Ataque Base +45 y obtienes ${span('#074fcc', 'Miedo')} durante 2 turnos.` },
    ];
    render(<Paso inicial={{ skills, factions: ['abyssal'] }} Componente={SkillsStep} />);
    expect(screen.getByTestId('kit-resumen')).toHaveTextContent(/error/);
    const fila = screen.getByRole('button', { name: /Mordida/ });
    expect(within(fila).getByLabelText('con errores')).toBeInTheDocument();
    expect(screen.queryByText(/se aplica, no se obtiene/)).toBeNull();
    fireEvent.click(fila);
    expect(screen.getByText(/«Miedo» es negativo: se aplica, no se obtiene/)).toBeInTheDocument();
  });

  it('arma un kit pieza por pieza y lo deja en la ficha conservando las «otras»', () => {
    const otra = { ...emptySkill(), category: 'other' as const, name: 'Extra' };
    render(<Paso inicial={{ skills: [otra], factions: ['abyssal'] }} Componente={SkillsStep} />);
    fireEvent.click(screen.getByRole('button', { name: 'Armar el kit con el asistente' }));

    const escribir = (etiqueta: RegExp, valor: string) => fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });
    const siguiente = () => fireEvent.click(screen.getByRole('button', { name: /^Siguiente|^Revisar el kit/ }));

    escribir(/^Nombre/, 'Bite');
    expect(within(screen.getByTestId('kit-vista-previa')).getByText('Bite')).toBeInTheDocument();
    siguiente();
    escribir(/^Nombre/, 'Hymn');
    siguiente();
    escribir(/^Nombre/, 'Pressure');
    escribir(/^Efecto/, 'Recuperas 10 MP.');
    siguiente();
    escribir(/^Nombre/, 'Tide');
    escribir(/^Efecto/, 'Obtienes +10 Velocidad.');
    siguiente();
    escribir(/^Nombre$/, 'Leviathan');
    escribir(/^Estado 1/, 'Miedo');
    escribir(/^Estado 2/, 'Revitalia');
    expect(within(screen.getByTestId('kit-vista-previa')).getAllByText('Terror Primordial').length).toBeGreaterThan(0);
    siguiente();

    expect(screen.getByTestId('kit-ok')).toBeInTheDocument();
    // Solo había una «otra»: no hay kit que reemplazar, así que no pide confirmación.
    fireEvent.click(screen.getByRole('button', { name: 'Usar este kit' }));
    expect(screen.getByTestId('skills-json')).toHaveTextContent('["Bite","Hymn","Pressure","Tide","Leviathan","Extra"]');
    expect(screen.getByText(/Kit puesto en la ficha/)).toBeInTheDocument();
  });

  it('rehacer un kit existente pide confirmar antes de reemplazarlo', () => {
    const onApply = vi.fn();
    render(<KitBuilder skills={[{ ...emptySkill(), name: 'Vieja' }]} facciones={[]} onApply={onApply} onCancel={vi.fn()} />);
    const pestana = (nombre: string) =>
      fireEvent.click(within(screen.getByRole('navigation', { name: 'Piezas del kit' })).getByRole('button', { name: new RegExp(`${nombre}$`) }));
    pestana('Pasiva 1');
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText(/^Efecto/), { target: { value: 'Recuperas 5 MP.' } });
    pestana('Pasiva 2');
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'P2' } });
    fireEvent.change(screen.getByLabelText(/^Efecto/), { target: { value: 'Recuperas 5 HP.' } });
    pestana('Activa 2');
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'A2' } });
    pestana('Ultimate');
    fireEvent.change(screen.getByLabelText(/^Nombre$/), { target: { value: 'U' } });
    fireEvent.change(screen.getByLabelText(/^Estado 1/), { target: { value: 'Miedo' } });
    fireEvent.change(screen.getByLabelText(/^Estado 2/), { target: { value: 'Revitalia' } });
    pestana('Revisar');
    fireEvent.click(screen.getByRole('button', { name: 'Usar este kit' }));
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/puntos de habilidad/);
    fireEvent.click(screen.getByRole('button', { name: 'Reemplazar' }));
    expect(onApply.mock.calls[0][0].map((s: SkillForm) => s.name)).toEqual(['Vieja', 'A2', 'P1', 'P2', 'U']);
  });

  it('cada pieza del asistente marca si le falta algo', () => {
    render(<KitBuilder skills={[]} facciones={[]} onApply={vi.fn()} onCancel={vi.fn()} />);
    const pestana = within(screen.getByRole('navigation', { name: 'Piezas del kit' })).getByRole('button', { name: /Activa 1$/ });
    expect(pestana).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Falta: Nombre de la Activa 1')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Nombre/), { target: { value: 'Golpe' } });
    expect(screen.queryByText('Falta: Nombre de la Activa 1')).toBeNull();
  });

  it('los estados exclusivos de otra facción salen deshabilitados', () => {
    render(<KitBuilder skills={[]} facciones={['abyssal']} onApply={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Piezas del kit' })).getByRole('button', { name: /Ultimate$/ }));
    const opcion = within(screen.getByLabelText('Estado 1')).getByRole('option', { name: /Sacramentum Aeternum/ });
    expect(opcion).toBeDisabled();
  });
});

describe('Paso «Atributos»', () => {
  it('una línea por atributo; los estándar se añaden de una vez y el texto opcional va escondido', () => {
    render(<Paso inicial={{}} Componente={AttributesStep} />);
    fireEvent.click(screen.getByRole('button', { name: 'Añadir atributos estándar' }));
    expect(screen.getAllByTestId('stat-row')).toHaveLength(7);
    expect(screen.queryByPlaceholderText('S+')).toBeNull();
    fireEvent.change(screen.getByLabelText('Valor de Ataque'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Quitar HP' }));
    expect(screen.getAllByTestId('stat-row')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Añadir atributos estándar' })).toBeEnabled();
  });
});
