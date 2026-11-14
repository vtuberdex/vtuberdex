import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exclusionesDeSonar, filtrarSarif } from '../scripts/lib/filtrar-sarif.mjs';

const resultado = (ruleId: string, uri: string) => ({
  ruleId,
  locations: [{ physicalLocation: { artifactLocation: { uri, uriBaseId: '%SRCROOT%' } } }],
});

describe('filtrarSarif', () => {
  it('lee las exclusiones reales de sonar-project.properties', () => {
    const exclusiones = exclusionesDeSonar(readFileSync('sonar-project.properties', 'utf8'));
    expect(exclusiones).toContainEqual({
      ruleKey: 'external_CodeQL:js/http-to-file-access',
      resourceKey: 'scraper/src/safe-write.mjs',
    });
  });

  it('quita solo la pareja regla + archivo excluida', () => {
    const sarif = {
      runs: [
        {
          tool: { driver: { name: 'CodeQL' } },
          results: [
            resultado('js/http-to-file-access', 'scraper/src/safe-write.mjs'),
            resultado('js/http-to-file-access', 'lib/otro.mjs'),
            resultado('js/sql-injection', './scraper/src/safe-write.mjs'),
          ],
        },
      ],
    };
    const exclusiones = [
      { ruleKey: 'external_CodeQL:js/http-to-file-access', resourceKey: 'scraper/src/safe-write.mjs' },
    ];
    const { sarif: limpio, quitados } = filtrarSarif(sarif, exclusiones);
    expect(quitados).toBe(1);
    expect(limpio.runs[0].results.map((r: { ruleId: string }) => r.ruleId)).toEqual([
      'js/http-to-file-access',
      'js/sql-injection',
    ]);
  });

  it('no aplica una exclusión de CodeQL a otra herramienta', () => {
    const sarif = {
      runs: [{ tool: { driver: { name: 'Semgrep OSS' } }, results: [resultado('js/http-to-file-access', 'scraper/src/safe-write.mjs')] }],
    };
    const exclusiones = [
      { ruleKey: 'external_CodeQL:js/http-to-file-access', resourceKey: 'scraper/src/safe-write.mjs' },
    ];
    expect(filtrarSarif(sarif, exclusiones).quitados).toBe(0);
  });
});
