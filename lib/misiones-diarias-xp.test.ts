import { describe, expect, it } from 'vitest';

import { misionPorId } from '../server/src/misiones.mjs';

describe('misiones diarias: XP ligeramente mayor para dar incentivo a estar en el server', () => {
  it.each([
    ['cazador-del-dia', 25],
    ['minero-del-dia', 25],
    ['pescador-del-dia', 20],
    ['granjero-del-dia', 20],
  ])('%s otorga %i XP', (id, xp) => {
    expect(misionPorId(id)?.xp).toBe(xp);
  });
});
