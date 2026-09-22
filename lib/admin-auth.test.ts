/**
 * Diagnóstico del hash del mantenedor.
 *
 * POR QUÉ ESTOS TESTS
 * -------------------
 * `formatoDeHash` es lo único que permite distinguir "contraseña equivocada" de "hash mal
 * pegado" en producción, porque la variable está guardada como `sensitive` y Vercel no deja
 * volver a leer su valor una vez creada. Si el diagnóstico mintiera —o si dejara de detectar
 * el caso de las comillas, que es el más probable al pegar el comando que imprime
 * `admin-hash.mjs`— el 401 volvería a ser indepurable.
 *
 * Los dos casos centrales están comprobados contra `verifyPassword`: no basta con que el
 * diagnóstico "vea algo raro", tiene que coincidir con que la contraseña NO valida.
 */
import { describe, expect, it } from 'vitest';

import { formatoDeHash, diagnosticarCredenciales, verificarCredenciales } from './admin-auth.mjs';
import { hashPassword, verifyPassword } from '../server/src/auth.mjs';

const CLAVE = 'clave-de-prueba-vtuberdex';
const HASH = hashPassword(CLAVE);

describe('formatoDeHash', () => {
  it('acepta el hash tal como lo imprime admin-hash.mjs', () => {
    const forma = formatoDeHash(HASH);
    expect(forma.valido).toBe(true);
    expect(forma.problemas).toEqual([]);
  });

  it('detecta el valor envuelto en comillas, que es el pegado más probable', () => {
    // El pie de `admin-hash.mjs` imprime `VTUBERDEX_ADMIN_PASSWORD_HASH='scrypt$...$...'`.
    // Pegar la línea entera mete las comillas DENTRO del valor, y `verifyPassword` parte por
    // `$` quedándose con `'scrypt` como esquema: el login falla con el mismo 401 de siempre.
    const conComillas = `'${HASH}'`;
    expect(verifyPassword(CLAVE, conComillas)).toBe(false);

    const forma = formatoDeHash(conComillas);
    expect(forma.valido).toBe(false);
    expect(forma.problemas.join(' ')).toMatch(/comilla/i);
  });

  it('detecta los $ escapados del shell', () => {
    const escapado = HASH.replace(/\$/g, '\\$');
    expect(verifyPassword(CLAVE, escapado)).toBe(false);

    const forma = formatoDeHash(escapado);
    expect(forma.valido).toBe(false);
    expect(forma.problemas.join(' ')).toMatch(/escapad/i);
  });

  it('detecta un valor truncado al copiar', () => {
    const forma = formatoDeHash(HASH.slice(0, HASH.length - 4));
    expect(forma.valido).toBe(false);
    expect(forma.problemas.join(' ')).toMatch(/128|truncad/i);
  });

  it('detecta espacios o saltos de línea pegados con el valor', () => {
    const forma = formatoDeHash(` ${HASH}\n`);
    expect(forma.valido).toBe(false);
    expect(forma.problemas.join(' ')).toMatch(/espacios|saltos/i);
  });

  it('distingue el hash AUSENTE del hash corrupto', () => {
    expect(formatoDeHash('')).toMatchObject({ valido: false });
    expect(formatoDeHash('').problemas.join(' ')).toMatch(/falta/i);
  });

  it('no revela el valor ni sus longitudes exactas', () => {
    // Viaja dentro de la respuesta de un 401 sin sesión: si incluyera el hash o sus
    // longitudes, contaría cuánto se escribió y filtraría parte de la credencial.
    const forma = formatoDeHash(HASH);
    expect(JSON.stringify(forma)).not.toContain(HASH);
    expect(JSON.stringify(forma)).not.toContain(HASH.split('$')[1]);
    expect(JSON.stringify(forma)).not.toContain(HASH.split('$')[2]);
  });

  it('no depende de que el hash sea el de esta máquina', () => {
    // El valor de producción se generó en otro sitio: solo se valida la FORMA, nunca que
    // corresponda a una contraseña concreta (eso lo decide `verifyPassword`).
    const otro = hashPassword('otra-clave-distinta-larga');
    expect(formatoDeHash(otro).valido).toBe(true);
  });
});

describe('diagnosticarCredenciales', () => {
  const HASH_ORIGINAL = process.env.VTUBERDEX_ADMIN_PASSWORD_HASH;
  const USUARIO_ORIGINAL = process.env.VTUBERDEX_ADMIN_USER;

  const conEntorno = (hash: string | undefined, usuario: string | undefined, fn: () => void) => {
    // OJO: `process.env.X = undefined` NO borra la variable, guarda la CADENA "undefined"
    // (que es truthy) y `credencialesConfiguradas()` daría true. Para el caso "sin hash" hay
    // que borrarla de verdad con `delete`.
    if (hash === undefined) delete process.env.VTUBERDEX_ADMIN_PASSWORD_HASH;
    else process.env.VTUBERDEX_ADMIN_PASSWORD_HASH = hash;
    if (usuario === undefined) delete process.env.VTUBERDEX_ADMIN_USER;
    else process.env.VTUBERDEX_ADMIN_USER = usuario;
    try {
      return fn();
    } finally {
      if (HASH_ORIGINAL === undefined) delete process.env.VTUBERDEX_ADMIN_PASSWORD_HASH;
      else process.env.VTUBERDEX_ADMIN_PASSWORD_HASH = HASH_ORIGINAL;
      if (USUARIO_ORIGINAL === undefined) delete process.env.VTUBERDEX_ADMIN_USER;
      else process.env.VTUBERDEX_ADMIN_USER = USUARIO_ORIGINAL;
    }
  };

  it('señala cuál de las dos mitades falló, en vez de mezclarlas', () => {
    // Es la razón de existir de esta función: con un 401 único, un usuario equivocado en el
    // formulario era indistinguible de una contraseña equivocada.
    conEntorno(HASH, undefined, () => {
      expect(diagnosticarCredenciales('admin', CLAVE)).toEqual({ ok: true, usuarioOk: true, claveOk: true });
      expect(diagnosticarCredenciales('batou', CLAVE)).toMatchObject({ ok: false, usuarioOk: false, claveOk: true });
      expect(diagnosticarCredenciales('admin', 'otra-clave')).toMatchObject({ ok: false, usuarioOk: true, claveOk: false });
      expect(diagnosticarCredenciales('', '')).toMatchObject({ ok: false, usuarioOk: false, claveOk: false });
    });
  });

  it('respeta VTUBERDEX_ADMIN_USER', () => {
    conEntorno(HASH, 'motoko', () => {
      expect(diagnosticarCredenciales('motoko', CLAVE).usuarioOk).toBe(true);
      expect(diagnosticarCredenciales('admin', CLAVE).usuarioOk).toBe(false);
    });
  });

  it('con clave correcta pero usuario distinto NO entra', () => {
    conEntorno(HASH, undefined, () => {
      expect(verificarCredenciales('mayor', CLAVE)).toBeNull();
      expect(verificarCredenciales('admin', CLAVE)).toMatchObject({ username: 'admin', role: 'admin' });
    });
  });

  it('sin hash configurado no entra nadie', () => {
    conEntorno(undefined, undefined, () => {
      expect(diagnosticarCredenciales('admin', CLAVE)).toEqual({ ok: false, usuarioOk: false, claveOk: false });
      expect(verificarCredenciales('admin', CLAVE)).toBeNull();
    });
  });
});
