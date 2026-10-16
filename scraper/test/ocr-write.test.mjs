/**
 * Comprueba que el path de escritura de los crudos del OCR (ocr.mjs) queda
 * contenido dentro del directorio de salida aunque el slug traiga `..`.
 *
 * ocr.mjs escribe con `writeInside(RAW_DIR, path.join(RAW_DIR, `${rawName}.png`), image)`
 * donde `rawName = slugify(card.slug)`. Este test reproduce ese path con un slug
 * de path traversal ('../../evil') y verifica que el fichero no sale de RAW_DIR.
 *
 * Corre con `node --test` (como el resto del scraper): NO importar `vitest` aquí.
 * Un test con `vitest` dentro de `node --test` rompe el CI entero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { slugify } from '../src/normalize.mjs';
import { writeInside } from '../src/safe-write.mjs';

test('escritura de crudos del OCR: un slug con path traversal no saca el fichero del directorio de salida', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ocr-raw-'));
  try {
    const rawName = slugify('../../evil') || 'v1';
    const target = path.join(base, `${rawName}.png`);

    await writeInside(base, target, Buffer.from('png'));

    const entries = await readdir(base);
    assert.deepEqual(entries, [`${rawName}.png`]);
    const rel = path.relative(path.resolve(base), path.resolve(target));
    assert.equal(rel.startsWith('..'), false);
    assert.equal(path.isAbsolute(rel), false);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('writeInside rechaza un destino que sale del directorio', async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'ocr-raw-'));
  try {
    await assert.rejects(
      writeInside(base, path.join(base, '..', 'evil.png'), Buffer.from('x')),
      /fuera de/,
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
