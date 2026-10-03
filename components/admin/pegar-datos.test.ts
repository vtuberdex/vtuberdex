import { describe, expect, it } from 'vitest';
import { camposDerivados, fundirPerfil, parsearDatos } from '@/components/admin/pegar-datos';

const HTML = `
  <div class="dato"><div class="titulo">Pais:</div><div class="contenido">México</div></div>
  <div class="dato"><div class="titulo">Altura:</div><div class="contenido">1.81 m </div></div>
  <div class="dato"><div class="titulo">color favorito:</div><div class="contenido">Morado</div></div>
  <div class="dato"><div class="titulo">Vacío:</div><div class="contenido"> </div></div>
  <div class="dato"><div class="titulo">hashtag arte:</div><div class="contenido">#WypsoArt</div></div>`;

describe('pegar datos', () => {
  it('parsea título y contenido y descarta vacíos', () => {
    expect(parsearDatos(HTML)).toEqual([
      { label: 'Pais', value: 'México' },
      { label: 'Altura', value: '1.81 m' },
      { label: 'color favorito', value: 'Morado' },
      { label: 'hashtag arte', value: '#WypsoArt' },
    ]);
  });
  it('funde por título sin distinguir tildes ni mayúsculas', () => {
    const r = fundirPerfil([{ label: 'Color Favorito', value: 'Rojo' }, { label: 'Debut', value: '2020' }], parsearDatos(HTML));
    expect(r[0]).toEqual({ label: 'Color Favorito', value: 'Morado' });
    expect(r).toHaveLength(5);
  });
  it('deriva los campos propios', () => {
    expect(camposDerivados(parsearDatos(HTML))).toMatchObject({ height: '1.81 m', favoriteColor: 'Morado', hashtag: '#WypsoArt' });
  });
});
