/**
 * Aprobar una solicitud de MODIFICACIÓN: de los datos del formulario al parche de la ficha.
 *
 * Es JS puro sobre un `db` síncrono (el de Express o la copia con el diario ya reproducido en
 * producción), así que las dos rutas de aprobación —Express local y Next— comparten estas reglas
 * y solo difieren en CÓMO escriben el parche (transacción local o diario de Turso).
 *
 * Qué se aplica y qué no:
 *   · Texto, color, país, idiomas, estatura… → parche directo a la ficha (solo lo que vino con valor).
 *   · Redes → se SUMAN o actualizan por plataforma; nunca se borran las que ya tiene.
 *   · Gustos (`profile`) → se actualiza la fila de la misma etiqueta o se añade; las demás quedan.
 *   · Modelador → pasa al frente de `artists` sin quitar a los demás (quién más participó lo decide
 *     el mantenedor, no un formulario).
 *   · Avatar y logo llegan como ENLACE y NO se aplican solos: el mantenedor descarga y sube la imagen
 *     por el gestor, igual que con una inscripción. Se devuelven aparte (`imagenes`) para que lo vea.
 */
import { SolicitudError, camposDeFicha } from './solicitudes.mjs';
import { getVtuberBySlug } from './search.mjs';
import { normalizeText, slugify } from './text.mjs';

/**
 * Busca la ficha que pidió la solicitud: por `/v/<slug>` (o una URL completa), por slug o por nombre
 * exacto. Un alias antiguo también resuelve. Si no hay UNA ficha clara no se adivina: el mantenedor
 * la corrige a mano o rechaza.
 */
export function fichaDeLaSolicitud(db, referencia) {
  const texto = String(referencia ?? '').trim();
  const delEnlace = texto.match(/\/v\/([^/?#\s]+)/i)?.[1];
  const candidatos = [delEnlace, slugify(texto)].filter(Boolean);
  for (const slug of candidatos) {
    const ficha = getVtuberBySlug(db, decodeURIComponent(slug), { includeHidden: true });
    if (ficha) return ficha;
  }
  const porNombre = db.prepare('SELECT slug FROM vtuber WHERE search_name = ?').all(normalizeText(texto));
  if (porNombre.length === 1) return getVtuberBySlug(db, porNombre[0].slug, { includeHidden: true });
  const detalle = porNombre.length > 1 ? 'hay varias fichas con ese nombre: pídele su dirección /v/…' : 'no se encontró esa ficha';
  throw new SolicitudError(404, 'ficha_no_encontrada', detalle);
}

const igual = (a, b) => normalizeText(String(a ?? '')) === normalizeText(String(b ?? ''));

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ datos: Record<string, any> }} solicitud una solicitud de tipo `modificacion`
 * @returns {{ id: number, slug: string, patch: Record<string, any>, imagenes: { imageUrl?: string, logoUrl?: string } }}
 */
export function prepararModificacion(db, solicitud) {
  const d = solicitud.datos;
  const actual = fichaDeLaSolicitud(db, d.ficha);
  const { columnas, modeler, perfil } = camposDeFicha(d);
  const patch = { ...columnas };

  if (d.country) patch.countries = [d.country];
  if (d.languages?.length) patch.languages = d.languages;

  if (modeler && !(actual.artists ?? []).some((nombre) => igual(nombre, modeler))) {
    patch.artists = [modeler, ...(actual.artists ?? [])];
  }

  if (perfil.length) {
    const filas = (actual.profile ?? []).map(({ label, value }) => ({ label, value }));
    for (const nueva of perfil) {
      const indice = filas.findIndex((fila) => igual(fila.label, nueva.label));
      if (indice >= 0) filas[indice] = nueva;
      else filas.push(nueva);
    }
    patch.profile = filas;
  }

  if (d.socials?.length) {
    // Se conservan label e icon de la red existente; las nulas se descartan para pasar el esquema.
    const redes = (actual.socials ?? []).map((red) =>
      Object.fromEntries(Object.entries(red).filter(([, valor]) => valor !== null && valor !== undefined)),
    );
    for (const nueva of d.socials) {
      const indice = redes.findIndex((red) => igual(red.platform, nueva.platform));
      if (indice >= 0) redes[indice] = { ...redes[indice], url: nueva.url };
      else redes.push({ platform: nueva.platform, url: nueva.url });
    }
    patch.socials = redes;
  }

  const imagenes = {};
  if (d.imageUrl) imagenes.imageUrl = d.imageUrl;
  if (d.logoUrl) imagenes.logoUrl = d.logoUrl;
  return { id: actual.id, slug: actual.slug, patch, imagenes };
}
