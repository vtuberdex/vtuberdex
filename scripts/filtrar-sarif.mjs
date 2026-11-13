/**
 * Uso: node scripts/filtrar-sarif.mjs <archivo.sarif>...
 * Reescribe cada SARIF sin los hallazgos que `sonar-project.properties` declara revisados.
 * La lógica y el porqué están en `scripts/lib/filtrar-sarif.mjs`. Un archivo que no existe se
 * salta (el job de Semgrep o CodeQL pudo no subir el suyo); uno ilegible hace fallar el paso.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { exclusionesDeSonar, filtrarSarif } from './lib/filtrar-sarif.mjs';

const exclusiones = exclusionesDeSonar(readFileSync('sonar-project.properties', 'utf8'));
for (const archivo of process.argv.slice(2)) {
  if (!existsSync(archivo)) {
    console.log(`${archivo}: no existe, se salta`);
    continue;
  }
  const { sarif, quitados } = filtrarSarif(JSON.parse(readFileSync(archivo, 'utf8')), exclusiones);
  writeFileSync(archivo, JSON.stringify(sarif));
  console.log(`${archivo}: ${quitados} hallazgo(s) revisado(s) quitado(s)`);
}
