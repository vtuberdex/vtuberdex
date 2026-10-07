import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { CampoCorreoOculto, DatoOculto, MASCARA_CORREO, QuizasCorreo } from '@/components/admin/dato-oculto';

describe('datos ocultos (streaming)', () => {
  it('un correo nace oculto con una máscara fija y se revela solo ese', () => {
    render(
      <>
        <DatoOculto valor="ana@ejemplo.com" />
        <DatoOculto valor="bea@otro.cl" />
      </>,
    );
    expect(document.body).not.toHaveTextContent('ana@ejemplo.com');
    // Misma máscara para los dos: no delata el largo ni el dominio.
    expect(screen.getAllByLabelText('correo oculto').map((n) => n.textContent)).toEqual([MASCARA_CORREO, MASCARA_CORREO]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Mostrar correo' })[0]);
    expect(document.body).toHaveTextContent('ana@ejemplo.com');
    expect(document.body).not.toHaveTextContent('bea@otro.cl');
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar correo' }));
    expect(document.body).not.toHaveTextContent('ana@ejemplo.com');
  });

  it('QuizasCorreo solo oculta lo que parece un correo', () => {
    render(
      <p>
        <QuizasCorreo texto="admin" /> · <QuizasCorreo texto="ana@ejemplo.com" />
      </p>,
    );
    expect(document.body).toHaveTextContent('admin');
    expect(document.body).not.toHaveTextContent('ana@ejemplo.com');
  });

  function Campo({ inicial }: { inicial: string }) {
    const [valor, setValor] = useState(inicial);
    return <CampoCorreoOculto valor={valor} onChange={setValor} etiqueta="Correo" />;
  }

  it('el campo con un correo guardado nace oculto; vacío se escribe a la vista sin esconderse al teclear', () => {
    const { unmount } = render(<Campo inicial="ana@ejemplo.com" />);
    expect(screen.queryByDisplayValue('ana@ejemplo.com')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar y editar correo' }));
    expect(screen.getByLabelText('Correo')).toHaveValue('ana@ejemplo.com');
    unmount();

    render(<Campo inicial="" />);
    fireEvent.change(screen.getByLabelText('Correo'), { target: { value: 'n' } });
    expect(screen.getByLabelText('Correo')).toHaveValue('n');
  });
});
