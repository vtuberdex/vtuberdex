import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AppHeader } from '@/components/app-header';
import { MinecraftContenido } from '@/components/minecraft/minecraft-contenido';

describe('MinecraftContenido', () => {
  it('explica los pasos con los comandos reales y la dirección del servidor', () => {
    render(<MinecraftContenido />);
    expect(screen.getByTestId('mc-host')).toHaveTextContent('vtuberdex.com');
    expect(screen.getAllByText(/\/vtd email/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\/vtd codigo/).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /inscribir mi ficha/i })).toHaveAttribute('href', '/inscripcion');
  });
});

describe('AppHeader', () => {
  it('lleva el botón de inscripción a la vista, no solo en el pie', () => {
    render(<AppHeader />);
    expect(screen.getByTestId('cabecera-inscribir')).toHaveAttribute('href', '/inscripcion');
  });
});
