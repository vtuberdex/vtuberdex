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
import { dbConDiario } from '../../../../lib/diario.mjs';
import { aplicarImagenesDelMantenedor, reemplazosDelMantenedor } from '../../../../lib/ediciones.mjs';
import { KINDS_GESTIONABLES } from '../../../../lib/carpetas.mjs';
import { getNeighbors, getVtuberBySlug } from '../../../../server/src/search.mjs';

export const dynamic = 'force-dynamic';

/** Caché de borde de la ficha pública; el porqué está en `app/api/vtubers/route.js`. */
const CACHE_PUBLICA = 'public, max-age=0, s-maxage=30, stale-while-revalidate=60';
const TTL_DIARIO_MS = 2000;

export async function GET(_request, { params }) {
  const { slug } = await params;
  const db = await dbConDiario({ ttlMs: TTL_DIARIO_MS });
  const card = getVtuberBySlug(db, slug);
  if (!card) return Response.json({ error: 'no_encontrado' }, { status: 404 });

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
  const conImagenes = aplicarImagenesDelMantenedor(card, reemplazos);
  return Response.json(
    { ...conImagenes, neighbors: getNeighbors(db, card.dexNumber) },
    { headers: { 'cache-control': CACHE_PUBLICA } },
  );
}
