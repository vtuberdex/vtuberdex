import path from "node:path";
import { writeFile } from "node:fs/promises";

/** Escribe solo dentro de `base`: rechaza rutas que, ya resueltas, salgan de él (p. ej. por un slug con `..`). */
export async function writeInside(base, target, data) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`ruta fuera de ${base}: ${target}`);
  }
  // codeql[js/http-to-file-access] -- falso positivo: escribir lo descargado es el propósito del scraper y la ruta ya se validó contra `base` arriba.
  await writeFile(target, data);
}
