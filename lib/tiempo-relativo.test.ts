import { describe, expect, it } from 'vitest';

import { haceCuanto } from './tiempo-relativo';

const AHORA = Date.UTC(2026, 9, 6, 12, 0, 0);
const antes = (ms: number) => new Date(AHORA - ms).toISOString();

describe('haceCuanto', () => {
  it('lo muy reciente es «hace un momento»', () => expect(haceCuanto(antes(10_000), AHORA)).toBe('hace un momento'));
  it('minutos', () => expect(haceCuanto(antes(5 * 60_000), AHORA)).toBe('hace 5 min'));
  it('horas', () => expect(haceCuanto(antes(3 * 3600_000), AHORA)).toBe('hace 3 h'));
  it('días, con singular', () => {
    expect(haceCuanto(antes(24 * 3600_000), AHORA)).toBe('hace 1 día');
    expect(haceCuanto(antes(3 * 24 * 3600_000), AHORA)).toBe('hace 3 días');
  });
  it('pasada una semana da la fecha', () => expect(haceCuanto(antes(40 * 24 * 3600_000), AHORA)).toMatch(/^el .*2026$/));
  it('una fecha ilegible no rompe nada y un futuro cercano no da negativos', () => {
    expect(haceCuanto('no es fecha', AHORA)).toBe('');
    expect(haceCuanto(antes(-5000), AHORA)).toBe('hace un momento');
  });
});
