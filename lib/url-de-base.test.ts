import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { tursoConfigurado, urlDeBase } from './ediciones.mjs';

const guardado = { nueva: process.env.VTUBERDEX_DB_URL, vieja: process.env.TURSO_DATABASE_URL };
beforeEach(() => {
  delete process.env.VTUBERDEX_DB_URL;
  delete process.env.TURSO_DATABASE_URL;
});
afterEach(() => {
  for (const [k, v] of [['VTUBERDEX_DB_URL', guardado.nueva], ['TURSO_DATABASE_URL', guardado.vieja]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('urlDeBase: la base del mantenedor ya no se llama Turso', () => {
  it('sin ninguna variable no hay base configurada (la app sirve solo el catálogo)', () => {
    expect(urlDeBase()).toBe('');
    expect(tursoConfigurado()).toBe(false);
  });

  it('VTUBERDEX_DB_URL es el nombre vigente', () => {
    process.env.VTUBERDEX_DB_URL = 'file:/datos/base.db';
    expect(urlDeBase()).toBe('file:/datos/base.db');
    expect(tursoConfigurado()).toBe(true);
  });

  it('TURSO_DATABASE_URL sigue valiendo como alias antiguo', () => {
    process.env.TURSO_DATABASE_URL = 'file:/viejo.db';
    expect(urlDeBase()).toBe('file:/viejo.db');
    expect(tursoConfigurado()).toBe(true);
  });

  it('si están las dos, manda la nueva', () => {
    process.env.TURSO_DATABASE_URL = 'libsql://remota';
    process.env.VTUBERDEX_DB_URL = 'file:/local.db';
    expect(urlDeBase()).toBe('file:/local.db');
  });
});
