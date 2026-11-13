// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Escritura de ficheros del scraper CONFINADA a un directorio base.
 *
 * `writeInside(base, target, data)` resuelve las dos rutas y lanza si el destino, ya resuelto, cae
 * fuera de `base`: un slug con `..` o una ruta absoluta no pueden sacar lo descargado del árbol del
 * scraper. Es la guarda que permite que escribir lo que llega de la red sea seguro al bajar una
 * página (probado en `scraper/test/ocr-write.test.mjs`).
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";

/** Escribe solo dentro de `base`: rechaza rutas que, ya resueltas, salgan de él (p. ej. por un slug con `..`). */
export async function writeInside(base, target, data) {
  const rel = path.relative(path.resolve(base), path.resolve(target));
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`ruta fuera de ${base}: ${target}`);
  }
  await writeFile(target, data);
}
