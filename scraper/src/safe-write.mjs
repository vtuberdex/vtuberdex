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
  const raiz = path.resolve(base);
  const rel = path.relative(raiz, path.resolve(target));
  if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error(`ruta fuera de ${base}: ${target}`);
  }
  // El destino se reconstruye desde la ruta relativa ya validada (con su último tramo reducido a su
  // nombre base): nunca se escribe sobre la ruta original, que puede venir de la red.
  const destino = path.join(raiz, path.dirname(rel), path.basename(rel));
  await writeFile(destino, data);
}
