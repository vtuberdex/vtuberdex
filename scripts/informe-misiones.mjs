#!/usr/bin/env node
/**
 * Cómo van las misiones de Minecraft: quién completó cada una y el avance de quienes van en camino. Es el dato para
 * ajustar las metas del catálogo (`server/src/misiones.mjs`) con evidencia. Solo lee.
 *
 *   npm run informe:misiones           tabla
 *   npm run informe:misiones -- --json
 */
import { ejecutorDeSolicitudes } from '../lib/solicitudes.mjs';
import { MISIONES, resumenDeMisiones } from '../server/src/misiones.mjs';

const filas = await resumenDeMisiones(await ejecutorDeSolicitudes());
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(filas, null, 2));
} else {
  const nombre = new Map(MISIONES.map((m) => [m.id, m.nombre]));
  console.log('misión'.padEnd(26), 'tipo'.padEnd(11), 'completaron'.padStart(11), 'veces'.padStart(6), 'en camino'.padStart(10), 'medio'.padStart(6), 'máx'.padStart(5));
  for (const f of filas)
    console.log(
      (nombre.get(f.id) ?? f.id).slice(0, 25).padEnd(26),
      f.tipo.padEnd(11),
      String(f.completaron).padStart(11),
      String(f.veces).padStart(6),
      String(f.enCamino).padStart(10),
      `${f.avanceMedio}%`.padStart(6),
      `${f.avanceMaximo}%`.padStart(5),
    );
}
