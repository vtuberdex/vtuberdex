// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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
  gastarFichas,
  redDeLaPeticion,
  respuestaAgotada,
} from "../../../lib/anti-scraping.mjs";
import { dbConDiario } from "../../../lib/diario.mjs";
import {
  buscarPagina,
  completarPagina,
} from "../../../lib/fichas-publicas.mjs";
import { exigirSesion } from "../../../lib/sesion-visitante.mjs";
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

export async function GET(request) {
  const sinSesion = exigirSesion(request);
  if (sinSesion) {
    return sinSesion;
  }
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

  const pagina = buscarPagina(db, parsed.data);
  // Fichas DISTINTAS por red y hora/día (ver lib/anti-scraping.mjs): frena al scraper paciente.
  const cupo = gastarFichas(
    redDeLaPeticion(request.headers),
    pagina.result.items.map((c) => c.id),
  );
  if (!cupo.permitido) {
    return respuestaAgotada(cupo);
  }
  return Response.json(await completarPagina(db, pagina), {
    headers: { "cache-control": CACHE_PUBLICA },
  });
}
