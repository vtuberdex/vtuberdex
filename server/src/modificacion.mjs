// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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
import { SolicitudError, camposDeFicha } from "./solicitudes.mjs";
import { getVtuberBySlug } from "./search.mjs";
import { normalizeText, slugify } from "./text.mjs";

/**
 * Busca la ficha que pidió la solicitud: por `/v/<slug>` (o una URL completa), por slug, por nombre
 * exacto o con el formato con que la gente la copia del catálogo, `#486 Nombre`. Un alias antiguo
 * también resuelve. Si no hay UNA ficha clara no se adivina: el mantenedor la corrige a mano o rechaza.
 *
 * EL `#486` ES LO QUE LA GENTE ESCRIBE: el formulario es un campo de texto libre y en el catálogo cada
 * carta se ve como «#486 NOMBRE». Antes ese texto no coincidía ni con un slug ni con un nombre, y
 * aprobar daba `ficha_no_encontrada` (una solicitud real quedó atascada así). El número de dex se
 * usa solo para DESEMPATAR o cuando es lo único que se escribió: los dex se pueden mover, así que
 * nunca manda sobre un nombre que sí coincide con otra ficha.
 */
export function fichaDeLaSolicitud(db, referencia) {
  const texto = String(referencia ?? "").trim();
  const { delEnlace, dex, sinDex } = leerReferencia(texto);
  const nombre = normalizeText(sinDex);
  const hayDex = dex !== null && dex !== undefined;

  // Nombre Y número a la vez: la ficha que cumple las dos cosas gana a cualquier otra con el mismo
  // slug o nombre (con dos fichas llamadas igual, «#77 GKuro» no puede caer en la primera por slug).
  if (hayDex && nombre) {
    const exactas = db
      .prepare(
        "SELECT slug FROM vtuber WHERE dex_number = ? AND search_name = ?",
      )
      .all(Number(dex), nombre);
    if (exactas.length === 1) {
      return getVtuberBySlug(db, exactas[0].slug, { includeHidden: true });
    }
  }

  const porSlug = fichaPorSlugs(db, [delEnlace, slugify(sinDex), slugify(texto)]);
  if (porSlug) {
    return porSlug;
  }

  const porNombre = nombre
    ? db.prepare("SELECT slug FROM vtuber WHERE search_name = ?").all(nombre)
    : [];
  if (porNombre.length === 1) {
    return getVtuberBySlug(db, porNombre[0].slug, { includeHidden: true });
  }

  if (hayDex) {
    const porDex = db
      .prepare("SELECT slug FROM vtuber WHERE dex_number = ?")
      .all(Number(dex));
    const pool = candidatasPorDex(porNombre, porDex, nombre);
    if (pool.length === 1) {
      return getVtuberBySlug(db, pool[0].slug, { includeHidden: true });
    }
  }

  const detalle =
    porNombre.length > 1
      ? "hay varias fichas con ese nombre: pídele su dirección /v/…"
      : "no se encontró esa ficha";
  throw new SolicitudError(404, "ficha_no_encontrada", detalle);
}

/**
 * Lo escrito en el campo «ficha», por partes: el slug de un enlace `/v/<slug>`, o si no lo hay, el
 * `#486` del catálogo y el texto sin él.
 */
function leerReferencia(texto) {
  const delEnlace = /\/v\/([^/?#\s]+)/i.exec(texto)?.[1];
  if (delEnlace) {
    return { delEnlace, dex: null, sinDex: texto };
  }
  const marcaDex = /(?:^|\s)#\s*(\d{1,4})(?=\s|$|[.,;:\-–—)])/;
  return {
    delEnlace,
    dex: marcaDex.exec(texto)?.[1],
    sinDex: texto.replace(marcaDex, " ").replace(/\s+/g, " ").trim(),
  };
}

/** La primera ficha (también oculta o en borrador) que resuelve alguno de los slugs candidatos. */
function fichaPorSlugs(db, candidatos) {
  for (const slug of new Set(candidatos.filter(Boolean))) {
    let ficha = null;
    try {
      ficha = getVtuberBySlug(db, decodeURIComponent(slug), {
        includeHidden: true,
      });
    } catch {
      /* un %xx mal formado en el enlace no debe tumbar la resolución */
    }
    if (ficha) {
      return ficha;
    }
  }
  return null;
}

/**
 * Varias con el mismo nombre: el número decide cuál. Sin nombre escrito: el número es todo lo que
 * hay. Con un nombre que no es de nadie, el número solo no basta.
 */
function candidatasPorDex(porNombre, porDex, nombre) {
  if (porNombre.length > 1) {
    return porNombre.filter((n) => porDex.some((d) => d.slug === n.slug));
  }
  return nombre ? [] : porDex;
}

const igual = (a, b) =>
  normalizeText(String(a ?? "")) === normalizeText(String(b ?? ""));

/** El modelador pasa al frente de `artists` sin quitar a nadie; `null` si no hay nada que cambiar. */
function artistasConModelador(artistas, modeler) {
  if (!modeler || artistas.some((nombre) => igual(nombre, modeler))) {
    return null;
  }
  return [modeler, ...artistas];
}

/** Ids de las imágenes ya subidas; se copian a la ficha al aprobar (`imagenes-solicitud.mjs`). */
function imagenesDe(d) {
  const imagenes = {};
  if (d.imageId) {
    imagenes.imageId = d.imageId;
  }
  if (d.logoId) {
    imagenes.logoId = d.logoId;
  }
  return imagenes;
}

/** Los gustos actualizan su fila de `profile` (o se añaden) sin tocar las demás. */
function perfilConCambios(perfilActual, perfil) {
  const filas = (perfilActual ?? []).map(({ label, value }) => ({
    label,
    value,
  }));
  for (const nueva of perfil) {
    const indice = filas.findIndex((fila) => igual(fila.label, nueva.label));
    if (indice >= 0) {
      filas[indice] = nueva;
    } else {
      filas.push(nueva);
    }
  }
  return filas;
}

/**
 * Las redes se SUMAN o actualizan por plataforma. Se conservan label e icon de la red existente; las
 * nulas se descartan para pasar el esquema.
 */
function redesConCambios(redesActuales, nuevas) {
  const redes = (redesActuales ?? []).map((red) =>
    Object.fromEntries(
      Object.entries(red).filter(
        ([, valor]) => valor !== null && valor !== undefined,
      ),
    ),
  );
  for (const nueva of nuevas) {
    const indice = redes.findIndex((red) =>
      igual(red.platform, nueva.platform),
    );
    if (indice >= 0) {
      redes[indice] = { ...redes[indice], url: nueva.url };
    } else {
      redes.push({ platform: nueva.platform, url: nueva.url });
    }
  }
  return redes;
}

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ datos: Record<string, any> }} solicitud una solicitud de tipo `modificacion`
 * @param {{ ficha?: any }} [opciones] `ficha`: la ficha ya elegida por el mantenedor (cuando lo escrito en el formulario
 *   no se resuelve solo); sin ella se busca la que pidió la solicitud.
 * @returns {{ id: number, slug: string, patch: Record<string, any>, imagenes: { imageId?: string, logoId?: string } }}
 */
export function prepararModificacion(db, solicitud, { ficha = null } = {}) {
  const d = solicitud.datos;
  const actual = ficha ?? fichaDeLaSolicitud(db, d.ficha);
  const { columnas, modeler, perfil } = camposDeFicha(d);
  const patch = { ...columnas };

  if (d.country) {
    patch.countries = [d.country];
  }
  if (d.languages?.length) {
    patch.languages = d.languages;
  }

  const artistas = artistasConModelador(actual.artists ?? [], modeler);
  if (artistas) {
    patch.artists = artistas;
  }

  if (perfil.length) {
    patch.profile = perfilConCambios(actual.profile, perfil);
  }
  if (d.socials?.length) {
    patch.socials = redesConCambios(actual.socials, d.socials);
  }

  return { id: actual.id, slug: actual.slug, patch, imagenes: imagenesDe(d) };
}
