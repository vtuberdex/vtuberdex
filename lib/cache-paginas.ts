/**
 * Caché de páginas del catálogo y precarga de las vecinas.
 *
 * EL SÍNTOMA: pasar de página esperaba la respuesta de la API ANTES de poder mostrar
 * la hoja nueva (el libro la deja en pie hasta que llegan los datos), y después cada
 * carta esperaba sus imágenes para generar la textura. Dos viajes de red encadenados
 * en el momento exacto en que el usuario mira. El catálogo no cambia mientras se
 * navega, así que no hay razón para pedir dos veces lo mismo ni para pedirlo tarde.
 *
 * QUÉ HACE: guarda cada respuesta por su clave de consulta (filtros + orden + página) en
 * un LRU acotado, y en cuanto una página se muestra pide EN SEGUNDO PLANO la anterior
 * y la siguiente con los mismos filtros, y calienta sus imágenes (ver `loadImage`, que
 * memoiza por URL). Al pasar de página la respuesta ya está en memoria: el giro arranca
 * sin esperar y las texturas se generan con las imágenes ya decodificadas.
 *
 * La clave normaliza `perPage` al tamaño del libro, igual que el hook, para que una URL
 * con `perPage` viejo no genere entradas que nadie vuelve a leer.
 *
 * Sin estado de React a propósito: la caché sobrevive a remontajes del catálogo (ir a
 * una ficha y volver) y el hook solo la consulta. `__limpiarCachePaginas` es para los
 * tests, que comparten módulo.
 */
import type { ApiListResponse, SearchParams, VtuberCard } from '@/lib/types';
import { DEFAULT_PER_PAGE, searchParamsToQuery } from '@/lib/query';

/** Páginas que se retienen: la actual, sus vecinas y un historial corto de navegación. */
export const LIMITE_PAGINAS = 24;

/**
 * Espera antes de pedir las vecinas, en ms. Lo justo para que la petición de la página
 * actual y sus imágenes salgan primero: la precarga nunca debe competir por la red con
 * lo que el usuario está mirando.
 */
export const RETRASO_PRECARGA_MS = 150;

const cache = new Map<string, ApiListResponse>();
const enVuelo = new Set<string>();

export function clavePagina(params: SearchParams): string {
  return searchParamsToQuery({ ...params, perPage: DEFAULT_PER_PAGE });
}

/** Lee una página cacheada y la marca como recién usada (LRU). */
export function leerPagina(params: SearchParams): ApiListResponse | undefined {
  const clave = clavePagina(params);
  const hit = cache.get(clave);
  if (hit) {
    cache.delete(clave);
    cache.set(clave, hit);
  }
  return hit;
}

export function guardarPagina(params: SearchParams, response: ApiListResponse): void {
  const clave = clavePagina(params);
  cache.delete(clave);
  cache.set(clave, response);
  while (cache.size > LIMITE_PAGINAS) {
    const masVieja = cache.keys().next().value;
    if (masVieja === undefined) break;
    cache.delete(masVieja);
  }
}

/** Parámetros de las páginas anterior y siguiente que existen. */
export function paginasVecinas(params: SearchParams, pageCount: number): SearchParams[] {
  const vecinas: SearchParams[] = [];
  for (const page of [params.page - 1, params.page + 1]) {
    if (page >= 1 && page <= pageCount && page !== params.page) vecinas.push({ ...params, page });
  }
  return vecinas;
}

/**
 * URLs de imagen que una página de cartas va a necesitar para sus texturas: personaje
 * (o carta), logo, fondo y emblemas de facción. Sin duplicados ni vacíos.
 */
export function imagenesDeCartas(items: readonly VtuberCard[]): string[] {
  const urls = new Set<string>();
  for (const card of items) {
    const arte = card.images.character ?? card.images.card;
    if (arte) urls.add(arte);
    if (card.images.logo) urls.add(card.images.logo);
    if (card.images.background) urls.add(card.images.background);
    for (const faccion of card.factionIcons ?? []) {
      if (faccion.icon) urls.add(faccion.icon);
    }
  }
  return [...urls];
}

/**
 * Pide las páginas vecinas que falten y las guarda; `calentar` recibe las cartas de
 * cada una para precargar sus imágenes. Las peticiones se deduplican mientras vuelan y
 * un fallo se ignora: la precarga es una optimización, nunca un error visible.
 */
export function precargarVecinas(
  params: SearchParams,
  pageCount: number,
  pedir: (vecina: SearchParams) => Promise<ApiListResponse>,
  calentar?: (items: VtuberCard[]) => void,
): Promise<void> {
  const trabajos = paginasVecinas(params, pageCount).map((vecina) => {
    const clave = clavePagina(vecina);
    if (cache.has(clave)) {
      calentar?.(cache.get(clave)!.items);
      return Promise.resolve();
    }
    if (enVuelo.has(clave)) return Promise.resolve();
    enVuelo.add(clave);
    return pedir(vecina)
      .then((response) => {
        guardarPagina(vecina, response);
        calentar?.(response.items);
      })
      .catch(() => undefined)
      .finally(() => {
        enVuelo.delete(clave);
      });
  });
  return Promise.all(trabajos).then(() => undefined);
}

/** Para los tests: vacía la caché y las peticiones en vuelo. */
export function __limpiarCachePaginas(): void {
  cache.clear();
  enVuelo.clear();
}

/** Para los tests y la depuración: cuántas páginas hay en memoria. */
export function __tamanoCachePaginas(): number {
  return cache.size;
}
