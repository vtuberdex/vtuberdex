/**
 * `GET /api/vtubers` — búsqueda facetada del catálogo.
 *
 * Reutiliza `searchVtubers` y `facetCounts` de `server/src/search.mjs` en vez de
 * reimplementar la consulta: esa capa ya está cubierta por los tests del servidor (FTS5,
 * filtros combinados, orden, paginación), así que la migración a Next no duplica la lógica ni
 * el riesgo de que las dos versiones diverjan.
 *
 * Con Turso configurado, la base que se consulta es la empaquetada MÁS el diario de cambios del
 * mantenedor (`lib/diario.mjs`): el número de dex, las facciones, las cartas nuevas o el estado
 * ya están aplicados en SQL, así que `total`, las facetas, el orden y la paginación los reflejan
 * sin ningún filtro en JS. Antes las ediciones se pintaban encima de la página y `total` no
 * descontaba lo despublicado. Sin Turso, `dbConDiario()` es la base de siempre.
 */
import { dbConDiario } from '../../../lib/diario.mjs';
import { aplicarReemplazosALista } from '../../../lib/ediciones.mjs';
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
  const db = await dbConDiario();
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
  /**
   * Las imágenes del mantenedor, al final: viven en Turso por slug y no en la base del catálogo.
   * Una sola consulta para toda la página (ver `reemplazosDePagina`).
   */
  const conImagenes = await aplicarReemplazosALista(result.items);
  return Response.json({ ...result, items: conImagenes, facets });
}
