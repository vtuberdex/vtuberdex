/**
 * Listado del mantenedor con el dato del correo: marca cada ficha (`hasEmail`) y permite filtrar por
 * las que tienen o no correo. Lo comparten el Express local y la ruta de Next.
 *
 * El correo NO está en la tabla `vtuber` (es confidencial y esa base viaja empaquetada y por el diario),
 * así que el filtro no se puede hacer en SQL: se recorren las páginas del catálogo (≈785 fichas, 8
 * consultas locales de milisegundos) y se pagina a mano. Sin filtro cuesta una sola consulta a la cola.
 * El correo mismo nunca sale en el listado, solo si existe.
 */
import { correosDeFichas } from './solicitudes.mjs';
import { getVtuberBySlug, searchVtubers } from './search.mjs';

const POR_PAGINA_MAX = 100;

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ execute: Function, exec: Function } | null} ejecutor  la cola de solicitudes (donde viven los correos)
 * @param {{ correo?: 'con' | 'sin' | null, page?: number, perPage?: number } & Record<string, unknown>} params  el resto va a `searchVtubers`
 */
export async function listarConCorreo(db, ejecutor, { correo = null, page = 1, perPage = 40, ...busqueda }) {
  // Sin ejecutor (cola no disponible) nada tiene correo conocido: el listado sigue sirviendo.
  const correos = ejecutor
    ? await correosDeFichas(ejecutor, { resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }) })
    : new Map();
  const marcar = (items) => items.map((item) => ({ ...item, hasEmail: correos.has(item.id) }));

  if (!correo) {
    const resultado = searchVtubers(db, { ...busqueda, page, perPage });
    return { ...resultado, items: marcar(resultado.items) };
  }

  const todas = [];
  for (let p = 1; ; p += 1) {
    const bloque = searchVtubers(db, { ...busqueda, page: p, perPage: POR_PAGINA_MAX });
    todas.push(...marcar(bloque.items));
    if (p >= bloque.pageCount) break;
  }
  const filtradas = todas.filter((item) => item.hasEmail === (correo === 'con'));
  const pageCount = Math.max(1, Math.ceil(filtradas.length / perPage));
  const actual = Math.min(Math.max(page, 1), pageCount);
  return {
    items: filtradas.slice((actual - 1) * perPage, actual * perPage),
    total: filtradas.length,
    page: actual,
    perPage,
    pageCount,
  };
}
