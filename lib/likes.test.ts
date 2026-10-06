/**
 * Likes: la regla de UNO por día y por VTuber, el tope por red, el día de Chile y el pegamento HTTP.
 * Corre contra SQLite en memoria con el MISMO SQL que usa Turso (`ejecutorSqlite`): sin red.
 */
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, test } from 'vitest';

import {
  MAX_POR_RED_Y_DIA,
  conExperiencia,
  contarLikes,
  cookieDeVisitante,
  darLike,
  diaDeChile,
  ejecutorSqlite,
  hashear,
  ipDelCliente,
  leerCookie,
  origenPermitido,
  resumenDeLikes,
  visitanteValido,
  yaDioLikeHoy,
} from '@/lib/likes.mjs';

let ejecutor: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const lunes = new Date('2026-10-05T15:00:00Z');
const martes = new Date('2026-10-06T15:00:00Z');

describe('un like por día y por VTuber', () => {
  test('el primero entra y el segundo del mismo día se rechaza', async () => {
    expect(await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor)).toEqual({ ok: true });
    expect(await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor)).toEqual({ ok: false, motivo: 'ya_dio_like_hoy' });
    expect(await contarLikes(1, ejecutor)).toBe(1);
  });

  test('al día siguiente puede volver a dar', async () => {
    await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor);
    expect((await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: martes }, ejecutor)).ok).toBe(true);
    expect(await contarLikes(1, ejecutor)).toBe(2);
  });

  test('el límite es POR VTuber: el mismo día puede votar a otro distinto', async () => {
    expect((await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor)).ok).toBe(true);
    expect((await darLike({ vtuberId: 2, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor)).ok).toBe(true);
    expect(await contarLikes(1, ejecutor)).toBe(1);
    expect(await contarLikes(2, ejecutor)).toBe(1);
  });

  test('visitantes distintos suman', async () => {
    await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor);
    await darLike({ vtuberId: 1, visitante: B, ip: '2.2.2.2', ahora: lunes }, ejecutor);
    expect(await contarLikes(1, ejecutor)).toBe(2);
  });

  test('peticiones SIMULTÁNEAS del mismo visitante: solo una entra (lo decide la clave primaria)', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 8 }, () => darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor)),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    expect(await contarLikes(1, ejecutor)).toBe(1);
  });

  test('yaDioLikeHoy distingue visitante, VTuber y día', async () => {
    await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: lunes }, ejecutor);
    expect(await yaDioLikeHoy({ vtuberId: 1, visitante: A, ahora: lunes }, ejecutor)).toBe(true);
    expect(await yaDioLikeHoy({ vtuberId: 1, visitante: B, ahora: lunes }, ejecutor)).toBe(false);
    expect(await yaDioLikeHoy({ vtuberId: 2, visitante: A, ahora: lunes }, ejecutor)).toBe(false);
    expect(await yaDioLikeHoy({ vtuberId: 1, visitante: A, ahora: martes }, ejecutor)).toBe(false);
  });
});

describe('tope por red (borrar la cookie no basta para inflar)', () => {
  test(`desde la misma IP entran ${MAX_POR_RED_Y_DIA} al mismo VTuber y el resto se rechaza`, async () => {
    const resultados = [];
    for (let i = 0; i < MAX_POR_RED_Y_DIA + 2; i += 1) {
      const visitante = `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`;
      resultados.push(await darLike({ vtuberId: 1, visitante, ip: '9.9.9.9', ahora: lunes }, ejecutor));
    }
    expect(resultados.filter((r) => r.ok)).toHaveLength(MAX_POR_RED_Y_DIA);
    expect(resultados.at(-1)).toEqual({ ok: false, motivo: 'demasiados_desde_esta_red' });
    // Otra red no se ve afectada, y al día siguiente se reinicia.
    expect((await darLike({ vtuberId: 1, visitante: A, ip: '8.8.8.8', ahora: lunes }, ejecutor)).ok).toBe(true);
    expect((await darLike({ vtuberId: 1, visitante: B, ip: '9.9.9.9', ahora: martes }, ejecutor)).ok).toBe(true);
  });

  test('NO se guarda la IP: solo su hash', async () => {
    await darLike({ vtuberId: 1, visitante: A, ip: '203.0.113.7', ahora: lunes }, ejecutor);
    const { rows } = await ejecutor.execute('SELECT * FROM like_dia');
    expect(JSON.stringify(rows)).not.toContain('203.0.113.7');
    expect(rows[0].red).toBe(hashear('203.0.113.7'));
    expect(hashear('1.1.1.1')).not.toBe(hashear('1.1.1.2'));
    expect(hashear('1.1.1.1', 'otra-sal')).not.toBe(hashear('1.1.1.1', 'sal'));
  });
});

describe('el día es el de Chile', () => {
  test('a las 22:00 en Chile ya es el día siguiente en UTC pero NO en Chile', () => {
    // 2026-10-06T01:00Z son las 22:00 del 5 de octubre en Santiago (UTC-3 en horario de verano).
    expect(diaDeChile(new Date('2026-10-06T01:00:00Z'))).toBe('2026-10-05');
    expect(diaDeChile(new Date('2026-10-06T04:00:00Z'))).toBe('2026-10-06');
  });

  test('dos likes a un lado y otro de la medianoche de Chile son de días distintos', async () => {
    const antes = new Date('2026-10-06T02:30:00Z'); // 23:30 del día 5 en Chile
    const despues = new Date('2026-10-06T04:30:00Z'); // 01:30 del día 6
    expect((await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: antes }, ejecutor)).ok).toBe(true);
    expect((await darLike({ vtuberId: 1, visitante: A, ip: '1.1.1.1', ahora: despues }, ejecutor)).ok).toBe(true);
  });
});

describe('experiencia en la ficha', () => {
  const base = { level: null, experience: null, name: 'x' };

  test('los likes suben la experiencia y el nivel de la ficha', () => {
    expect(conExperiencia(base, 0)).toMatchObject({ likes: 0, level: 1, experience: { current: 0, max: 100 } });
    expect(conExperiencia(base, 3)).toMatchObject({ likes: 3, level: 1, experience: { current: 30, max: 100 } });
    expect(conExperiencia(base, 10)).toMatchObject({ level: 2, experience: { current: 0 } });
    // Una ficha con experiencia propia suma sobre ella.
    expect(conExperiencia({ level: 3, experience: { current: 65, max: 500 } }, 2).experience).toEqual({ current: 85, max: 500, total: 335 });
  });

  test('el resumen del visitante lleva el estado «ya dio like»', () => {
    expect(resumenDeLikes(base, 12, true)).toEqual({ likes: 12, liked: true, level: 2, experience: { current: 20, max: 150, total: 120 }, xpPorLike: 10 });
  });
});

describe('pegamento HTTP', () => {
  test('lee la cookie del visitante y descarta valores manipulados', () => {
    expect(leerCookie('a=1; vd_v=abc; b=2', 'vd_v')).toBe('abc');
    expect(leerCookie('a=1', 'vd_v')).toBeNull();
    expect(leerCookie(null, 'vd_v')).toBeNull();
    expect(visitanteValido(A)).toBe(A);
    expect(visitanteValido("'; DROP TABLE like_dia;--")).toBeNull();
    expect(visitanteValido(undefined)).toBeNull();
  });

  test('la cookie es httpOnly, de un año, y Secure solo con HTTPS', () => {
    expect(cookieDeVisitante(A, true)).toMatch(/HttpOnly; SameSite=Lax; Secure$/);
    expect(cookieDeVisitante(A, false)).not.toContain('Secure');
    expect(cookieDeVisitante(A, false)).toContain('Max-Age=31536000');
  });

  test('IP: el primer valor de x-forwarded-for', () => {
    expect(ipDelCliente(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7');
    expect(ipDelCliente(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2');
    expect(ipDelCliente(new Headers())).toBe('desconocida');
  });

  test('un POST desde OTRO sitio se rechaza; sin Origin o del mismo sitio, pasa', () => {
    expect(origenPermitido(new Headers({ origin: 'https://malo.example', host: 'vtuberdex.com' }))).toBe(false);
    expect(origenPermitido(new Headers({ origin: 'https://vtuberdex.com', host: 'vtuberdex.com' }))).toBe(true);
    expect(origenPermitido(new Headers({ origin: 'http://192.168.100.90:3000', host: '192.168.100.90:3000' }))).toBe(true);
    expect(origenPermitido(new Headers({ host: 'vtuberdex.com' }))).toBe(true);
    expect(origenPermitido(new Headers({ origin: 'no es una url', host: 'vtuberdex.com' }))).toBe(false);
  });
});
