import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import { DISENO } from '@/lib/diseno.mjs';
import { correoDeAcceso, correoDeBienvenida, correoDeMiFicha, correoDeSolicitud } from '@/lib/correo.mjs';

const css = fs.readFileSync(path.join(process.cwd(), 'app/globals.css'), 'utf8');
const env = { SITE_URL: 'https://vtuberdex.com' } as never;

describe('tokens del sistema de diseño', () => {
  test.each([
    ['void', 'dex-void'],
    ['panel', 'dex-panel'],
    ['panelSoft', 'dex-panel-soft'],
    ['line', 'dex-line'],
    ['ink', 'dex-ink'],
    ['muted', 'dex-muted'],
    ['accent', 'dex-accent'],
  ] as const)('%s coincide con --color-%s de globals.css', (token, variable) => {
    const valor = new RegExp(`--color-${variable}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1];
    expect(valor?.toLowerCase()).toBe(DISENO.color[token]);
  });
});

describe('los correos usan el sistema de diseño', () => {
  const correos = {
    inscripcion: correoDeSolicitud({ tipo: 'inscripcion', token: 'abc' }, env),
    modificacion: correoDeSolicitud({ tipo: 'modificacion', token: 'abc' }, env),
    baja: correoDeSolicitud({ tipo: 'baja', token: 'abc' }, env),
    acceso: correoDeAcceso({ token: 'abc' }, env),
    miFicha: correoDeMiFicha({ token: 'abc', nombre: 'Luna' }, env),
    bienvenida: correoDeBienvenida({ nombre: 'Luna', slug: 'luna' }, env),
  };

  test.each(Object.entries(correos))('%s: fondo oscuro, tarjeta de panel, títulos en Knewave y sin colores ajenos', (_nombre, { html }) => {
    expect(html).toContain(`bgcolor="${DISENO.color.void}"`);
    expect(html).toContain(DISENO.color.panel);
    expect(html).toContain('Knewave');
    expect(html).toContain(DISENO.fuentesUrl);
    // Todo color hexadecimal que aparece es un token (no quedan los grises/azules del diseño anterior).
    const permitidos = new Set(Object.values(DISENO.color));
    for (const hex of html.match(/#[0-9a-fA-F]{6}\b/g) ?? []) expect(permitidos.has(hex.toLowerCase())).toBe(true);
  });

  test('la baja usa el color de peligro en el botón', () => {
    expect(correos.baja.html).toContain(`background:${DISENO.color.peligro};color:${DISENO.color.void}`);
  });
});
