import { render, screen, within } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { NivelesContenido } from '@/components/niveles/niveles-contenido';
import { AppFooter } from '@/components/app-footer';
import { BASE_NIVEL, PASO_NIVEL, PUNTOS_POR_NIVEL, RANGO_MAXIMO, XP_POR_LIKE } from '@/server/src/experiencia.mjs';

describe('página de niveles', () => {
  test('las cifras que explica son las de la regla, no números escritos a mano', () => {
    render(<NivelesContenido />);
    const pagina = screen.getByTestId('niveles');
    expect(pagina.textContent).toContain(`${XP_POR_LIKE} puntos de experiencia`);
    expect(pagina.textContent).toContain(`primero pide ${BASE_NIVEL} EXP`);
    expect(pagina.textContent).toContain(`${PASO_NIVEL} más`);
    expect(pagina.textContent).toContain(`${PUNTOS_POR_NIVEL} puntos de habilidad`);
    expect(pagina.textContent).toContain(`rango ${RANGO_MAXIMO}`);
  });

  test('la tabla crece nivel a nivel y explica en likes lo que pide cada uno', () => {
    render(<NivelesContenido />);
    const filas = within(screen.getByTestId('niveles-tabla')).getAllByRole('row').slice(1);
    expect(filas).toHaveLength(9);
    const primera = within(filas[0]).getAllByRole('cell').map((c) => c.textContent);
    expect(primera).toEqual(['2', String(BASE_NIVEL), String(BASE_NIVEL / XP_POR_LIKE)]);
    const exp = filas.map((f) => Number(within(f).getAllByRole('cell')[1].textContent!.replace(/\D/g, '')));
    exp.slice(1).forEach((n, i) => expect(n).toBeGreaterThan(exp[i]));
  });

  test('enlaza a Mi ficha, y el pie enlaza a esta página', () => {
    const { unmount } = render(<NivelesContenido />);
    expect(screen.getByRole('link', { name: 'Ir a Mi ficha' }).getAttribute('href')).toBe('/mi-ficha');
    unmount();
    render(<AppFooter />);
    expect(screen.getByRole('link', { name: 'Cómo funcionan los niveles' }).getAttribute('href')).toBe('/niveles');
  });

  test('trae los gráficos y las maquetas de ejemplo, y las maquetas no son interactivas', () => {
    render(<NivelesContenido />);
    expect(screen.getByTestId('niveles-camino').querySelectorAll('li')).toHaveLength(4);
    expect(screen.getByTestId('grafico-barra-total').querySelectorAll('polyline')).toHaveLength(2);
    expect(screen.getByTestId('grafico-curva').querySelectorAll('rect')).toHaveLength(10);
    expect(screen.getByTestId('escala-rangos').querySelectorAll('li')).toHaveLength(RANGO_MAXIMO + 1);
    const maquetas = Array.from(document.querySelectorAll('[aria-hidden="true"][inert]'));
    expect(maquetas).toHaveLength(2);
    // La maqueta de «Mi ficha» es el componente real, con puntos de ejemplo.
    expect(within(maquetas[1] as HTMLElement).getByTestId('mificha-disponibles').textContent).toMatch(/^\d+$/);
    expect(screen.getAllByText('Ejemplo')).toHaveLength(2);
  });

  test('el gráfico de la barra termina con el mismo total que calcula la regla', () => {
    render(<NivelesContenido />);
    const texto = screen.getByTestId('grafico-barra-total').textContent ?? '';
    expect(texto).toContain((50 * XP_POR_LIKE).toLocaleString());
  });
});
