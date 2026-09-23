/**
 * Qué carpetas de imagen publica la app y cuáles puede reemplazar el mantenedor.
 *
 * POR QUÉ ES UN MÓDULO PROPIO
 * ---------------------------
 * Esta lista vivía COPIADA en tres sitios (`USED_FOLDERS` en `scripts/build-db.mjs`, otra
 * igual en `scripts/publish-images.mjs` y la validación de la ruta del mantenedor). Tres
 * copias de un valor que decide si una imagen se publica y si se puede servir: tocar una y
 * olvidar las otras deja el catálogo sirviendo una carpeta que el manifiesto no publica (o al
 * revés), sin ningún error que lo delate. Aquí hay UNA definición y los consumidores la
 * importan. Es un módulo sin dependencias a propósito: lo importan tanto el build
 * (`scripts/build-db.mjs`, que solo usa `node:fs` y `node:sqlite`) como las rutas de Next.
 */

/**
 * Carpetas que la app sirve y que viajan en el manifiesto.
 *
 * Las retiradas (`thumb`, `avatar`, `ficha`, `radar`, `card`) NO están aquí: sus archivos
 * pueden seguir en disco, pero ninguna vista los pide y publicarlas era lo que inflaba el
 * manifiesto y el número de operaciones de Blob. Sus rutas responden 404 a propósito.
 *
 * `background` viaja VACÍA por defecto: el scraper no la produce, solo se llena si alguien
 * sube un fondo desde el mantenedor.
 */
export const CARPETAS_PUBLICADAS = ['character', 'logo', 'faction', 'background'];

/**
 * Tipos que el mantenedor puede REEMPLAZAR.
 *
 * Es un SUBCONJUNTO de las carpetas publicadas: `faction` se publica (sus 23 emblemas los
 * produce el scraper) pero no se reemplaza a mano. El orden es el que muestra el gestor de
 * imágenes del mantenedor.
 */
export const KINDS_GESTIONABLES = ['character', 'background', 'logo'];

/**
 * Extensión de archivo de cada carpeta.
 *
 * No se asume `.webp` para todas: los emblemas de facción son **PNG** (`data/images/faction/*.png`).
 * Suponer una sola extensión dejaba esas 23 imágenes sin poder servirse, y el fallo era
 * invisible (la firma de la clave se descarta y la imagen cae al 301 de Blob).
 */
export const EXTENSION_DE_CARPETA = {
  character: 'webp',
  logo: 'webp',
  background: 'webp',
  faction: 'png',
};
