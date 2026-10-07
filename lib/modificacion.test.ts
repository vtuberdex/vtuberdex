/**
 * Solicitudes de MODIFICACIÓN: el esquema (todo opcional salvo identificar la ficha, y al menos un
 * cambio) y el parche que sale al aprobar, aplicado de verdad con las reglas del mantenedor sobre una
 * base sembrada. Sin red: la cola es SQLite en memoria y el catálogo, una base temporal.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { openDatabase } from '@/server/src/db/index.mjs';
import { aplicarParche } from '@/server/src/mutations.mjs';
import { prepararModificacion } from '@/server/src/modificacion.mjs';
import { getVtuberBySlug } from '@/server/src/search.mjs';
import { seedDatabase } from '@/server/src/seed.mjs';
import {
  SolicitudError,
  TERMINOS_VERSION,
  confirmarSolicitud,
  crearSolicitud,
  ejecutorSqlite,
  leerSolicitud,
  listarSolicitudes,
  resolverSolicitud,
} from '@/server/src/solicitudes.mjs';
import { vtuberUpdateSchema } from '@/server/src/validation.mjs';

const DATASET = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: 'test',
  vtubers: [
    {
      dexNumber: 18,
      slug: 'gkuro',
      name: 'GKuro',
      countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
      languages: ['es'],
      groups: [],
      artists: ['Riko'],
      source: { hasDetail: true },
      assets: {},
      detail: {
        phrase: 'hola',
        profile: [{ label: 'Anime favorito', value: 'Naruto' }, { label: 'Serie favorita', value: 'Dark' }],
        factions: [],
        stats: {},
        skills: [],
        socials: [{ platform: 'Twitch', label: 'Twitch', url: 'https://twitch.tv/gkuro' }],
      },
    },
    { dexNumber: 30, slug: 'drawchii', name: 'Drawchii', countries: [], languages: ['es'], groups: [], artists: [], source: { hasDetail: false }, assets: {}, detail: null },
  ],
};

type FichaLeida = {
  name: string;
  cardText: string;
  birthday: string;
  themeColor: string;
  languages: string[];
  profile: Array<{ label: string; value: string }>;
  socials: Array<{ platform: string }>;
};

let dir: string;
let db: ReturnType<typeof openDatabase>;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vtuberdex-modificacion-'));
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

const pedido = (extra: Record<string, unknown> = {}) => ({
  ficha: '/v/gkuro',
  email: 'GKuro@Example.com',
  phrase: 'Frase nueva',
  aceptaTerminos: true,
  terminosVersion: TERMINOS_VERSION,
  ...extra,
});

const enviar = async (entrada: object, ip = '1.1.1.1') => {
  const { id } = await crearSolicitud(ejecutor, entrada, { tipo: 'modificacion', ip });
  await confirmarSolicitud(ejecutor, Number(id));
  return (await leerSolicitud(ejecutor, Number(id)))!;
};

async function rechazo(promesa: Promise<unknown>): Promise<SolicitudError> {
  try {
    await promesa;
  } catch (error) {
    return error as SolicitudError;
  }
  throw new Error('debía rechazarse');
}

describe('la solicitud de modificación', () => {
  test('queda pendiente, con el correo en el contacto y solo lo pedido en los datos', async () => {
    const solicitud = await enviar(pedido());
    expect(solicitud.estado).toBe('pendiente');
    expect(solicitud.contacto).toEqual({ email: 'gkuro@example.com' });
    expect(JSON.stringify(solicitud.datos)).not.toContain('example.com');
    expect(solicitud.datos.phrase).toBe('Frase nueva');
  });

  test('no pide nada de lo que ya se sabe: basta identificar la ficha y un cambio', async () => {
    await expect(enviar(pedido({ phrase: '', height: '1,70 m' }))).resolves.toMatchObject({ estado: 'pendiente' });
  });

  test.each([
    ['sin ningún cambio', { phrase: '' }],
    ['sin ficha', { ficha: '  ' }],
    ['con correo inválido', { email: 'no-es-correo' }],
    ['con una imagen que no es URL http(s)', { imageUrl: 'javascript:alert(1)' }],
  ])('se rechaza %s', async (_nombre, extra) => {
    expect((await rechazo(enviar(pedido(extra)))).status).toBe(400);
  });

  test('exige los términos y su versión vigente', async () => {
    expect((await rechazo(enviar(pedido({ aceptaTerminos: false })))).status).toBe(400);
    expect((await rechazo(enviar(pedido({ terminosVersion: '2020-01-01' })))).code).toBe('terminos_desactualizados');
  });

  test('un solo pendiente por correo, y la cuenta de la cola la separa de las demás', async () => {
    await enviar(pedido());
    expect((await rechazo(enviar(pedido()))).code).toBe('solicitud_pendiente');
    expect((await listarSolicitudes(ejecutor)).pendientes).toEqual({ inscripcion: 0, baja: 0, modificacion: 1 });
  });

  test('aprobar conserva el contacto y rechazar lo borra', async () => {
    const a = await enviar(pedido());
    expect((await resolverSolicitud(ejecutor, a.id, { estado: 'aprobada' }))?.contacto).not.toBeNull();
    const b = await enviar(pedido({ email: 'otra@example.com' }));
    expect((await resolverSolicitud(ejecutor, b.id, { estado: 'rechazada' }))?.contacto).toBeNull();
    expect((await rechazo(resolverSolicitud(ejecutor, (await enviar(pedido({ email: 'c@example.com' }))).id, { estado: 'procesada' }))).status).toBe(400);
  });
});

describe('prepararModificacion', () => {
  // Un correo distinto por solicitud: la cola admite una sola pendiente por correo y tipo.
  let n = 0;
  const parche = async (extra: Record<string, unknown>) =>
    prepararModificacion(db, await enviar(pedido({ phrase: '', email: `usuario${(n += 1)}@example.com`, ...extra })));

  test('encuentra la ficha por /v/slug, por slug, por nombre y por URL completa', async () => {
    for (const ficha of ['/v/gkuro', 'gkuro', 'GKuro', 'https://vtuberdex.com/v/gkuro?x=1']) {
      ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
      const { slug } = await parche({ ficha, height: '1,70 m' });
      expect(slug).toBe('gkuro');
    }
  });

  test('encuentra la ficha tal como se ve en el catálogo: «#NNN NOMBRE» (el formato que la gente escribe)', async () => {
    const { dex_number: dex } = db.prepare("SELECT dex_number FROM vtuber WHERE slug = 'gkuro'").get() as { dex_number: number };
    for (const ficha of [`#${dex} GKuro`, `#${dex} GKURO`, `# ${dex} gkuro`, `GKuro #${dex}`, `#${dex}`, `  #${dex}  `]) {
      ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
      const { slug } = await parche({ ficha, height: '1,70 m' });
      expect(slug, ficha).toBe('gkuro');
    }
  });

  test('el nombre sin tildes ni mayúsculas coincide aunque el catálogo las lleve (CEJ PAPA LUCHON ↔ CEJ Papá Luchón)', async () => {
    db.prepare("UPDATE vtuber SET name = 'GKuro Papá', search_name = 'gkuro papa' WHERE slug = 'gkuro'").run();
    const { dex_number: dex } = db.prepare("SELECT dex_number FROM vtuber WHERE slug = 'gkuro'").get() as { dex_number: number };
    ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
    expect((await parche({ ficha: `#${dex} GKURO PAPA`, height: '1' })).slug).toBe('gkuro');
    db.prepare("UPDATE vtuber SET name = 'GKuro', search_name = 'gkuro' WHERE slug = 'gkuro'").run();
  });

  test('un número de dex que no existe, o un nombre que NO coincide con ese dex, no se adivina', async () => {
    const { dex_number: dex } = db.prepare("SELECT dex_number FROM vtuber WHERE slug = 'gkuro'").get() as { dex_number: number };
    for (const ficha of ['#9999', `#${dex} otra persona distinta`, '#abc', '#']) {
      ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
      const error = await rechazo(Promise.resolve().then(async () => parche({ ficha, height: '1' })));
      expect(error.code, ficha).toBe('ficha_no_encontrada');
    }
  });

  test('con dos fichas del mismo nombre, el número de dex decide cuál', async () => {
    db.prepare("INSERT INTO vtuber (id, dex_number, slug, name, search_name, status) VALUES (777777, 77, 'gkuro-2', 'GKuro', 'gkuro', 'published')").run();
    try {
      ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
      expect((await parche({ ficha: '#77 GKuro', height: '1' })).slug).toBe('gkuro-2');
      // Sin número, un slug exacto sigue ganando (comportamiento de siempre): el número solo desempata.
      ejecutor = ejecutorSqlite(new DatabaseSync(':memory:'));
      expect((await parche({ ficha: 'GKuro', height: '1' })).slug).toBe('gkuro');
    } finally {
      db.prepare('DELETE FROM vtuber WHERE id = 777777').run();
    }
  });

  test('una ficha que no existe no se adivina', async () => {
    const error = await rechazo(Promise.resolve().then(async () => parche({ ficha: '/v/nadie', height: '1' })));
    expect(error.code).toBe('ficha_no_encontrada');
  });

  test('solo lleva los campos que vinieron con valor', async () => {
    const { patch } = await parche({ height: '1,70 m', hashtag: '#Gkuro' });
    expect(patch).toEqual({ height: '1,70 m', hashtag: '#Gkuro' });
  });

  test('los gustos actualizan su fila y conservan las demás; las redes se suman', async () => {
    const { patch } = await parche({
      favoriteAnime: 'Frieren',
      favoriteGame: 'Zelda',
      socials: [{ platform: 'twitch', url: 'https://twitch.tv/nuevo' }, { platform: 'YouTube', url: 'https://youtube.com/@gkuro' }],
    });
    expect(patch.profile).toEqual([
      { label: 'Anime favorito', value: 'Frieren' },
      { label: 'Serie favorita', value: 'Dark' },
      { label: 'Videojuego favorito', value: 'Zelda' },
    ]);
    expect(patch.socials).toHaveLength(2);
    expect(patch.socials?.[0]).toMatchObject({ platform: 'Twitch', url: 'https://twitch.tv/nuevo' });
  });

  test('el modelador pasa al frente sin quitar a quien ya figuraba', async () => {
    const { patch } = await parche({ modeler: 'Nuevo Artista' });
    expect(patch.artists).toEqual(['Nuevo Artista', 'Riko']);
    const igual = await parche({ modeler: 'riko' });
    expect(igual.patch.artists).toBeUndefined();
  });

  test('avatar y logo no entran al parche: van aparte, para subirlos a mano', async () => {
    const { patch, imagenes } = await parche({ imageUrl: 'https://x.test/a.png', logoUrl: 'https://x.test/l.png' });
    expect(patch).toEqual({});
    expect(imagenes).toEqual({ imageUrl: 'https://x.test/a.png', logoUrl: 'https://x.test/l.png' });
  });

  test('el parche pasa el esquema de edición y, aplicado, deja la ficha como se pidió', async () => {
    const preparado = await parche({
      country: 'chile',
      languages: ['es', 'en'],
      cardText: 'Una historia nueva',
      themeColor: '#112233',
      birthday: '1 de enero',
      favoriteAnime: 'Frieren',
      socials: [{ platform: 'YouTube', url: 'https://youtube.com/@gkuro' }],
    });
    const valido = vtuberUpdateSchema.safeParse(preparado.patch);
    expect(valido.success).toBe(true);
    aplicarParche(db, preparado.id, valido.data!);
    const ficha = getVtuberBySlug(db, 'gkuro', { includeHidden: true }) as unknown as FichaLeida;
    expect(ficha).toMatchObject({ cardText: 'Una historia nueva', birthday: '1 de enero', themeColor: '#112233' });
    expect([...ficha.languages].sort()).toEqual(['en', 'es']);
    expect(ficha.profile.find((f) => f.label === 'Anime favorito')?.value).toBe('Frieren');
    expect(ficha.socials.map((r) => r.platform)).toEqual(['Twitch', 'YouTube']);
    expect(ficha.name).toBe('GKuro');
  });
});
