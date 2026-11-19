// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Versión de 512 px de ancho de las imágenes que dibuja el LIBRO (`?w=512`).
 *
 * POR QUÉ: las texturas del libro miden 512 de ancho (`TEXTURAS.ancho`), pero bajaba el personaje y el
 * fondo de 720 y logos de hasta 1.008: ~2,2 MB de los 3,9 que pesaba una página (medido 2026-11-19).
 * La ficha dibuja a 1.008 y sigue pidiendo el original. La ruta de imágenes (`app/images/[...path]`) la
 * genera con sharp una vez y nginx la guarda (su clave incluye la query).
 *
 * Solo este ancho y solo estas carpetas: aceptar cualquier `w` dejaría generar (y cachear) tamaños sin
 * límite. Los emblemas ya son de 256.
 */
export const ANCHO_LIBRO = 512;
export const CARPETAS_CON_VARIANTE = new Set([
  "character",
  "background",
  "logo",
]);

/** La carpeta de una URL de imagen (`/images/<carpeta>/…`), o `null`. */
export function carpetaDeImagen(url) {
  const m = /(?:^|\/)images\/([^/?#]+)\//.exec(String(url ?? ""));
  return m ? m[1] : null;
}

/** La URL de la variante del libro; sin cambios si la carpeta no tiene variante o la URL está vacía. */
export function urlDelLibro(url) {
  if (!url || !CARPETAS_CON_VARIANTE.has(carpetaDeImagen(url))) {
    return url;
  }
  return `${url}${url.includes("?") ? "&" : "?"}w=${ANCHO_LIBRO}`;
}
