/**
 * `GET /api/vtubers/:slug/directo` — si el VTuber está en directo y qué publica, según sus redes.
 *
 * Twitch, YouTube y Kick se consultan desde el SERVIDOR (`lib/directos.mjs`): el navegador nunca habla con
 * ellas, las credenciales no salen de aquí y mil visitantes a la misma ficha cuestan una llamada. Sin
 * credenciales las plataformas salen como `sin_credenciales` y la ficha no muestra nada.
 *
 * Mismas defensas que el detalle: sesión de visitante y presupuesto de fichas. Una ficha oculta, en borrador
 * o dada de baja responde el mismo 404 que un slug inexistente (`getVtuberBySlug`).
 */
import {
  gastarFichas,
  redDeLaPeticion,
  respuestaAgotada,
} from "../../../../../lib/anti-scraping.mjs";
import { estadoDeRedes } from "../../../../../lib/directos.mjs";
import { dbConDiario } from "../../../../../lib/diario.mjs";
import { exigirSesion } from "../../../../../lib/sesion-visitante.mjs";
import { getVtuberBySlug } from "../../../../../server/src/search.mjs";

export const dynamic = "force-dynamic";

/** La caché real es la de memoria de `directos.mjs`; el borde solo absorbe ráfagas. */
const CACHE_PUBLICA = "public, max-age=0, s-maxage=30, stale-while-revalidate=30";

export async function GET(request, { params }) {
  const sinSesion = exigirSesion(request);
  if (sinSesion) return sinSesion;
  const { slug } = await params;
  const db = await dbConDiario({ ttlMs: 2000 });
  const card = getVtuberBySlug(db, slug);
  if (!card) return Response.json({ error: "no_encontrado" }, { status: 404 });
  const cupo = gastarFichas(redDeLaPeticion(request.headers), [card.id]);
  if (!cupo.permitido) return respuestaAgotada(cupo);

  const canales = await estadoDeRedes(card.socials);
  return Response.json(
    // Solo lo que la ficha puede pintar: una plataforma sin credenciales o caída no ocupa sitio.
    { canales: canales.filter((c) => c.estado === "ok") },
    { headers: { "cache-control": CACHE_PUBLICA } },
  );
}
