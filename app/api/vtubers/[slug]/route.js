/**
 * `GET /api/vtubers/:slug` — detalle de una carta.
 *
 * Mismo contrato que el Express: el detalle más los vecinos de dex (para poder
 * navegar sin volver al catálogo). Un slug inexistente da `no_encontrado` con 404.
 *
 * ENCIMA DEL CATÁLOGO SE APLICAN LAS EDICIONES
 * --------------------------------------------
 * El catálogo sale de SQLite (síncrono, del bundle) y luego se superponen las ediciones
 * hechas en el mantenedor, que viven en Turso (`lib/ediciones.mjs`). Dos decisiones:
 *
 *   · **Se lee el catálogo igual que siempre.** No se pasa a asíncrono `search.mjs`: sus
 *     52 tests y las llamadas de las rutas quedan intactos, y sin Turso configurado esta
 *     ruta se comporta exactamente como antes (la consulta a Turso devuelve vacío).
 *   · **Sin Turso no se paga nada.** `leerEdiciones()` sale de inmediato si no hay
 *     `TURSO_DATABASE_URL`, así que en local y en los tests no hay red de por medio.
 */
import { getDb } from '../../../../lib/db.mjs';
import {
  aplicarEdiciones,
  aplicarImagenesDelMantenedor,
  leerEdiciones,
  reemplazosDelMantenedor,
} from '../../../../lib/ediciones.mjs';
import { KINDS_GESTIONABLES } from '../../../../lib/carpetas.mjs';
import { getNeighbors, getVtuberBySlug } from '../../../../server/src/search.mjs';

export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const { slug } = await params;
  const db = getDb();
  const card = getVtuberBySlug(db, slug);
  if (!card) return Response.json({ error: 'no_encontrado' }, { status: 404 });

  const ediciones = await leerEdiciones();
  /**
   * Las IMÁGENES del mantenedor también ganan al catálogo, no solo los campos de texto.
   *
   * Sin esto, subir una imagen desde el mantenedor no se veía en el sitio público: el campo que
   * decide qué dibuja la carta 3D es `images[kind]`, y para `background` viene `null` en 784 de
   * las 785 fichas. El fondo se servía por HTTP con un 200 y la carta no lo pintaba, porque
   * `holo-card.tsx` solo entra en esa capa `if (card.images.background)`. Los `assets` sí traían
   * la ruta nueva, así que mirando la API parecía correcto.
   */
  const reemplazos = await reemplazosDelMantenedor(card.slug, KINDS_GESTIONABLES);
  const conEdiciones = aplicarImagenesDelMantenedor(aplicarEdiciones(card, ediciones), reemplazos);
  /**
   * Una ficha despublicada desde el mantenedor no se sirve: mismo 404 que una que no existe.
   *
   * Es lo que hace que "despublicar" signifique algo. El catálogo no puede filtrarlo (su
   * `status` es el del scrape y no conoce las ediciones), así que la criba va aquí, después
   * de aplicar la edición. Se midió en producción: sin esto, un `status = draft` dejaba la
   * ficha igual de accesible.
   *
   * El 404 es el mismo que el de un slug inexistente a propósito: distinguirlos diría a
   * cualquiera qué fichas están ocultas sin necesidad.
   */
  if (conEdiciones.status !== 'published') {
    return Response.json({ error: 'no_encontrado' }, { status: 404 });
  }
  return Response.json({ ...conEdiciones, neighbors: getNeighbors(db, card.dexNumber) });
}
