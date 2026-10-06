/**
 * `GET|POST /api/vtubers/:slug/like` — el like diario a un VTuber.
 *
 *   · GET   estado para el visitante: likes totales, si ya dio like HOY y la experiencia que resulta.
 *   · POST  da el like. Uno por día y por VTuber: el segundo responde 409 `ya_dio_like_hoy`.
 *
 * Las reglas (día de Chile, tope por red, cookie del visitante) viven en `lib/likes.mjs`; esto es
 * solo el pegamento HTTP. Nunca se cachea: cada visitante ve SU estado.
 */
import { randomUUID } from 'node:crypto';

import { dbConDiario } from '../../../../../lib/diario.mjs';
import {
  COOKIE_VISITANTE,
  contarLikes,
  cookieDeVisitante,
  darLike,
  ipDelCliente,
  leerCookie,
  origenPermitido,
  resumenDeLikes,
  visitanteValido,
  yaDioLikeHoy,
} from '../../../../../lib/likes.mjs';
import { avisarSubidaDeNivel } from '../../../../../lib/mi-ficha.mjs';
import { getVtuberBySlug } from '../../../../../server/src/search.mjs';

export const dynamic = 'force-dynamic';

const SIN_CACHE = { 'cache-control': 'no-store' };

function responder(cuerpo, estado, cabeceras = {}) {
  return Response.json(cuerpo, { status: estado, headers: { ...SIN_CACHE, ...cabeceras } });
}

/** El visitante de la cookie, o uno nuevo (y su `Set-Cookie`) si no hay o está manipulada. */
function identificar(request) {
  const existente = visitanteValido(leerCookie(request.headers.get('cookie'), COOKIE_VISITANTE));
  if (existente) return { visitante: existente, cabeceras: {} };
  const visitante = randomUUID();
  const seguro = (request.headers.get('x-forwarded-proto') ?? new URL(request.url).protocol.replace(':', '')) === 'https';
  return { visitante, cabeceras: { 'set-cookie': cookieDeVisitante(visitante, seguro) } };
}

async function fichaPublica(slug) {
  const db = await dbConDiario({ ttlMs: 2000 });
  return getVtuberBySlug(db, slug);
}

export async function GET(request, { params }) {
  const { slug } = await params;
  const card = await fichaPublica(slug);
  if (!card) return responder({ error: 'no_encontrado' }, 404);
  const { visitante, cabeceras } = identificar(request);
  try {
    const [likes, liked] = await Promise.all([contarLikes(card.id), yaDioLikeHoy({ vtuberId: card.id, visitante })]);
    return responder(resumenDeLikes(card, likes, liked), 200, cabeceras);
  } catch (error) {
    console.error(`[likes] no se pudo leer el estado de ${slug}: ${error.message}`);
    return responder({ error: 'likes_no_disponibles' }, 503);
  }
}

export async function POST(request, { params }) {
  if (!origenPermitido(request.headers)) return responder({ error: 'origen_no_permitido' }, 403);
  const { slug } = await params;
  const card = await fichaPublica(slug);
  if (!card) return responder({ error: 'no_encontrado' }, 404);
  const { visitante, cabeceras } = identificar(request);
  try {
    const resultado = await darLike({ vtuberId: card.id, visitante, ip: ipDelCliente(request.headers) });
    const likes = await contarLikes(card.id);
    if (!resultado.ok) {
      const detalle =
        resultado.motivo === 'ya_dio_like_hoy'
          ? 'Ya le diste like a este VTuber hoy. Vuelve mañana.'
          : 'Se alcanzó el máximo de likes de hoy desde esta red.';
      return responder({ error: resultado.motivo, detail: detalle, ...resumenDeLikes(card, likes, resultado.motivo === 'ya_dio_like_hoy') }, 409, cabeceras);
    }
    // Si este like hizo subir de nivel a la ficha, su titular recibe el enlace para repartir puntos. En segundo
    // plano: el correo no retrasa ni puede romper el like (`avisarSubidaDeNivel` nunca lanza).
    void avisarSubidaDeNivel({ card, likes });
    return responder(resumenDeLikes(card, likes, true), 200, cabeceras);
  } catch (error) {
    console.error(`[likes] no se pudo registrar el like de ${slug}: ${error.message}`);
    return responder({ error: 'likes_no_disponibles', detail: 'No se pudo registrar el like. Inténtalo de nuevo.' }, 503);
  }
}
