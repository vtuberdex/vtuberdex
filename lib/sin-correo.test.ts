import { describe, expect, it } from 'vitest';
import { gradoDeDibujo } from '@/lib/premium';

describe('gradoDeDibujo', () => {
  it('una ficha sin correo y sin premium se dibuja en grado 4', () => {
    expect(gradoDeDibujo({ premium: null, sinCorreo: true })).toBe('4');
  });
  it('una premium conserva su grado aunque no tenga correo', () => {
    expect(gradoDeDibujo({ premium: { grade: '9' }, sinCorreo: true })).toBe('9');
  });
  it('una ficha con correo no se degrada', () => {
    expect(gradoDeDibujo({ premium: null })).toBeUndefined();
  });
});
