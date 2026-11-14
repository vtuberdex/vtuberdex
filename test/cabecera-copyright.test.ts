// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Todo archivo fuente que analiza Sonar empieza con la línea de copyright (tras el shebang, si lo
 * hay). La exige el perfil de Sonar (S1451, regex `^(#!.*\n)?// Copyright \(c\) \d{4} .+`) y sin
 * esta prueba un archivo nuevo la olvidaría sin que ningún gate lo viera hasta el análisis.
 * Las carpetas son las de `sonar.sources`; los tests quedan fuera, como en `sonar.exclusions`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CARPETAS = ['app', 'components', 'lib', 'server/src', 'scraper/src', 'scripts'];
const CABECERA = /^(#!.*\n)?\/\/ Copyright \(c\) \d{4} .+/;

function fuentes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) {
      return e.name === 'node_modules' ? [] : fuentes(ruta);
    }
    return /\.(m?js|jsx|tsx?)$/.test(e.name) && !e.name.includes('.test.') ? [ruta] : [];
  });
}

describe('cabecera de copyright', () => {
  it('la llevan todos los archivos fuente', () => {
    const sinCabecera = CARPETAS.flatMap(fuentes).filter((f) => !CABECERA.test(readFileSync(f, 'utf8')));
    expect(sinCabecera).toEqual([]);
  });
});
