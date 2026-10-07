/**
 * Vista previa de una solicitud: lo que pasaría al aprobar, SIN escribir nada. Se prueba contra la base de ejemplo
 * (la misma que usan las demás pruebas de solicitudes) y, sobre todo, que la simulación NO deja rastro.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '@/server/src/db/index.mjs';
import { candidatasParaReferencia, cambiosDeModificacion, vistaPrevia } from '@/server/src/solicitud-vista.mjs';
import { seedDatabase } from '@/server/src/seed.mjs';
import { TERMINOS_VERSION, confirmarSolicitud, crearSolicitud, ejecutorSqlite, leerSolicitud } from '@/server/src/solicitudes.mjs';

const pais = (slug: string, name: string) => ({ slug, name, flag: '🏳️' });
const DATASET = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  vtubers: [
    {
      dexNumber: 18, slug: 'gkuro', name: 'GKuro', countries: [pais('chile', 'Chile')], languages: ['es'], groups: [], artists: ['Riko'],
      source: { hasDetail: true }, assets: {},
      detail: {
        phrase: 'hola',
        profile: [{ label: 'Anime favorito', value: 'Naruto' }, { label: 'Serie favorita', value: 'Dark' }],
        factions: [], stats: {}, skills: [],
        socials: [{ platform: 'Twitch', label: 'Twitch', url: 'https://twitch.tv/gkuro' }],
      },
    },
    { dexNumber: 30, slug: 'drawchii', name: 'Drawchii', countries: [], languages: ['es'], groups: [], artists: [], source: { hasDetail: false }, assets: {}, detail: null },
  ],
};

let dir: string;
let db: ReturnType<typeof openDatabase>;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-vista-'));
  db = openDatabase(path.join(dir, 'catalogo.db'));
  seedDatabase({ db, dataset: DATASET });
});
afterAll(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let ejecutor: ReturnType<typeof ejecutorSqlite>;
beforeEach(() => {
  ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
});

let n = 0;
const base = { aceptaTerminos: true, terminosVersion: TERMINOS_VERSION };
const mod = async (extra: Record<string, unknown>) => {
  const { id } = await crearSolicitud(ejecutor, { ficha: '/v/gkuro', email: `m${(n += 1)}@example.com`, ...base, ...extra }, { tipo: 'modificacion', ip: '1.1.1.1' });
  await confirmarSolicitud(ejecutor, Number(id));
  return (await leerSolicitud(ejecutor, Number(id)))!;
};
const inscripcion = async (extra: Record<string, unknown> = {}) => {
  const { id } = await crearSolicitud(
    ejecutor,
    {
      name: 'Nueva Estrella', country: 'chile', languages: ['es'], phrase: 'hola', cardText: 'Una historia.', height: '1,60 m', birthday: '1 de enero',
      favoriteFood: 'pizza', dislikedFood: 'nada', favoriteGame: 'x', favoriteSeries: 'x', favoriteMusic: 'x', favoriteAnime: 'x', favoriteAnimal: 'x',
      favoriteColor: 'azul', modeler: 'Alguien', hashtag: '#nueva', zodiac: 'Aries', themeColor: '#336699', imageUrl: 'https://x.com/a.png', logoUrl: 'https://x.com/b.png',
      socials: [{ platform: 'twitch', url: 'https://twitch.tv/nueva' }],
      email: `i${(n += 1)}@example.com`, ...base, ...extra,
    },
    { tipo: 'inscripcion', ip: '2.2.2.2' },
  );
  await confirmarSolicitud(ejecutor, Number(id));
  return (await leerSolicitud(ejecutor, Number(id)))!;
};
const baja = async (extra: Record<string, unknown> = {}) => {
  const { id } = await crearSolicitud(ejecutor, { ficha: '/v/gkuro', email: `b${(n += 1)}@example.com`, prueba: 'soy el titular', motivo: 'ya no streameo', ...base, ...extra }, { tipo: 'baja', ip: '3.3.3.3' });
  await confirmarSolicitud(ejecutor, Number(id));
  return (await leerSolicitud(ejecutor, Number(id)))!;
};
const total = () => (db.prepare('SELECT COUNT(*) n FROM vtuber').get() as { n: number }).n;

describe('modificación: qué cambia', () => {
  test('muestra la ficha afectada y SOLO lo que realmente cambia (antes → después)', async () => {
    const v = vistaPrevia(db, await mod({ phrase: 'Frase nueva', height: '1,70 m', favoriteAnime: 'Naruto' }));
    expect(v.puedeAprobar).toBe(true);
    expect(v.problema).toBeNull();
    expect(v.ficha).toMatchObject({ slug: 'gkuro', name: 'GKuro', dexNumber: 18 });
    const por = Object.fromEntries(v.cambios.map((c: { campo: string }) => [c.campo, c]));
    expect(por['Frase']).toMatchObject({ antes: 'hola', despues: 'Frase nueva', nuevo: false });
    expect(por['Estatura']).toMatchObject({ despues: '1,70 m', nuevo: true });
    // «Anime favorito: Naruto» ya estaba igual: no es un cambio y no debe aparecer.
    expect(Object.keys(por).some((k) => k.includes('Anime'))).toBe(false);
  });

  test('un gusto o una red nuevos aparecen como «nuevo»; uno existente muestra su valor anterior', async () => {
    const v = vistaPrevia(db, await mod({ favoriteSeries: 'Dark Matter', favoriteGame: 'Zelda', socials: [{ platform: 'twitch', url: 'https://twitch.tv/otro' }, { platform: 'youtube', url: 'https://youtube.com/@g' }] }));
    const por = Object.fromEntries(v.cambios.map((c: { campo: string }) => [c.campo, c]));
    expect(por['Gusto · Serie favorita']).toMatchObject({ antes: 'Dark', despues: 'Dark Matter', nuevo: false });
    expect(por['Gusto · Videojuego favorito'] ?? por['Gusto · Juego favorito']).toMatchObject({ despues: 'Zelda', nuevo: true });
    expect(v.cambios.find((c: { campo: string }) => c.campo.startsWith('Red · Twitch'))).toMatchObject({ antes: 'https://twitch.tv/gkuro', despues: 'https://twitch.tv/otro' });
    expect(v.cambios.find((c: { campo: string }) => /Red · (YouTube|youtube)/.test(c.campo))).toMatchObject({ nuevo: true });
  });

  test('si no cambia nada lo dice (sigue siendo aprobable)', async () => {
    const v = vistaPrevia(db, await mod({ phrase: 'hola' }));
    expect(v.cambios).toEqual([]);
    expect(v.avisos.join(' ')).toMatch(/No cambia nada/);
  });

  test('avisa de que el avatar y el logo no se aplican solos', async () => {
    const v = vistaPrevia(db, await mod({ phrase: 'x', imageUrl: 'https://x.com/a.png' }));
    expect(v.avisos.join(' ')).toMatch(/Imágenes/);
    expect(v.imagenes).toEqual({ imageUrl: 'https://x.com/a.png' });
  });

  test('NO escribe nada: la ficha queda exactamente igual', async () => {
    const antes = JSON.stringify(db.prepare('SELECT * FROM vtuber WHERE slug = ?').get('gkuro'));
    vistaPrevia(db, await mod({ phrase: 'Otra frase muy distinta', height: '2 m', hashtag: '#nuevo' }));
    expect(JSON.stringify(db.prepare('SELECT * FROM vtuber WHERE slug = ?').get('gkuro'))).toBe(antes);
    expect((db.prepare('SELECT phrase FROM vtuber WHERE slug = ?').get('gkuro') as { phrase: string }).phrase).toBe('hola');
  });
});

describe('modificación: la ficha no se encuentra', () => {
  test('no se puede aprobar, explica por qué y ofrece candidatas', async () => {
    const v = vistaPrevia(db, await mod({ ficha: '#18 Gkuroo (typo)', phrase: 'x' }));
    expect(v.puedeAprobar).toBe(false);
    expect(v.problema.codigo).toBe('ficha_no_encontrada');
    expect(v.problema.mensaje).toContain('#18 Gkuroo (typo)');
    expect(Array.isArray(v.candidatas)).toBe(true);
  });

  test('con una ficha ELEGIDA a mano sí se puede, y el resto del cálculo usa esa ficha', async () => {
    const v = vistaPrevia(db, await mod({ ficha: 'nombre que no existe', phrase: 'Frase nueva' }), { fichaSlug: 'gkuro' });
    expect(v.puedeAprobar).toBe(true);
    expect(v.ficha.slug).toBe('gkuro');
    expect(v.cambios[0]).toMatchObject({ campo: 'Frase', despues: 'Frase nueva' });
  });

  test('una ficha elegida que no existe tampoco se aprueba', async () => {
    const v = vistaPrevia(db, await mod({ phrase: 'x' }), { fichaSlug: 'no-existe' });
    expect(v.puedeAprobar).toBe(false);
    expect(v.problema.codigo).toBe('ficha_no_encontrada');
  });

  test('candidatasParaReferencia encuentra por el nombre aunque venga con «#NNN»', () => {
    expect(candidatasParaReferencia(db, '#99 drawch').map((c: { slug: string }) => c.slug)).toContain('drawchii');
    expect(candidatasParaReferencia(db, '')).toEqual([]);
  });
});

describe('inscripción: ¿se puede crear?', () => {
  test('dice qué ficha nacería (en borrador) y con qué dirección', async () => {
    const v = vistaPrevia(db, await inscripcion());
    expect(v.puedeAprobar).toBe(true);
    expect(v.creara).toEqual({ name: 'Nueva Estrella', slug: 'nueva-estrella', estado: 'draft' });
  });

  test('NO crea nada: el catálogo queda con las mismas fichas', async () => {
    const antes = total();
    vistaPrevia(db, await inscripcion({ name: 'Otra Distinta' }));
    expect(total()).toBe(antes);
    expect(db.prepare("SELECT 1 FROM vtuber WHERE slug = 'otra-distinta'").get()).toBeUndefined();
  });

  test('avisa si ya existe una ficha con ese nombre (posible duplicado)', async () => {
    const v = vistaPrevia(db, await inscripcion({ name: 'gkuro' }));
    expect(v.avisos.join(' ')).toMatch(/Ya existe una ficha llamada «GKuro»/);
  });

  test('un país que no existe lo bloquea con un mensaje en español', async () => {
    const v = vistaPrevia(db, await inscripcion({ country: 'atlantida' }));
    expect(v.puedeAprobar).toBe(false);
    expect(v.problema.codigo).toBe('pais_desconocido');
    expect(v.problema.mensaje).toMatch(/país/i);
  });
});

describe('baja y solicitudes ya resueltas', () => {
  test('una baja muestra la ficha y recuerda que procesar no la degrada', async () => {
    const v = vistaPrevia(db, await baja());
    expect(v.ficha).toMatchObject({ slug: 'gkuro' });
    expect(v.avisos.join(' ')).toMatch(/solo cierra la solicitud/);
    expect(v.puedeAprobar).toBe(true);
  });

  test('una baja cuya ficha no se encuentra se puede cerrar igual, avisando', async () => {
    const v = vistaPrevia(db, await baja({ ficha: 'nadie conocido' }));
    expect(v.ficha).toBeNull();
    expect(v.puedeAprobar).toBe(true);
    expect(v.avisos.join(' ')).toMatch(/No se encontró la ficha/);
  });

  test('una solicitud que ya no está pendiente no se puede aprobar', async () => {
    const s = await baja();
    expect(vistaPrevia(db, { ...s, estado: 'procesada' }).puedeAprobar).toBe(false);
  });
});

describe('cambiosDeModificacion', () => {
  test('compara sin tildes ni mayúsculas: «Papá» y «papa» no son un cambio', () => {
    expect(cambiosDeModificacion({ phrase: 'Papá' }, { phrase: 'papa' })).toEqual([]);
  });
  test('listas: país e idiomas se comparan como texto legible', () => {
    const c = cambiosDeModificacion({ countries: [{ name: 'Chile' }], languages: ['es'] }, { countries: ['peru'], languages: ['es', 'en'] });
    expect(c.map((x: { campo: string }) => x.campo).sort()).toEqual(['Idiomas', 'País']);
  });
});
