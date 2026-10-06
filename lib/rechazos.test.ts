/**
 * Registro de rechazos de los formularios públicos: qué se apunta (formulario, código, campo) y, sobre
 * todo, qué NO (correo, contenido). SQLite en memoria con el mismo SQL que Turso.
 */
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, test } from 'vitest';

import { recibirSolicitud, rechazosPendientes } from '@/lib/solicitudes.mjs';
import { registrarRechazo, resumenDeRechazos, VIDA_RECHAZOS_DIAS } from '@/server/src/rechazos.mjs';
import { ejecutorSqlite, fijarCorreoDeFicha, TERMINOS_VERSION } from '@/server/src/solicitudes.mjs';

let ejecutor: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
});

const peticion = (cuerpo: unknown) =>
  new Request('http://localhost/api/solicitudes', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost' },
    body: JSON.stringify(cuerpo),
  });

describe('registrarRechazo / resumenDeRechazos', () => {
  test('agrupa por formulario y código, y cuenta los campos que fallaron', async () => {
    const issues = [{ path: 'socials.0.url' }, { path: 'name' }];
    await registrarRechazo(ejecutor, { formulario: 'inscripcion', codigo: 'payload_invalido', status: 400, issues });
    await registrarRechazo(ejecutor, { formulario: 'inscripcion', codigo: 'payload_invalido', status: 400, issues: [{ path: 'name' }] });
    await registrarRechazo(ejecutor, { formulario: 'baja', codigo: 'demasiados_correos', status: 429 });
    const r = await resumenDeRechazos(ejecutor);
    expect(r.total).toBe(3);
    expect(r.porCodigo[0]).toEqual({ formulario: 'inscripcion', codigo: 'payload_invalido', status: 400, n: 2 });
    expect(r.porCampo[0]).toEqual({ formulario: 'inscripcion', campo: 'name', n: 2 });
    expect(r.porCampo).toContainEqual({ formulario: 'inscripcion', campo: 'socials.0.url', n: 1 });
  });

  test('solo cuenta la ventana pedida y poda lo de más de 30 días', async () => {
    const ahora = new Date('2026-10-06T12:00:00Z');
    const dia = 24 * 60 * 60 * 1000;
    await registrarRechazo(ejecutor, { formulario: 'baja', codigo: 'a', status: 400, ahora: new Date(ahora.getTime() - 10 * dia) });
    await registrarRechazo(ejecutor, { formulario: 'baja', codigo: 'b', status: 400, ahora: new Date(ahora.getTime() - dia) });
    expect((await resumenDeRechazos(ejecutor, { dias: 7, ahora })).porCodigo.map((f) => f.codigo)).toEqual(['b']);
    expect((await resumenDeRechazos(ejecutor, { dias: 30, ahora })).total).toBe(2);
    await registrarRechazo(ejecutor, { formulario: 'baja', codigo: 'c', status: 400, ahora: new Date(ahora.getTime() + (VIDA_RECHAZOS_DIAS + 1) * dia) });
    expect((await resumenDeRechazos(ejecutor, { dias: 30, ahora: new Date(ahora.getTime() + (VIDA_RECHAZOS_DIAS + 1) * dia) })).total).toBe(1);
  });

  test('las rutas de campo se limpian: no cuela texto libre', async () => {
    await registrarRechazo(ejecutor, { formulario: 'x', codigo: 'y', status: 400, issues: [{ path: 'a b@c.com <script>' }] });
    expect((await resumenDeRechazos(ejecutor)).porCampo[0].campo).toBe('abc.comscript');
  });

  test('nunca lanza: si la base falla, se pierde el apunte y no la respuesta', async () => {
    const rota = { execute: async () => { throw new Error('caída'); }, exec: async () => {} };
    await expect(registrarRechazo(rota, { formulario: 'x', codigo: 'y', status: 400 })).resolves.toBeUndefined();
  });
});

describe('los formularios públicos apuntan sus rechazos', () => {
  test('una validación fallida queda con su campo y SIN correo ni contenido', async () => {
    await fijarCorreoDeFicha(ejecutor, 1, 'secreta@example.com');
    const respuesta = await recibirSolicitud(
      peticion({ email: 'secreta@example.com', ficha: 'x'.repeat(400), aceptaTerminos: true, terminosVersion: TERMINOS_VERSION }),
      'baja',
      ejecutor,
    );
    expect(respuesta.status).toBe(400);
    await rechazosPendientes();
    const r = await resumenDeRechazos(ejecutor);
    expect(r.porCodigo).toEqual([{ formulario: 'baja', codigo: 'payload_invalido', status: 400, n: 1 }]);
    expect(r.porCampo).toContainEqual({ formulario: 'baja', campo: 'ficha', n: 1 });
    const crudo = JSON.stringify(ejecutor.execute ? await ejecutor.execute('SELECT * FROM rechazo') : '');
    expect(crudo).not.toContain('secreta');
    expect(crudo).not.toContain('xxxx');
  });

  test('un envío aceptado no deja rastro', async () => {
    await fijarCorreoDeFicha(ejecutor, 1, 'a@example.com');
    const ok = await recibirSolicitud(peticion({ email: 'a@example.com', aceptaTerminos: true, terminosVersion: TERMINOS_VERSION }), 'baja', ejecutor);
    expect(ok.status).toBe(201);
    await rechazosPendientes();
    expect((await resumenDeRechazos(ejecutor)).total).toBe(0);
  });

  test('la inscripción sin credencial se apunta como falta_verificacion', async () => {
    await recibirSolicitud(peticion({ name: 'Luna' }), 'inscripcion', ejecutor);
    await rechazosPendientes();
    expect((await resumenDeRechazos(ejecutor)).porCodigo[0]).toMatchObject({ formulario: 'inscripcion', codigo: 'falta_verificacion' });
  });
});
