/**
 * `GET /api/vtubers` — búsqueda facetada del catálogo.
 *
 * Reutiliza `searchVtubers` y `facetCounts` de `server/src/search.mjs` en vez de
 * reimplementar la consulta: esa capa ya está cubierta por los 52 tests del
 * servidor (FTS5, filtros combinados, orden, paginación), así que la migración a
 * Next no duplica la lógica ni el riesgo de que las dos versiones diverjan.
 *
 * Las EDICIONES del mantenedor (Turso) se aplican DESPUÉS de la búsqueda, sobre las
 * cartas de esta página. El recuento (`total`) y las facetas siguen saliendo de SQLite:
 * un `name` editado a mano no cambia a qué búsquedas responde la carta, porque
 * `search_name` y el índice FTS viven en el catálogo. Es una limitación conocida y
 * deliberada — la alternativa era reindexar en Turso y duplicar el buscador. Por la misma
 * razón, `total` no descuenta las fichas despublicadas desde el mantenedor: la paginación
 * puede mostrar una página con una carta menos.
 */
import { getDb } from '../../../lib/db.mjs';
import { aplicarEdicionesLista, aplicarReemplazosALista, leerEdiciones } from '../../../lib/ediciones.mjs';
import { facetCounts, searchVtubers } from '../../../server/src/search.mjs';
import { formatIssues, listQuerySchema } from '../../../server/src/validation.mjs';

export const dynamic = 'force-dynamic';

/** El servidor Express acepta `?countries=a,b` además de `?countries=a&countries=b`. */
function splitCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request) {
  const db = getDb();
  // `Object.fromEntries` reproduce lo que Express deja en `req.query`: arrays
  // cuando el parámetro se repite. El esquema zod espera esa forma.
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json({ error: 'query_invalida', issues: formatIssues(parsed.error) }, { status: 400 });
  }

  const { q, countries, languages, groups, artists, factions, sort, page, perPage, language, facet } = parsed.data;
  const result = searchVtubers(db, {
    q,
    countries: splitCsv(countries),
    languages: splitCsv(languages),
    groups: splitCsv(groups),
    artists: splitCsv(artists),
    factions: splitCsv(factions),
    sort,
    page,
    perPage,
  });
  const facets = facet ? facetCounts(db, { language, q }) : null;
  // Las ediciones se aplican a las cartas de la página, no a `total` ni a las facetas
  // (ver la cabecera): esos siguen siendo el catálogo.
  const ediciones = await leerEdiciones();
  const editadas = aplicarEdicionesLista(result.items, ediciones);
  /**
   * OCULTAR LO DESPUBLICADO DESDE EL MANTENEDOR.
   *
   * El filtro de `status` vive en el SQL del catálogo (`v.status = 'published'`), y eso corre
   * ANTES de que las ediciones se apliquen: sin esta línea, marcar una ficha como borrador en
   * el mantenedor no servía de nada —seguía en la lista y en su detalle— porque el catálogo
   * la veía publicada. Se midió en producción: `status = draft` y la ficha seguía visible.
   *
   * Se filtra en JS y no en el SQL a propósito: el estado puede venir del catálogo O de una
   * edición, y el catálogo ya hizo su criba. El catálogo no puede filtrar por un valor que no
   * conoce, así que el único sitio donde se ven los dos juntos es aquí.
   */
  const visibles = editadas.filter((carta) => carta.status === 'published');
  /**
   * Las imágenes del mantenedor, al final y SOLO sobre las cartas visibles.
   *
   * Después del filtro a propósito: no se paga una consulta a Turso por una carta que no se va a
   * devolver. El orden respecto a las ediciones tampoco importa para las imágenes (son campos
   * distintos), pero mantener las imágenes al final deja una sola ruta de composición.
   */
  const conImagenes = await aplicarReemplazosALista(visibles);
  return Response.json({ ...result, items: conImagenes, facets });
}
