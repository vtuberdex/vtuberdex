/**
 * Solicitudes (inscripción y baja): reglas de la cola, confidencialidad del contacto, términos
 * obligatorios y el pegamento HTTP público. Corre contra SQLite en memoria con el MISMO SQL que
 * Turso (`ejecutorSqlite`): sin red.
 */
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, test } from 'vitest';

import { recibirSolicitud } from '@/lib/solicitudes.mjs';
import { CLAUSULAS, contarPalabras } from '@/lib/terminos';
import { vtuberCreateSchema } from '@/server/src/validation.mjs';
import {
  MAX_POR_RED_Y_DIA,
  SolicitudError,
  TERMINOS_VERSION,
  crearSolicitud,
  ejecutorSqlite,
  fichaDesdeInscripcion,
  leerSolicitud,
  listarSolicitudes,
  resolverSolicitud,
} from '@/server/src/solicitudes.mjs';

let ejecutor: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
});

const inscripcion = (extra: Record<string, unknown> = {}) => ({
  name: 'Luna Test',
  email: 'Luna@Example.com',
  realName: 'Persona Real',
  country: 'chile',
  languages: ['es'],
  phrase: 'Hola',
  cardText: 'Una historia',
  height: '1,60 m',
  birthday: '12 de marzo',
  favoriteFood: 'Pizza',
  dislikedFood: 'Brócoli',
  favoriteGame: 'Zelda',
  favoriteSeries: 'Dark',
  favoriteMusic: 'Rock',
  favoriteAnime: 'Frieren',
  favoriteAnimal: 'Gato',
  favoriteColor: 'Verde',
  modeler: 'Riko',
  hashtag: '#LunaArt',
  imageUrl: 'https://imgs.test/avatar.png',
  logoUrl: 'https://imgs.test/logo.png',
  socials: [{ platform: 'Twitch', url: 'https://twitch.tv/luna' }],
  aceptaTerminos: true,
  terminosVersion: TERMINOS_VERSION,
  ...extra,
});

const baja = (extra: Record<string, unknown> = {}) => ({
  ficha: '/v/luna-test',
  email: 'luna@example.com',
  prueba: 'dejaré una marca en mi canal',
  aceptaTerminos: true,
  terminosVersion: TERMINOS_VERSION,
  ...extra,
});

const enviar = async (entrada: object, tipo: 'inscripcion' | 'baja' = 'inscripcion', ip = '1.1.1.1') => {
  const resultado = await crearSolicitud(ejecutor, entrada, { tipo, ip });
  // `id` es `null` solo en el envío descartado por el campo trampa, que tiene su propia prueba.
  return { ...resultado, id: resultado.id ?? 0 };
};

async function rechazo(promesa: Promise<unknown>): Promise<SolicitudError> {
  try {
    await promesa;
  } catch (error) {
    return error as SolicitudError;
  }
  throw new Error('debía rechazarse');
}

describe('términos obligatorios', () => {
  test.each([
    ['inscripcion', inscripcion],
    ['baja', baja],
  ] as const)('una %s sin aceptar los términos no entra', async (tipo, hacer) => {
    for (const aceptaTerminos of [false, undefined, 'true', 1]) {
      const error = await rechazo(enviar(hacer({ aceptaTerminos }), tipo));
      expect(error.status).toBe(400);
      expect(error.code).toBe('payload_invalido');
    }
    expect((await listarSolicitudes(ejecutor, { estado: 'todas' })).items).toHaveLength(0);
  });

  test('una versión vieja de los términos se rechaza (no se registra una aceptación de un texto que ya no existe)', async () => {
    const error = await rechazo(enviar(inscripcion({ terminosVersion: '2020-01-01' })));
    expect(error.status).toBe(409);
    expect(error.code).toBe('terminos_desactualizados');
  });

  test('la solicitud guarda qué versión se aceptó y cuándo', async () => {
    const { id } = await enviar(inscripcion());
    const guardada = await leerSolicitud(ejecutor, id);
    expect(guardada?.terminosVersion).toBe(TERMINOS_VERSION);
    expect(guardada?.terminosAceptadosEn).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(guardada?.estado).toBe('pendiente');
  });
});

describe('confidencialidad', () => {
  test('el correo y el nombre civil van al contacto, no a los datos públicos', async () => {
    const { id } = await enviar(inscripcion());
    const guardada = await leerSolicitud(ejecutor, id);
    expect(guardada?.contacto).toEqual({ email: 'luna@example.com', realName: 'Persona Real' });
    expect(JSON.stringify(guardada?.datos)).not.toMatch(/luna@example\.com|Persona Real/);
    expect(guardada?.datos).not.toHaveProperty('aceptaTerminos');
  });

  test('de la red solo se guarda un hash, nunca la IP', async () => {
    await enviar(inscripcion(), 'inscripcion', '203.0.113.9');
    const { rows } = await ejecutor.execute('SELECT red FROM solicitud');
    expect(String(rows[0].red)).not.toContain('203.0.113.9');
    expect(String(rows[0].red)).toMatch(/^[0-9a-f]{32}$/);
  });

  test('la ficha que nace de una inscripción no lleva el contacto y nace en borrador', async () => {
    const { id } = await enviar(inscripcion());
    const ficha: Record<string, unknown> = fichaDesdeInscripcion((await leerSolicitud(ejecutor, id))!);
    expect(ficha.status).toBe('draft');
    expect(JSON.stringify(ficha)).not.toMatch(/example\.com|Persona Real/);
    expect(vtuberCreateSchema.safeParse(ficha).success).toBe(true);
    expect(ficha).toMatchObject({ height: '1,60 m', hashtag: '#LunaArt', artists: ['Riko'] });
    expect((ficha as { profile: unknown[] }).profile).toContainEqual({ label: 'Anime favorito', value: 'Frieren' });
  });

  test('país y signo son opcionales', async () => {
    const { id } = await enviar(inscripcion({ country: '', zodiac: '' }));
    const ficha = fichaDesdeInscripcion((await leerSolicitud(ejecutor, id))!);
    expect(ficha.countries).toEqual([]);
    expect(vtuberCreateSchema.safeParse(ficha).success).toBe(true);
  });

  test('rechazar o procesar borra el contacto; aprobar lo conserva', async () => {
    const a = (await enviar(inscripcion({ email: 'a@x.cl' }))).id;
    const b = (await enviar(inscripcion({ email: 'b@x.cl' }))).id;
    const c = (await enviar(baja({ email: 'c@x.cl' }), 'baja')).id;
    expect((await resolverSolicitud(ejecutor, a, { estado: 'aprobada', actor: 'admin', vtuberSlug: 'luna' }))?.contacto).not.toBeNull();
    expect((await resolverSolicitud(ejecutor, b, { estado: 'rechazada', actor: 'admin' }))?.contacto).toBeNull();
    expect((await resolverSolicitud(ejecutor, c, { estado: 'procesada', actor: 'admin' }))?.contacto).toBeNull();
  });
});

describe('validación', () => {
  test('exige correo válido, país, idioma y una red', async () => {
    for (const mala of [
      inscripcion({ email: 'no-es-correo' }),
      inscripcion({ height: '' }),
      inscripcion({ cardText: '' }),
      inscripcion({ logoUrl: '' }),
      inscripcion({ imageUrl: '' }),
      inscripcion({ modeler: '  ' }),
      inscripcion({ languages: [] }),
      inscripcion({ socials: [] }),
      inscripcion({ socials: [{ platform: 'X', url: 'javascript:alert(1)' }] }),
      inscripcion({ name: '   ' }),
    ]) {
      expect((await rechazo(enviar(mala))).status).toBe(400);
    }
  });

  test('la baja exige indicar la ficha y cómo comprobar la titularidad', async () => {
    expect((await rechazo(enviar(baja({ ficha: '' }), 'baja'))).status).toBe(400);
    expect((await rechazo(enviar(baja({ prueba: '' }), 'baja'))).status).toBe(400);
  });

  test('el campo trampa descarta el envío sin guardar nada y sin avisar', async () => {
    const resultado = await enviar(inscripcion({ website: 'http://spam' }));
    expect(resultado.descartada).toBe(true);
    expect((await listarSolicitudes(ejecutor, { estado: 'todas' })).items).toHaveLength(0);
  });

  test('no se acumulan dos pendientes del mismo correo y tipo', async () => {
    await enviar(inscripcion());
    const error = await rechazo(enviar(inscripcion({ email: 'LUNA@example.com' })));
    expect(error.code).toBe('solicitud_pendiente');
    // otro tipo, o ya resuelta, sí puede entrar
    await enviar(baja({ email: 'luna@example.com' }), 'baja');
  });

  test('hay un tope de envíos por red y por día', async () => {
    for (let i = 0; i < MAX_POR_RED_Y_DIA; i += 1) await enviar(inscripcion({ email: `u${i}@x.cl` }));
    const error = await rechazo(enviar(inscripcion({ email: 'otro@x.cl' })));
    expect(error.status).toBe(429);
    // otra red no está afectada
    await enviar(inscripcion({ email: 'otro@x.cl' }), 'inscripcion', '9.9.9.9');
  });
});

describe('resolución', () => {
  test('una solicitud se resuelve UNA sola vez', async () => {
    const { id } = await enviar(inscripcion());
    await resolverSolicitud(ejecutor, id, { estado: 'rechazada', actor: 'admin', nota: 'no' });
    const error = await rechazo(resolverSolicitud(ejecutor, id, { estado: 'aprobada', actor: 'admin' }));
    expect(error.code).toBe('ya_resuelta');
  });

  test('una baja no se «aprueba» y una inscripción no se «procesa»', async () => {
    const i = (await enviar(inscripcion())).id;
    const b = (await enviar(baja(), 'baja')).id;
    expect((await rechazo(resolverSolicitud(ejecutor, b, { estado: 'aprobada', actor: 'admin' }))).code).toBe('estado_invalido');
    expect((await rechazo(resolverSolicitud(ejecutor, i, { estado: 'procesada', actor: 'admin' }))).code).toBe('estado_invalido');
  });

  test('el listado separa por estado y cuenta las pendientes por tipo', async () => {
    const i = (await enviar(inscripcion())).id;
    await enviar(baja(), 'baja');
    await resolverSolicitud(ejecutor, i, { estado: 'rechazada', actor: 'admin' });
    const pendientes = await listarSolicitudes(ejecutor, { estado: 'pendiente' });
    expect(pendientes.items).toHaveLength(1);
    expect(pendientes.pendientes).toEqual({ inscripcion: 0, baja: 1 });
    expect((await listarSolicitudes(ejecutor, { estado: 'todas' })).items).toHaveLength(2);
  });
});

describe('POST público', () => {
  const peticion = (cuerpo: unknown, cabeceras: Record<string, string> = {}) =>
    new Request('http://localhost/api/inscripciones', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost', ...cabeceras },
      body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
    });

  test('201 con acuse que no devuelve lo guardado', async () => {
    const respuesta = await recibirSolicitud(peticion(inscripcion()), 'inscripcion', ejecutor);
    expect(respuesta.status).toBe(201);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toMatchObject({ ok: true, estado: 'pendiente' });
    expect(JSON.stringify(cuerpo)).not.toContain('example.com');
    expect(respuesta.headers.get('cache-control')).toBe('no-store');
  });

  test('400 sin aceptar términos, con el motivo', async () => {
    const respuesta = await recibirSolicitud(peticion(inscripcion({ aceptaTerminos: false })), 'inscripcion', ejecutor);
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).detail).toMatch(/términos/);
  });

  test('400 con cuerpo que no es JSON y 403 con origen ajeno', async () => {
    expect((await recibirSolicitud(peticion('no json'), 'inscripcion', ejecutor)).status).toBe(400);
    const ajeno = await recibirSolicitud(peticion(inscripcion(), { origin: 'https://malo.example' }), 'inscripcion', ejecutor);
    expect(ajeno.status).toBe(403);
  });
});

describe('texto de los términos', () => {
  test('contiene las cláusulas que los formularios prometen, con su ancla', () => {
    const ids = CLAUSULAS.map((c) => c.id);
    for (const id of ['salida', 'datos-personales', 'donaciones']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('la cláusula de salida dice que la ficha no se elimina sino que se degrada', () => {
    const salida = CLAUSULAS.find((c) => c.id === 'salida')!.parrafos.join(' ');
    expect(salida).toMatch(/NO IMPLICA LA ELIMINACIÓN/);
    expect(salida).toMatch(/corrup/i);
    expect(salida).toMatch(/degrad/i);
  });

  test('la de datos personales promete confidencialidad y no publicación', () => {
    const datos = CLAUSULAS.find((c) => c.id === 'datos-personales')!.parrafos.join(' ');
    expect(datos).toMatch(/CONFIDENCIALES/);
    expect(datos).toMatch(/No se publican/);
  });

  test('la de donaciones declara que no tiene fines de lucro', () => {
    const donaciones = CLAUSULAS.find((c) => c.id === 'donaciones')!.parrafos.join(' ');
    expect(donaciones).toMatch(/no tiene fines de lucro/i);
  });

  test('es un documento extenso', () => {
    expect(CLAUSULAS.length).toBeGreaterThanOrEqual(20);
    expect(contarPalabras()).toBeGreaterThan(4000);
  });
});
