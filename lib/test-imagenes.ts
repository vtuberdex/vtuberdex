/**
 * Ayudas de PRUEBA para las imágenes de las solicitudes: un WebP mínimo pero bien formado y una función
 * que sube de verdad (`guardarImagen`) las imágenes que un formulario de prueba marca con `SUBIR`.
 */
import {
  guardarImagen,
  LIMITES,
} from "../server/src/imagenes-solicitud.mjs";

/** Marca en un campo `imageId`/`logoId` de un formulario de prueba: «sube una imagen válida y pon aquí su id». */
export const SUBIR = "__subir__";

/** Un trozo RIFF `tipo` con `datos` (relleno a par incluido). */
export function trozo(tipo: string, datos: Buffer): Buffer {
  const cabecera = Buffer.alloc(8);
  cabecera.write(tipo, 0, "ascii");
  cabecera.writeUInt32LE(datos.length, 4);
  return Buffer.concat([
    cabecera,
    datos,
    ...(datos.length % 2 ? [Buffer.alloc(1)] : []),
  ]);
}

/** Envuelve trozos en un contenedor RIFF/WEBP con el tamaño declarado correcto. */
export function riff(...trozos: Buffer[]): Buffer {
  const cuerpo = Buffer.concat(trozos);
  const cabecera = Buffer.alloc(12);
  cabecera.write("RIFF", 0, "ascii");
  cabecera.writeUInt32LE(cuerpo.length + 4, 4);
  cabecera.write("WEBP", 8, "ascii");
  return Buffer.concat([cabecera, cuerpo]);
}

/** Un WebP sin pérdida (`VP8L`) de `ancho`x`alto`: lo justo para que pase la validación del contenedor. */
export function webp(ancho: number, alto: number): Buffer {
  const datos = Buffer.alloc(12);
  datos[0] = 0x2f;
  datos.writeUInt32LE(((ancho - 1) & 0x3fff) | (((alto - 1) & 0x3fff) << 14), 1);
  return riff(trozo("VP8L", datos));
}

/** Un WebP extendido (`VP8X`) con las banderas dadas, seguido de un `VP8L`. */
export function webpExtendido(
  ancho: number,
  alto: number,
  banderas: number,
): Buffer {
  const x = Buffer.alloc(10);
  x[0] = banderas;
  x.writeUIntLE(ancho - 1, 4, 3);
  x.writeUIntLE(alto - 1, 7, 3);
  const l = Buffer.alloc(12);
  l[0] = 0x2f;
  l.writeUInt32LE(((ancho - 1) & 0x3fff) | (((alto - 1) & 0x3fff) << 14), 1);
  return riff(trozo("VP8X", x), trozo("VP8L", l));
}

/** El WebP con las medidas que pide cada tipo. */
export const webpDeTipo = (tipo: "character" | "logo") =>
  tipo === "character"
    ? webp(LIMITES.character.ancho, LIMITES.character.alto)
    : webp(400, 300);

let n = 0;

/**
 * Devuelve el formulario con las imágenes marcadas `SUBIR` ya subidas por su correo. Cada subida sale de una
 * red distinta para no chocar con el tope por red de una prueba larga.
 */
export async function conImagenes<T extends Record<string, unknown>>(
  ejecutor: unknown,
  entrada: T,
  formulario: "inscripcion" | "modificacion" = "inscripcion",
  /** De quién son las imágenes: por defecto el correo del formulario (en los envíos con credencial, el de la credencial). */
  correo: string = String(entrada.email),
): Promise<T> {
  const salida: Record<string, unknown> = { ...entrada };
  for (const [campo, tipo] of [
    ["imageId", "character"],
    ["logoId", "logo"],
  ] as const) {
    if (salida[campo] !== SUBIR) continue;
    n += 1;
    const { id } = await guardarImagen(ejecutor as never, {
      correo,
      tipo,
      formulario,
      bytes: webpDeTipo(tipo),
      ip: `10.${(n >> 8) & 255}.${n & 255}.1`,
    });
    salida[campo] = id;
    // Una prueba larga envía muchos formularios con el mismo correo: se reinician los contadores de cupo
    // (el tope en sí lo prueba `imagenes-solicitud.test.ts`).
    await (ejecutor as { execute: (sql: string) => Promise<unknown> }).execute(
      "DELETE FROM imagen_envio",
    );
  }
  return salida as T;
}
