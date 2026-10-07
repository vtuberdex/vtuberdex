import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GET } from '../app/voces/[slug]/route.js';

let carpeta = '';
const CLIP = Buffer.from('0123456789abcdefghij'); // 20 bytes: basta para probar rangos

const pedir = (slug: string, rango?: string) =>
  GET(new Request(`http://x/voces/${slug}`, rango ? { headers: { range: rango } } : undefined), {
    params: Promise.resolve({ slug }),
  }) as Promise<Response>;

beforeAll(() => {
  carpeta = mkdtempSync(path.join(tmpdir(), 'voces-'));
  writeFileSync(path.join(carpeta, 'madkoding.mp3'), CLIP);
  process.env.VTUBERDEX_VOCES_DIR = carpeta;
});
afterAll(() => {
  delete process.env.VTUBERDEX_VOCES_DIR;
  rmSync(carpeta, { recursive: true, force: true });
});

describe('GET /voces/:slug', () => {
  it('sirve el clip con su tipo y anuncia que acepta rangos', async () => {
    const r = await pedir('madkoding.mp3');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('audio/mpeg');
    expect(r.headers.get('accept-ranges')).toBe('bytes');
    expect(Buffer.from(await r.arrayBuffer()).equals(CLIP)).toBe(true);
  });

  it('contesta 206 a un rango (Safari lo exige) y 416 a uno imposible', async () => {
    const r = await pedir('madkoding.mp3', 'bytes=2-5');
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 2-5/20');
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe('2345');
    expect((await pedir('madkoding.mp3', 'bytes=50-60')).status).toBe(416);
  });

  it('una ficha sin clip da 404', async () => {
    expect((await pedir('otra-ficha.mp3')).status).toBe(404);
  });

  it('rechaza slugs que intentan salir de la carpeta', async () => {
    for (const malo of ['..%2Fsecreto', '../secreto', 'a/b', 'A-MAYUS', '']) {
      expect((await pedir(malo)).status).toBe(404);
    }
  });
});
