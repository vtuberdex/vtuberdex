// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Utilidades de imagen que corren EN EL NAVEGADOR, compartidas por el gestor de
 * imágenes de las fichas y por el mantenedor de emblemas de facción.
 *
 * POR QUÉ EL CLIENTE CONVIERTE Y NO SOLO EL SERVIDOR
 * --------------------------------------------------
 * El Express local re-escala con `sharp`, pero en PRODUCCIÓN no hay `sharp` (es un
 * binario nativo que no viaja a la función) y la subida solo valida la firma del
 * formato. Convertir aquí deja el mismo resultado en los dos backends. Si el navegador
 * no puede (sin canvas ni `createImageBitmap`) se devuelve el original y decide el
 * servidor: una capacidad del cliente no debe bloquear la subida.
 */

/** Decodifica un archivo a bitmap, o `null` si el navegador no sabe (o el archivo no es una imagen). */
export async function cargarBitmap(file: Blob): Promise<ImageBitmap | null> {
  // Se comprueba ANTES de llamarla: en navegadores antiguos invocarla lanzaría un
  // TypeError síncrono y el `.catch()` no llegaría a engancharse.
  if (typeof createImageBitmap !== "function") {
    return null;
  }
  return createImageBitmap(file).catch(() => null);
}

export function canvasABlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Tope de peso que acepta el servidor de producción para un emblema. */
export const EMBLEMA_MAX_BYTES = 2 * 1024 * 1024;
/**
 * Lado máximo del emblema. Se dibuja a 88 px de una textura de 1008 (~120 px en la ficha con pantalla densa):
 * con 512 cada emblema pesaba ~180 KB y una página del libro bajaba 3,6 MB solo de emblemas (medido
 * 2026-11-19). 256 sobra; los ya guardados se redujeron con `scripts/reducir-imagenes.mjs`.
 */
export const EMBLEMA_MAX_LADO = 256;
/** Lado máximo del logo: el ancho de la textura de la carta (se subían logos de hasta 10.799 px). */
export const LOGO_MAX_LADO = 1008;
/**
 * Calidad WebP del arte (personaje, fondo, logo). Era 0,92: a 0,84 el personaje pesa ~36 % menos y,
 * comparado ampliado al doble, no se distingue (ver `scripts/reducir-imagenes.mjs`).
 */
export const CALIDAD_WEBP = 0.84;

/**
 * Convierte lo elegido a un PNG CUADRADO de hasta `EMBLEMA_MAX_LADO` px, con transparencia.
 *
 * Cuadrado porque el engarce de la carta lo es: un emblema apaisado se vería
 * descentrado. Se CENTRA sobre un lienzo transparente (no se recorta) para no
 * perder parte del trazo, y no se agranda nunca lo que ya es pequeño.
 * Lanza un error legible si el resultado supera el límite del servidor.
 */
export async function aPngCuadrado(
  file: Blob,
  maxLado = EMBLEMA_MAX_LADO,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return file;
  }
  const bitmap = await cargarBitmap(file);
  if (!bitmap) {
    return file;
  }

  const lado = Math.min(maxLado, Math.max(bitmap.width, bitmap.height));
  const escala = Math.min(lado / bitmap.width, lado / bitmap.height, 1);
  const dw = Math.round(bitmap.width * escala);
  const dh = Math.round(bitmap.height * escala);
  canvas.width = lado;
  canvas.height = lado;
  ctx.drawImage(
    bitmap,
    Math.round((lado - dw) / 2),
    Math.round((lado - dh) / 2),
    dw,
    dh,
  );
  bitmap.close?.();

  const png = (await canvasABlob(canvas, "image/png")) ?? file;
  if (png.size > EMBLEMA_MAX_BYTES) {
    throw new Error(
      "El emblema pesa más de 2 MB incluso reducido. Prueba con una imagen más simple.",
    );
  }
  return png;
}

/* ------------------------------------------------------------------------------------------------
 * Imágenes de los formularios públicos (inscripción y modificación).
 *
 * El servidor de producción no tiene `sharp` y solo ACEPTA un WebP del tamaño exacto (ver
 * `server/src/imagenes-solicitud.mjs`), así que es aquí donde el archivo de la persona se decodifica y
 * se reexporta: lo que sube NO es su archivo, sino una imagen nueva y sin metadatos (sin EXIF ni
 * ubicación). Las medidas y el límite de peso son los mismos del servidor.
 * ---------------------------------------------------------------------------------------------- */

export type TipoImagenSolicitud = "character" | "logo";

/** Lo mismo que `LIMITES` del servidor. */
export const IMAGEN_SOLICITUD = {
  /** Peso máximo del archivo que elige la persona. */
  entradaMaxBytes: 15 * 1024 * 1024,
  /** Peso máximo del WebP resultante (nginx corta en 1 MB). */
  salidaMaxBytes: 900 * 1024,
  character: { ancho: 720, alto: 1008, minLado: 300 },
  logo: { maxLado: 900, minLado: 64 },
} as const;

/** Código del error: la interfaz lo traduce a un texto (`img.error.*`). */
export type CodigoDeErrorDeImagen =
  "tipo" | "peso" | "chica" | "grande" | "navegador";

export class ErrorDeImagen extends Error {
  constructor(readonly codigo: CodigoDeErrorDeImagen) {
    super(codigo);
    this.name = "ErrorDeImagen";
  }
}

/** Dibuja el bitmap en el lienzo con el encuadre de su tipo (ver `normalizarImagenDeSolicitud`). */
function encuadrar(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  tipo: TipoImagenSolicitud,
): void {
  if (tipo === "character") {
    const { ancho, alto } = IMAGEN_SOLICITUD.character;
    canvas.width = ancho;
    canvas.height = alto;
    const escala = Math.max(ancho / bitmap.width, alto / bitmap.height);
    const dw = bitmap.width * escala;
    const dh = bitmap.height * escala;
    ctx.drawImage(bitmap, (ancho - dw) / 2, 0, dw, dh);
  } else {
    const escala = Math.min(
      1,
      IMAGEN_SOLICITUD.logo.maxLado / Math.max(bitmap.width, bitmap.height),
    );
    canvas.width = Math.max(1, Math.round(bitmap.width * escala));
    canvas.height = Math.max(1, Math.round(bitmap.height * escala));
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  }
}

/**
 * Convierte lo elegido a un WebP del tamaño del tipo. El personaje se encuadra como lo hace el mantenedor
 * (`cover` anclado arriba, 720x1008); el logo conserva su proporción, topado a 900 px por lado y con
 * transparencia. Baja la calidad por pasos hasta que cabe en el peso máximo.
 */
export async function normalizarImagenDeSolicitud(
  file: File,
  tipo: TipoImagenSolicitud,
): Promise<Blob> {
  if (file.size > IMAGEN_SOLICITUD.entradaMaxBytes) {
    throw new ErrorDeImagen("peso");
  }
  if (!file.type.startsWith("image/")) {
    throw new ErrorDeImagen("tipo");
  }
  const bitmap = await cargarBitmap(file);
  if (!bitmap) {
    throw new ErrorDeImagen("tipo");
  }
  const minimo =
    tipo === "character"
      ? IMAGEN_SOLICITUD.character.minLado
      : IMAGEN_SOLICITUD.logo.minLado;
  if (Math.min(bitmap.width, bitmap.height) < minimo) {
    bitmap.close?.();
    throw new ErrorDeImagen("chica");
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new ErrorDeImagen("navegador");
  }
  encuadrar(canvas, ctx, bitmap, tipo);
  bitmap.close?.();

  for (const calidad of [CALIDAD_WEBP, 0.75, 0.65, 0.5]) {
    const webp = await canvasABlob(canvas, "image/webp", calidad);
    if (webp?.type !== "image/webp") {
      throw new ErrorDeImagen("navegador");
    }
    if (webp.size <= IMAGEN_SOLICITUD.salidaMaxBytes) {
      return webp;
    }
  }
  throw new ErrorDeImagen("grande");
}
