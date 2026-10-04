/**
 * Versión vigente de los términos y condiciones (`/terminos`).
 *
 * Vive sola, en un archivo sin imports, porque la necesitan los DOS lados: el servidor la exige
 * en cada solicitud y el navegador la manda con el formulario. `solicitudes.mjs` importa
 * `node:crypto`, que no debe viajar al bundle del cliente.
 *
 * Súbela (fecha ISO) cada vez que cambie el texto de `lib/terminos.ts`: los formularios abiertos
 * con la versión anterior se rechazan en vez de registrar la aceptación de un texto que ya no existe.
 */
export const TERMINOS_VERSION = '2026-10-04';
