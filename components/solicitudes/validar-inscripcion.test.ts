// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import { describe, expect, it } from 'vitest';

import { CAMPOS_PERFIL, type ClavePerfil } from '@/components/solicitudes/campos-ficha';
import { faltasDelPaso, type EstadoInscripcion } from './validar-inscripcion';

const perfilLleno = Object.fromEntries(CAMPOS_PERFIL.map((c) => [c.clave, 'x'])) as Record<ClavePerfil, string>;

const base: EstadoInscripcion = {
  name: 'Nombre',
  email: 'ana@example.com',
  codigo: 'a'.repeat(20),
  languages: ['es'],
  socials: [{ platform: 'Twitch', url: 'https://twitch.tv/ana' }],
  imageId: 'img',
  logoId: 'logo',
  cardText: 'Historia',
  perfil: perfilLleno,
  acepta: true,
};

const motivoDelCorreo = (email: string) =>
  faltasDelPaso(1, { ...base, email }).find((f) => f.campo === 'email')?.motivo ?? null;

describe('faltasDelPaso', () => {
  it('no marca nada con todo completo', () => {
    for (const paso of [1, 2, 3, 4, 5] as const) {
      expect(faltasDelPaso(paso, base)).toEqual([]);
    }
  });

  it('acepta los correos que aceptaba la expresión anterior', () => {
    for (const email of ['a@b.c', 'ana@example.com', 'a@b..c', 'a@.b.c', 'x.y+z@sub.dominio.cl', '  ana@ejemplo.cl  ']) {
      expect(motivoDelCorreo(email)).toBeNull();
    }
  });

  it('rechaza los que rechazaba', () => {
    expect(motivoDelCorreo('')).toBe('vacio');
    for (const email of ['ana', '@b.c', 'a@bc', 'a@b.', 'a@.b', 'a@@b.c', 'a@b@c.d', 'a b@c.d', 'a@b\t.c']) {
      expect(motivoDelCorreo(email)).toBe('invalido');
    }
  });

  it('un dominio largo sin punto se resuelve en tiempo lineal', () => {
    const inicio = performance.now();
    expect(motivoDelCorreo(`a@${'b'.repeat(50_000)}`)).toBe('invalido');
    expect(performance.now() - inicio).toBeLessThan(200);
  });

  it('el código corto distingue vacío de mal copiado', () => {
    expect(faltasDelPaso(2, { ...base, codigo: '' })[0]?.motivo).toBe('vacio');
    expect(faltasDelPaso(2, { ...base, codigo: 'abc' })[0]?.motivo).toBe('invalido');
  });

  it('las redes: sin nada es vacío; a medias o sin enlace válido, inválido', () => {
    const redes = (socials: EstadoInscripcion['socials']) => faltasDelPaso(3, { ...base, socials });
    expect(redes([{ platform: '', url: '' }])).toEqual([{ campo: 'socials', etiqueta: 'ins.redes', motivo: 'vacio' }]);
    expect(redes([{ platform: 'Twitch', url: 'twitch.tv' }])[0]?.motivo).toBe('invalido');
    expect(
      redes([
        { platform: 'Twitch', url: 'https://twitch.tv/ana' },
        { platform: 'YouTube', url: '' },
      ])[0]?.motivo,
    ).toBe('invalido');
  });

  it('respeta el orden de los campos de cada paso', () => {
    const vacio: EstadoInscripcion = { ...base, name: '', email: '', languages: [], socials: [], imageId: '', logoId: '', cardText: '', acepta: false };
    expect(faltasDelPaso(1, vacio).map((f) => f.campo)).toEqual(['name', 'email']);
    expect(faltasDelPaso(3, vacio).map((f) => f.campo)).toEqual(['languages', 'socials']);
    expect(faltasDelPaso(4, vacio).map((f) => f.campo)).toEqual(['imageId', 'logoId', 'cardText']);
    expect(faltasDelPaso(5, vacio).map((f) => f.campo)).toEqual(['acepta']);
  });
});
