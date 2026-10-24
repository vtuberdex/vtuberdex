#!/usr/bin/env node
/**
 * Calcula la EXP retroactiva del diario de cambios: crea en `exp_evento` los eventos que faltan
 * (+10 por cada vtuber.crear / editar / estado ya anotado). Es idempotente: repetirlo no suma de nuevo.
 *
 *   node scripts/exp-retroactiva.mjs                 actor "admin"
 *   node scripts/exp-retroactiva.mjs --actor nombre  otro actor
 *
 * Entorno: TURSO_DATABASE_URL y TURSO_AUTH_TOKEN (como el resto de scripts de producción).
 */
import { pathToFileURL } from "node:url";

import { asegurarTablas, tursoConfigurado, turso } from "../lib/ediciones.mjs";
import { expDePerfil, expRetroactiva } from "../server/src/exp-diario.mjs";

/** Ejecuta la retroactiva sobre un ejecutor `{ execute(sql, args) }` y devuelve el resumen. */
export async function lanzarRetroactiva(ejecutor, actor = "admin") {
  const cantidad = await expRetroactiva(ejecutor, actor);
  const total = await expDePerfil(ejecutor, actor);
  return { actor, eventos: cantidad / 10, expSumada: cantidad, expTotal: total };
}

async function main() {
  const i = process.argv.indexOf("--actor");
  const actor = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : "admin";
  if (!tursoConfigurado()) {
    console.error("[exp-retroactiva] falta TURSO_DATABASE_URL");
    process.exitCode = 1;
    return;
  }
  await asegurarTablas();
  const resumen = await lanzarRetroactiva(
    { execute: (sql, args = []) => turso().execute({ sql, args }) },
    actor,
  );
  console.log(`[exp-retroactiva] ${resumen.eventos} eventos creados (+${resumen.expSumada} EXP); ${actor} tiene ${resumen.expTotal} EXP`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(`[exp-retroactiva] falló: ${error.message}`);
    process.exitCode = 1;
  });
}
