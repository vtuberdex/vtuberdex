/**
 * Escritura de ficheros del scraper CONFINADA a un directorio base.
 *
 * `writeInside(base, target, data)` no escribe nunca en la ruta recibida: la reduce a una ruta
 * relativa dentro de `base`, comprueba que no tenga `..` y vuelve a componer el destino desde la
 * raíz validando cada tramo contra una lista blanca (letras, dígitos, punto, guion y guion bajo).
 * Un slug con `..`, una ruta absoluta de fuera o un nombre con separadores o espacios se rechazan.
 * Es la guarda que permite que escribir lo que llega de la red sea seguro al bajar una página
 * (probado en `scraper/test/safe-write.test.mjs`).
 */
import path from "node:path";
import { writeFile } from "node:fs/promises";

/** Tramos aceptados: un nombre simple, sin separadores, sin unidades y sin comodines. */
const TRAMO_PERMITIDO = /^[A-Za-z0-9._-]+$/;

/** Devuelve el tramo si es un nombre simple y seguro; si no, lanza. */
function tramoValido(tramo) {
  if (tramo === "." || tramo === ".." || !TRAMO_PERMITIDO.test(tramo)) {
    throw new Error(`nombre no permitido: ${tramo}`);
  }
  return tramo;
}

/**
 * Escribe solo dentro de `base`: la ruta se valida tramo a tramo y se vuelve a componer desde la
 * raíz, de modo que el fichero escrito no es la ruta recibida tal cual.
 */
export async function writeInside(base, target, data) {
  const raiz = path.resolve(base);
  const rel = path.relative(raiz, path.resolve(target));
  const tramos = rel.split(path.sep);
  if (!rel || path.isAbsolute(rel) || tramos.some((tramo) => tramo === "..")) {
    throw new Error(`ruta fuera de ${base}: ${target}`);
  }
  const destino = path.join(raiz, ...tramos.map(tramoValido));
  await writeFile(destino, data);
}
