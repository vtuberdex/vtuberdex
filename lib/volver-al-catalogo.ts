/**
 * Recuerda DÓNDE estaba el visitante en el catálogo (página, filtros, orden) para que el
 * «← Catálogo» de la ficha lo devuelva ahí y no a la página 1.
 *
 * La URL del catálogo ya ES su estado (`?page=3&countries=chile`), así que basta con guardar su
 * querystring. Va en `sessionStorage` (por pestaña): una pestaña nueva, sin pasado en el catálogo,
 * cae en `/`. Solo se guarda y se reconstruye el QUERYSTRING; el destino siempre es `/?…` del propio
 * sitio, así que un valor manipulado en el almacenamiento no puede mandar al visitante a otro dominio.
 */
export const CLAVE_CATALOGO = 'vtuberdex:catalogo';

export function guardarCatalogo(queryString: string): void {
  try {
    window.sessionStorage.setItem(CLAVE_CATALOGO, queryString);
  } catch {
    /* sin almacenamiento (modo privado): el enlace vuelve a la página 1, como antes */
  }
}

/** Ruta del catálogo tal como se dejó: `/` o `/?page=3&…`. */
export function rutaDelCatalogo(): string {
  try {
    const guardado = window.sessionStorage.getItem(CLAVE_CATALOGO) ?? '';
    // Solo un querystring plausible: sin saltos, sin esquema ni "//" que cambiarían el destino.
    return guardado && /^[\w%.,=&+~\-:*@!$'()]*$/.test(guardado) ? `/?${guardado}` : '/';
  } catch {
    return '/';
  }
}
