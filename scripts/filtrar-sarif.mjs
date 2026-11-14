// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Uso: node scripts/filtrar-sarif.mjs <archivo.sarif>...
 * Reescribe cada SARIF sin los hallazgos que `sonar-project.properties` declara revisados.
 * La lógica y el porqué están en `scripts/lib/filtrar-sarif.mjs`. Un archivo que no existe se
 * salta (el job de Semgrep o CodeQL pudo no subir el suyo); uno ilegible hace fallar el paso.
 * Se lee directamente y se captura ENOENT, sin comprobar antes con existsSync: comprobar y
 * después leer es la carrera que CodeQL marca como js/file-system-race.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { exclusionesDeSonar, filtrarSarif } from './lib/filtrar-sarif.mjs';

function leerSiExiste(archivo) {
  try {
    return readFileSync(archivo, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

const exclusiones = exclusionesDeSonar(readFileSync('sonar-project.properties', 'utf8'));
for (const archivo of process.argv.slice(2)) {
  const texto = leerSiExiste(archivo);
  if (texto === null) {
    console.log(`${archivo}: no existe, se salta`);
    continue;
  }
  const { sarif, quitados } = filtrarSarif(JSON.parse(texto), exclusiones);
  writeFileSync(archivo, JSON.stringify(sarif));
  console.log(`${archivo}: ${quitados} hallazgo(s) revisado(s) quitado(s)`);
}
