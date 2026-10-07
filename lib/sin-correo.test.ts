import { describe, expect, it } from 'vitest';
import { gradoDeDibujo } from '@/lib/premium';

describe('gradoDeDibujo', () => {
  it('una ficha sin correo y sin premium se dibuja en grado 6', () => {
    expect(gradoDeDibujo({ premium: null, sinCorreo: true })).toBe('6');
  });
  it('una premium conserva su grado aunque no tenga correo', () => {
    expect(gradoDeDibujo({ premium: { grade: '9' }, sinCorreo: true })).toBe('9');
  });
  it('una ficha con correo no se degrada', () => {
    expect(gradoDeDibujo({ premium: null })).toBeUndefined();
  });
});

describe('marcarSinCorreo', () => {
  it('la graduada no sale como sin correo y las premium conservan lo suyo', async () => {
    const { marcarSinCorreo, __reiniciarSinCorreo } = await import('./sin-correo.mjs');
    const { ejecutorSqlite, fijarGraduado, fijarCorreoDeFicha } = await import('../server/src/solicitudes.mjs');
    const { DatabaseSync } = await import('node:sqlite');
    __reiniciarSinCorreo();
    const e = ejecutorSqlite(new DatabaseSync(':memory:'));
    await fijarGraduado(e, 1);
    await fijarCorreoDeFicha(e, 2, 'a@b.co');
    const db = { prepare: () => ({ get: () => null }) };
    const [grad, conCorreo, sin, premium] = (await marcarSinCorreo(
      db,
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4, premium: { grade: '10' } }],
      { ejecutor: e },
    )) as Array<{ sinCorreo?: boolean; graduado?: boolean }>;
    expect(grad).toMatchObject({ graduado: true });
    expect(grad.sinCorreo).toBeUndefined();
    expect(conCorreo.sinCorreo).toBeUndefined();
    expect(sin.sinCorreo).toBe(true);
    expect(premium.sinCorreo).toBeUndefined();
    __reiniciarSinCorreo();
  });
});
