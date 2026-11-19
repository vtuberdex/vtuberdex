// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * `GET /api/vtubers/:slug` — detalle de una carta.
 *
 * Mismo contrato que el Express: el detalle más los vecinos de dex (para poder navegar sin
 * volver al catálogo). Un slug inexistente da `no_encontrado` con 404.
 *
 * LA BASE ES LA EMPAQUETADA MÁS EL DIARIO DEL MANTENEDOR
 * -----------------------------------------------------
 * `dbConDiario()` (`lib/diario.mjs`) ya trae aplicadas las ediciones, las facciones, el número
 * de dex, la URL y las cartas nuevas. Lo único que sigue viviendo FUERA de esa base son los
 * bytes de las imágenes (Turso, por slug): se superponen aquí, una consulta por ficha.
 *
 * Una ficha despublicada o en borrador no se sirve: `getVtuberBySlug` ya la filtra por estado
 * y responde el mismo 404 que un slug que no existe, a propósito — distinguirlos diría a
 * cualquiera qué fichas están ocultas.
 *
 * Si el slug es uno ANTERIOR (se le cambió la URL), el detalle responde con el slug ACTUAL en el
 * cuerpo y el cliente redirige: ningún enlace compartido se rompe al renombrar una página.
 */
import {
  gastarFichas,
  redDeLaPeticion,
  respuestaAgotada,
} from "../../../../lib/anti-scraping.mjs";
import { dbConDiario } from "../../../../lib/diario.mjs";
import { completarFicha } from "../../../../lib/fichas-publicas.mjs";
import { exigirSesion } from "../../../../lib/sesion-visitante.mjs";
import { getVtuberBySlug } from "../../../../server/src/search.mjs";

export const dynamic = "force-dynamic";

/** Caché de borde de la ficha pública; el porqué está en `app/api/vtubers/route.js`. */
const CACHE_PUBLICA =
  "public, max-age=0, s-maxage=30, stale-while-revalidate=60";
const TTL_DIARIO_MS = 2000;

export async function GET(request, { params }) {
  const sinSesion = exigirSesion(request);
  if (sinSesion) {
    return sinSesion;
  }
  const { slug } = await params;
  const db = await dbConDiario({ ttlMs: TTL_DIARIO_MS });
  const card = getVtuberBySlug(db, slug);
  if (!card) {
    return Response.json({ error: "no_encontrado" }, { status: 404 });
  }
  // Mismo presupuesto de fichas distintas que el listado (lib/anti-scraping.mjs).
  const cupo = gastarFichas(redDeLaPeticion(request.headers), [card.id]);
  if (!cupo.permitido) {
    return respuestaAgotada(cupo);
  }

  return Response.json(await completarFicha(db, card), {
    headers: { "cache-control": CACHE_PUBLICA },
  });
}
