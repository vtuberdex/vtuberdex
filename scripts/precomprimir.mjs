// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Deja junto a cada asset estático su versión `.br` (Brotli 11) y `.gz` (gzip 9) para que nginx las
 * sirva tal cual (`brotli_static` / `gzip_static`, ver `infra/nginx/vtuberdex-locations.conf`).
 *
 * POR QUÉ PRECOMPRIMIR: medido sobre el chunk de three (931 KB), Brotli 11 lo deja en 201 KB frente a
 * 247 de gzip (-19 %), pero tarda 2,8 s: imposible al vuelo en cada petición (al vuelo, Brotli 5 da
 * 228 KB). Los chunks de `/_next/static` son inmutables (el nombre lleva el hash), así que se
 * comprimen UNA vez en el release y nginx no gasta CPU al servirlos.
 *
 *   node scripts/precomprimir.mjs <carpeta>
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

/** Lo que vale la pena comprimir (las imágenes y fuentes ya van comprimidas). */
export const EXTENSIONES = new Set([
  ".js",
  ".css",
  ".json",
  ".svg",
  ".txt",
  ".html",
  ".map",
]);
/** Por debajo de esto la cabecera de compresión cuesta más de lo que ahorra (igual que `brotli_min_length`). */
export const MINIMO_BYTES = 512;
const EN_PARALELO = 4;

async function* archivos(carpeta) {
  for (const entrada of await readdir(carpeta, { withFileTypes: true })) {
    const ruta = path.join(carpeta, entrada.name);
    if (entrada.isDirectory()) {
      yield* archivos(ruta);
    } else if (EXTENSIONES.has(path.extname(entrada.name))) {
      yield ruta;
    }
  }
}

export async function precomprimir(carpeta) {
  const pendientes = [];
  for await (const ruta of archivos(carpeta)) {
    pendientes.push(ruta);
  }
  const total = { archivos: 0, original: 0, br: 0, gz: 0 };
  const trabajar = async () => {
    for (let ruta = pendientes.pop(); ruta; ruta = pendientes.pop()) {
      const datos = await readFile(ruta);
      if (datos.length < MINIMO_BYTES) {
        continue;
      }
      const [br, gz] = await Promise.all([
        brotli(datos, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: datos.length,
          },
        }),
        gzip(datos, { level: 9 }),
      ]);
      await Promise.all([
        writeFile(`${ruta}.br`, br),
        writeFile(`${ruta}.gz`, gz),
      ]);
      total.archivos += 1;
      total.original += datos.length;
      total.br += br.length;
      total.gz += gz.length;
    }
  };
  await Promise.all(Array.from({ length: EN_PARALELO }, trabajar));
  return total;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const carpeta = process.argv[2];
  if (!carpeta) {
    throw new Error("uso: node scripts/precomprimir.mjs <carpeta>");
  }
  const t = await precomprimir(carpeta);
  const kb = (n) => `${Math.round(n / 1024)} KB`;
  console.log(
    `→ precomprimidos ${t.archivos} archivos: ${kb(t.original)} -> br ${kb(t.br)} / gz ${kb(t.gz)}`,
  );
}
