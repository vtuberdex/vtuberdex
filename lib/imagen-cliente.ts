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
  if (typeof createImageBitmap !== 'function') return null;
  return createImageBitmap(file).catch(() => null);
}

export function canvasABlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Tope de peso que acepta el servidor de producción para un emblema. */
export const EMBLEMA_MAX_BYTES = 2 * 1024 * 1024;
/** Lado máximo del emblema: se dibuja a ~74 px en la carta, 512 sobra incluso en pantallas densas. */
export const EMBLEMA_MAX_LADO = 512;

/**
 * Convierte lo elegido a un PNG CUADRADO de hasta 512 px, con transparencia.
 *
 * Cuadrado porque el engarce de la carta lo es: un emblema apaisado se vería
 * descentrado. Se CENTRA sobre un lienzo transparente (no se recorta) para no
 * perder parte del trazo, y no se agranda nunca lo que ya es pequeño.
 * Lanza un error legible si el resultado supera el límite del servidor.
 */
export async function aPngCuadrado(file: Blob, maxLado = EMBLEMA_MAX_LADO): Promise<Blob> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  const bitmap = await cargarBitmap(file);
  if (!bitmap) return file;

  const lado = Math.min(maxLado, Math.max(bitmap.width, bitmap.height));
  const escala = Math.min(lado / bitmap.width, lado / bitmap.height, 1);
  const dw = Math.round(bitmap.width * escala);
  const dh = Math.round(bitmap.height * escala);
  canvas.width = lado;
  canvas.height = lado;
  ctx.drawImage(bitmap, Math.round((lado - dw) / 2), Math.round((lado - dh) / 2), dw, dh);
  bitmap.close?.();

  const png = (await canvasABlob(canvas, 'image/png')) ?? file;
  if (png.size > EMBLEMA_MAX_BYTES) {
    throw new Error('El emblema pesa más de 2 MB incluso reducido. Prueba con una imagen más simple.');
  }
  return png;
}
