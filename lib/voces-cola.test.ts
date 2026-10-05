import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { carpetaDeVoces, encolarVoz, leerCola, quitarDeCola } from './voces-cola.mjs';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'voces-cola-'));
  process.env.VTUBERDEX_VOCES_DIR = dir;
});
afterEach(() => {
  delete process.env.VTUBERDEX_VOCES_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cola de voces', () => {
  it('encola, lee y quita un trabajo', () => {
    expect(encolarVoz({ id: 7, slug: 'ana' })).toBe(true);
    const [t] = leerCola();
    expect(t).toMatchObject({ id: 7, slug: 'ana' });
    quitarDeCola(t);
    expect(leerCola()).toEqual([]);
  });

  it('un trabajo por ficha: encolar otra vez lo sustituye y deja el slug más reciente', () => {
    encolarVoz({ id: 7, slug: 'ana' });
    encolarVoz({ id: 7, slug: 'ana-2' });
    expect(leerCola().map((t: { slug: string }) => t.slug)).toEqual(['ana-2']);
  });

  it('sin carpeta configurada no hace nada ni lanza', () => {
    delete process.env.VTUBERDEX_VOCES_DIR;
    expect(carpetaDeVoces()).toBeNull();
    expect(encolarVoz({ id: 1, slug: 'x' })).toBe(false);
    expect(leerCola()).toEqual([]);
  });

  it('un JSON ilegible no bloquea la cola: se descarta', () => {
    fs.mkdirSync(path.join(dir, '.cola'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.cola', '9.json'), '{roto');
    encolarVoz({ id: 2, slug: 'b' });
    expect(leerCola().map((t: { id: number }) => t.id)).toEqual([2]);
    expect(fs.existsSync(path.join(dir, '.cola', '9.json'))).toBe(false);
  });

  it('rechaza un id que no es entero (no compone nombres de archivo con basura)', () => {
    expect(encolarVoz({ id: '../x' as never, slug: 'x' })).toBe(false);
  });
});
