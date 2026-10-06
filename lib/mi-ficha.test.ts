/**
 * «Mi ficha»: el aviso de subida de nivel por correo, el enlace mágico y el reparto de puntos. SQLite en
 * memoria para la cola y un transporte de correo falso; la ficha y los likes se simulan.
 */
import { DatabaseSync } from 'node:sqlite';

import { beforeEach, describe, expect, test, vi } from 'vitest';

const estado = vi.hoisted(() => ({ likes: 0 }));
const FICHAS = vi.hoisted(() => ({
  luna: { id: 7, slug: 'luna', name: 'Luna', level: 1, experience: { current: 0, max: 100 }, premium: null, skills: [{ category: 'active', name: 'Rayo', type: 'Ataque' }, { category: 'passive', name: 'Voz Dulce' }] },
  scrape: { id: 8, slug: 'scrape', name: 'Del Scrape', level: 5, experience: { current: 0, max: 300 }, premium: null, skills: [] },
}));

vi.mock('@/server/src/search.mjs', () => ({
  getVtuberBySlug: (_db: unknown, slug: string) => (FICHAS as Record<string, unknown>)[slug] ?? null,
}));
vi.mock('@/lib/diario.mjs', () => ({ dbConDiario: async () => ({}) }));
vi.mock('@/lib/likes.mjs', async (original) => ({ ...(await original<typeof import('@/lib/likes.mjs')>()), contarLikes: async () => estado.likes }));

import * as correo from '@/lib/correo.mjs';
import * as miFicha from '@/lib/mi-ficha.mjs';
import { ejecutorSqlite } from '@/server/src/solicitudes.mjs';

let e: ReturnType<typeof ejecutorSqlite>;
const enviados: Array<{ to: string; subject: string; text: string }> = [];

const post = (cuerpo: unknown) =>
  new Request('http://localhost/api/mi-ficha', {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: 'localhost' },
    body: JSON.stringify(cuerpo),
  });

const tokenDelCorreo = (i = enviados.length - 1) => enviados[i].text.match(/#t=([\w-]+)/)![1];

beforeEach(async () => {
  e = ejecutorSqlite(new DatabaseSync(':memory:'));
  enviados.length = 0;
  estado.likes = 0;
  miFicha.__reiniciarLimiteMiFicha();
  correo.__usarTransporte({
    sendMail: async (m: { to: string; subject: string; text: string }) => {
      enviados.push({ to: m.to, subject: m.subject, text: m.text });
      return { messageId: 'x' };
    },
  });
  // Una inscripción APROBADA: es lo que liga la ficha con un correo.
  await (await import('@/server/src/solicitudes.mjs')).conTablas(e);
  await e.execute(
    "INSERT INTO solicitud (tipo, estado, datos, contacto, red, terminos_version, terminos_aceptados_en, creado, vtuber_slug) VALUES ('inscripcion','aprobada','{}', ?, 'r','v','2026-01-01','2026-01-01','luna')",
    [JSON.stringify({ email: 'luna@example.com' })],
  );
});

describe('aviso de subida de nivel', () => {
  test('al subir de nivel con likes llega UN correo con el enlace y los puntos', async () => {
    estado.likes = 10; // 10 likes × 10 XP = 100 = el nivel 1 completo
    expect(await miFicha.avisarSubidaDeNivel({ card: FICHAS.luna, likes: 10, ejecutor: e, db: {} })).toBe(true);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('luna@example.com');
    expect(enviados[0].subject).toMatch(/nivel 2/);
    expect(enviados[0].text).toMatch(/\/mi-ficha#t=/);
    expect(enviados[0].text).toMatch(/3 puntos/);
    // Otro like en el mismo nivel no vuelve a avisar.
    expect(await miFicha.avisarSubidaDeNivel({ card: FICHAS.luna, likes: 11, ejecutor: e, db: {} })).toBe(false);
    expect(enviados).toHaveLength(1);
  });

  test('sin subir de nivel no se manda nada', async () => {
    expect(await miFicha.avisarSubidaDeNivel({ card: FICHAS.luna, likes: 3, ejecutor: e, db: {} })).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  test('una ficha del scrape (sin correo) sube de nivel sin que nadie reciba nada ni se rompa', async () => {
    expect(await miFicha.avisarSubidaDeNivel({ card: FICHAS.scrape, likes: 40, ejecutor: e, db: {} })).toBe(false);
    expect(enviados).toHaveLength(0);
  });

  test('si el correo falla, el aviso se suelta y el siguiente like lo reintenta', async () => {
    correo.__usarTransporte({ sendMail: async () => { throw new Error('buzón caído'); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await miFicha.avisarSubidaDeNivel({ card: FICHAS.luna, likes: 10, ejecutor: e, db: {} })).toBe(false);
    correo.__usarTransporte({ sendMail: async (m: { to: string; subject: string; text: string }) => { enviados.push(m); return {}; } });
    expect(await miFicha.avisarSubidaDeNivel({ card: FICHAS.luna, likes: 11, ejecutor: e, db: {} })).toBe(true);
    expect(enviados).toHaveLength(1);
  });
});

describe('enlace mágico, estado y reparto', () => {
  const entrar = async () => {
    estado.likes = 10;
    await miFicha.avisarSubidaDeNivel({ card: FICHAS.luna, likes: 10, ejecutor: e, db: {} });
    return tokenDelCorreo();
  };

  test('el enlace del correo abre la ficha con nivel, total y puntos; y NO se gasta al usarlo', async () => {
    const token = await entrar();
    for (let i = 0; i < 2; i += 1) {
      const r = await miFicha.estadoDeMiFicha(post({ token }), { ejecutor: e, db: {} });
      expect(r.status).toBe(200);
      const cuerpo = await r.json();
      expect(cuerpo.ficha).toMatchObject({ slug: 'luna', level: 2, levelsGained: 1 });
      expect(cuerpo.ficha.experience.total).toBe(100);
      expect(cuerpo.ficha.puntos).toMatchObject({ disponibles: 3, ganados: 3 });
    }
  });

  test('repartir gasta un punto, sube el rango y se puede devolver todo', async () => {
    const token = await entrar();
    const clave = (await (await miFicha.estadoDeMiFicha(post({ token }), { ejecutor: e, db: {} })).json()).ficha.puntos.habilidades[0].clave;
    const sube = await miFicha.repartirPuntos(post({ token, slug: 'luna', accion: 'subir', clave }), { ejecutor: e, db: {} });
    const c = await sube.json();
    expect(c.ficha.puntos.disponibles).toBe(2);
    expect(c.ficha.puntos.habilidades.find((h: { clave: string }) => h.clave === clave).rango).toBe(1);
    const reinicia = await (await miFicha.repartirPuntos(post({ token, slug: 'luna', accion: 'reiniciar' }), { ejecutor: e, db: {} })).json();
    expect(reinicia.ficha.puntos.disponibles).toBe(3);
  });

  test('un token inválido, o una ficha ajena, no dejan tocar nada', async () => {
    const token = await entrar();
    expect((await miFicha.estadoDeMiFicha(post({ token: 'x'.repeat(43) }), { ejecutor: e, db: {} })).status).toBe(410);
    expect((await miFicha.repartirPuntos(post({ token, slug: 'scrape', accion: 'reiniciar' }), { ejecutor: e, db: {} })).status).toBe(404);
    expect((await miFicha.repartirPuntos(post({ token: 'nope', slug: 'luna', accion: 'reiniciar' }), { ejecutor: e, db: {} })).status).toBe(410);
  });

  test('sin puntos el servidor lo explica (409 sin_puntos)', async () => {
    estado.likes = 0;
    const { crearToken } = await import('@/server/src/verificacion.mjs');
    const token = await crearToken(e, { proposito: 'ficha', email: 'luna@example.com' });
    const r = await miFicha.repartirPuntos(post({ token, slug: 'luna', accion: 'subir', clave: 'active:rayo' }), { ejecutor: e, db: {} });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe('sin_puntos');
  });
});

describe('pedir el enlace a mano', () => {
  test('con una ficha inscrita llega el correo; con otro correo, nada, y la respuesta es idéntica', async () => {
    const real = await miFicha.pedirEnlaceDeMiFicha(post({ email: 'Luna@Example.com' }), { ejecutor: e, db: {}, esperar: true });
    const ajeno = await miFicha.pedirEnlaceDeMiFicha(post({ email: 'otra@example.com' }), { ejecutor: e, db: {}, esperar: true });
    expect(await real.json()).toEqual(await ajeno.json());
    expect(enviados).toHaveLength(1);
    expect(enviados[0].to).toBe('luna@example.com');
    const r = await miFicha.estadoDeMiFicha(post({ token: tokenDelCorreo() }), { ejecutor: e, db: {} });
    expect(r.status).toBe(200);
  });

  test('un correo mal escrito es 400', async () => {
    expect((await miFicha.pedirEnlaceDeMiFicha(post({ email: 'nada' }), { ejecutor: e, db: {} })).status).toBe(400);
  });
});
