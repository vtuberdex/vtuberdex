import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, test } from 'vitest';

import { VIDA_BORRADOR_MS, borrarBorrador, guardarBorrador, leerBorrador, sanearBorrador } from '@/server/src/borradores.mjs';
import { ejecutorSqlite } from '@/server/src/solicitudes.mjs';

let ejecutor: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
});

describe('sanearBorrador', () => {
  test('se queda solo con los campos del formulario y recorta cada uno a su máximo', () => {
    const limpio = sanearBorrador({ name: 'x'.repeat(500), cardText: 'y'.repeat(9000), email: 'a@b.cl', aceptaTerminos: true, website: 'bot', favoriteFood: 'pizza' });
    expect(limpio.name).toHaveLength(160);
    expect(limpio.cardText).toHaveLength(4000);
    expect(limpio.favoriteFood).toBe('pizza');
    for (const sobra of ['email', 'aceptaTerminos', 'website']) expect(limpio).not.toHaveProperty(sobra);
  });

  test('lo que no es texto queda vacío, las listas se acotan y el paso solo puede ser 3, 4 o 5', () => {
    const limpio = sanearBorrador({
      name: 42,
      languages: ['es', 7, 'en'],
      socials: [{ platform: 'Twitch', url: 'https://t.tv/x' }, null, 'raro', ...Array.from({ length: 20 }, () => ({ platform: 'a', url: 'b' }))],
      paso: 99,
    });
    expect(limpio.name).toBe('');
    expect(limpio.languages).toEqual(['es', 'en']);
    expect(limpio.socials).toHaveLength(10);
    expect(limpio.paso).toBe(3);
    expect(sanearBorrador({ paso: 5 }).paso).toBe(5);
    expect(sanearBorrador({ paso: 4 }).paso).toBe(4);
    expect(sanearBorrador({ paso: 1 }).paso).toBe(3);
  });

  test('una entrada que no es un objeto da un borrador vacío, no una excepción', () => {
    expect(sanearBorrador(null).name).toBe('');
    expect(sanearBorrador('texto').languages).toEqual([]);
  });
});

describe('guardar y leer', () => {
  test('un borrador por correo: guardar de nuevo lo reemplaza', async () => {
    await guardarBorrador(ejecutor, { email: 'a@x.cl', datos: { name: 'Uno', paso: 3 } });
    await guardarBorrador(ejecutor, { email: 'a@x.cl', datos: { name: 'Dos', paso: 4 } });
    expect(await leerBorrador(ejecutor, { email: 'a@x.cl' })).toMatchObject({ datos: { name: 'Dos', paso: 4 } });
    expect(await leerBorrador(ejecutor, { email: 'b@x.cl' })).toBeNull();
  });

  test('vence a los 60 días (y al guardar otro se purgan los vencidos)', async () => {
    const hoy = new Date('2026-10-06T12:00:00Z');
    await guardarBorrador(ejecutor, { email: 'a@x.cl', datos: { name: 'Viejo' }, ahora: new Date(hoy.getTime() - VIDA_BORRADOR_MS - 1000) });
    expect(await leerBorrador(ejecutor, { email: 'a@x.cl', ahora: hoy })).toBeNull();
    await guardarBorrador(ejecutor, { email: 'b@x.cl', datos: { name: 'Nuevo' }, ahora: hoy });
    const { rows } = await ejecutor.execute('SELECT COUNT(*) AS n FROM borrador');
    expect(Number(rows[0].n)).toBe(1);
  });

  test('borrar lo quita', async () => {
    await guardarBorrador(ejecutor, { email: 'a@x.cl', datos: { name: 'Uno' } });
    await borrarBorrador(ejecutor, { email: 'a@x.cl' });
    expect(await leerBorrador(ejecutor, { email: 'a@x.cl' })).toBeNull();
  });
});
