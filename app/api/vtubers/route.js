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
import {
  PER_PAGE_PUBLICO_MAX,
  gastarFichas,
  redDeLaPeticion,
  respuestaAgotada,
} from "../../../lib/anti-scraping.mjs";
import { dbConDiario } from "../../../lib/diario.mjs";
import { exigirSesion } from "../../../lib/sesion-visitante.mjs";
import { aplicarReemplazosALista } from "../../../lib/ediciones.mjs";
import { conExperiencia, contarLikesVarios } from "../../../lib/likes.mjs";
import { xpJuegoDeVarias } from "../../../lib/minecraft.mjs";
import { marcarSinCorreo } from "../../../lib/sin-correo.mjs";
import { facetCounts, searchVtubers } from "../../../server/src/search.mjs";
import {
  formatIssues,
  listQuerySchema,
} from "../../../server/src/validation.mjs";

export const dynamic = "force-dynamic";

/**
 * Caché de BORDE de la respuesta pública: 30 s frescos y 60 s más sirviendo la copia mientras se
 * renueva. Cada visita pagaba la ida a Turso (clave del diario + reemplazos de imagen) aunque
 * nada hubiera cambiado; con esto la mayoría la resuelve el CDN. El precio es que una edición
 * del mantenedor tarda hasta ~30-90 s en verse en el sitio público. Solo las respuestas 200: un
 * 400 no se cachea. Sin `max-age`: el navegador siempre pregunta al borde.
 */
const CACHE_PUBLICA =
  "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
/** TTL de la clave del diario en lecturas públicas (ver `dbConDiario`). */
const TTL_DIARIO_MS = 2000;

/** El servidor Express acepta `?countries=a,b` además de `?countries=a&countries=b`. */
function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function GET(request) {
  const sinSesion = exigirSesion(request);
  if (sinSesion) return sinSesion;
  const db = await dbConDiario({ ttlMs: TTL_DIARIO_MS });
  // `Object.fromEntries` reproduce lo que Express deja en `req.query`: arrays
  // cuando el parámetro se repite. El esquema zod espera esa forma.
  const raw = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = listQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "query_invalida", issues: formatIssues(parsed.error) },
      { status: 400 },
    );
  }

  const {
    q,
    countries,
    languages,
    groups,
    artists,
    factions,
    sort,
    page,
    language,
    premium,
    facet,
  } = parsed.data;
  // El público nunca necesita más que una página del libro: 100 por petición volcaba el catálogo en 8.
  const perPage = Math.min(parsed.data.perPage, PER_PAGE_PUBLICO_MAX);
  const result = searchVtubers(db, {
    q,
    countries: splitCsv(countries),
    languages: splitCsv(languages),
    groups: splitCsv(groups),
    artists: splitCsv(artists),
    factions: splitCsv(factions),
    premium: Boolean(premium),
    sort,
    page,
    perPage,
  });
  // Fichas DISTINTAS por red y hora/día (ver lib/anti-scraping.mjs): frena al scraper paciente.
  const cupo = gastarFichas(
    redDeLaPeticion(request.headers),
    result.items.map((c) => c.id),
  );
  if (!cupo.permitido) return respuestaAgotada(cupo);
  const facets = facet ? facetCounts(db, { language, q }) : null;
  /**
   * Las imágenes del mantenedor, al final: viven en Turso por slug y no en la base del catálogo.
   * Una sola consulta para toda la página (ver `reemplazosDePagina`).
   */
  const conImagenes = await aplicarReemplazosALista(result.items);
  /**
   * El nivel de cada carta sale de la fórmula de experiencia (likes, juego, antigüedad, premium), no de la
   * columna guardada. Dos consultas para toda la página; si el almacén falla se queda el nivel de fórmula con
   * 0 likes, nunca el manual.
   */
  const ids = conImagenes.map((c) => c.id);
  const [likes, juego] = await Promise.all([
    contarLikesVarios(ids).catch(() => new Map()),
    xpJuegoDeVarias(ids),
  ]);
  const conNivel = conImagenes.map((c) =>
    conExperiencia(c, likes.get(c.id) ?? 0, juego.get(c.id) ?? 0),
  );
  const items = await marcarSinCorreo(db, conNivel);
  return Response.json(
    { ...result, items, facets },
    { headers: { "cache-control": CACHE_PUBLICA } },
  );
}
