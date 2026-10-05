/**
 * VISTA PREVIA de una solicitud: lo que pasaría si el mantenedor la aprueba, sin escribir nada.
 *
 * POR QUÉ EXISTE: la cola mostraba los datos CRUDOS de cada solicitud (30 campos en un muro de texto) y el
 * mantenedor solo se enteraba de si se podía aprobar al pulsar «Aprobar». Así una modificación cuya ficha no
 * se encontraba (`#486 NOMBRE`) quedó atascada sin explicación ni salida. Aquí se calcula ANTES:
 *   · inscripción → ¿se puede crear?, con qué dirección, ¿ya hay una ficha con ese nombre?
 *   · modificación → qué ficha es, QUÉ CAMBIA (antes → después) y si el cambio pasa las reglas; si la ficha no se
 *     encuentra, candidatas para elegir a mano.
 *   · baja → qué ficha es (cerrar la solicitud no la toca).
 *
 * LA SIMULACIÓN ES DE VERDAD: se ejecutan las mismas funciones que aprobar (`crearFicha`, `aplicarParche`) dentro
 * de una transacción que SIEMPRE se deshace. Así «la regla rechaza esto» sale idéntico en la vista previa y al
 * aprobar, sin duplicar reglas. node:sqlite es síncrono: nada más usa la conexión entre el BEGIN y el ROLLBACK.
 *
 * Pura respecto a la red y al disco: recibe la base ya reproducida (con el diario aplicado) y una solicitud.
 */
import { fichaDeLaSolicitud, prepararModificacion } from './modificacion.mjs';
import { aplicarParche, crearFicha, MutationError } from './mutations.mjs';
import { getVtuberBySlug, searchVtubers } from './search.mjs';
import { SolicitudError, fichaDesdeInscripcion } from './solicitudes.mjs';
import { normalizeText } from './text.mjs';
import { formatIssues, vtuberCreateSchema, vtuberUpdateSchema } from './validation.mjs';

/** Mensajes de las reglas, en el idioma del mantenedor (los códigos son para las pruebas y la API). */
const MENSAJES = {
  slug_duplicado: 'Ya existe una ficha con esa dirección (slug).',
  pais_desconocido: 'El país indicado no está en el catálogo.',
  dex_ocupado: 'Ese número de dex ya lo tiene otra ficha.',
  faccion_desconocida: 'Una de las facciones no existe en el catálogo.',
  demasiadas_facciones: 'Una ficha admite como máximo dos facciones.',
  nombre_requerido: 'Falta el nombre de la ficha.',
  slug_invalido: 'La dirección (slug) no es válida.',
  no_encontrado: 'La ficha ya no existe.',
};

const ETIQUETAS = {
  phrase: 'Frase',
  cardText: 'Historia (lore)',
  themeColor: 'Color de la ficha',
  height: 'Estatura',
  birthday: 'Cumpleaños',
  hashtag: 'Hashtag de arte',
  favoriteColor: 'Color favorito',
  countries: 'País',
  languages: 'Idiomas',
  artists: 'Modelador',
};

const igual = (a, b) => normalizeText(String(a ?? '')) === normalizeText(String(b ?? ''));

function comoTexto(valor) {
  if (Array.isArray(valor)) {
    return valor
      .map((x) => (typeof x === 'string' ? x : (x?.name ?? x?.label ?? '')))
      .filter(Boolean)
      .join(', ');
  }
  return valor === null || valor === undefined ? '' : String(valor);
}

/** Corre `fn` dentro de una transacción que SIEMPRE se deshace. Devuelve el resultado o el error de las reglas. */
function simular(db, fn) {
  db.exec('BEGIN');
  try {
    return { ok: true, resultado: fn() };
  } catch (error) {
    return { ok: false, error };
  } finally {
    db.exec('ROLLBACK');
  }
}

function problemaDe(error) {
  if (error instanceof MutationError || error instanceof SolicitudError) {
    return { codigo: error.code, mensaje: MENSAJES[error.code] ?? error.detail ?? error.message };
  }
  return { codigo: 'error_inesperado', mensaje: `No se pudo comprobar: ${error?.message ?? error}` };
}

function resumenDeFicha(f) {
  return {
    id: f.id,
    slug: f.slug,
    name: f.name,
    dexNumber: f.dexNumber,
    status: f.status,
    grado: f.premium?.grade ?? null,
  };
}

/** Qué fichas se parecen a lo que escribió la persona, para elegir a mano cuando no se resuelve sola. */
export function candidatasParaReferencia(db, referencia, limite = 6) {
  const texto = String(referencia ?? '').trim();
  const dex = texto.match(/#\s*(\d{1,4})\b/)?.[1];
  const sinDex = texto.replace(/#\s*\d{1,4}\b/, ' ').replace(/\s+/g, ' ').trim();
  const q = sinDex || dex || '';
  if (!q) return [];
  try {
    return searchVtubers(db, { q, perPage: limite, includeHidden: true }).items.map(resumenDeFicha);
  } catch {
    return [];
  }
}

/** Diferencias entre la ficha actual y el parche que saldría de aprobar. Solo lo que REALMENTE cambia. */
export function cambiosDeModificacion(actual, patch) {
  const cambios = [];
  const agregar = (campo, antes, despues) => {
    if (igual(antes, despues)) return;
    cambios.push({ campo, antes, despues, nuevo: !String(antes).trim() });
  };
  for (const [clave, etiqueta] of Object.entries(ETIQUETAS)) {
    if (patch[clave] === undefined) continue;
    agregar(etiqueta, comoTexto(actual[clave]), comoTexto(patch[clave]));
  }
  if (patch.profile) {
    const antes = new Map((actual.profile ?? []).map((f) => [normalizeText(f.label), f.value]));
    for (const fila of patch.profile) agregar(`Gusto · ${fila.label}`, antes.get(normalizeText(fila.label)) ?? '', fila.value);
  }
  if (patch.socials) {
    const antes = new Map((actual.socials ?? []).map((r) => [normalizeText(r.platform), r.url]));
    for (const red of patch.socials) agregar(`Red · ${red.label ?? red.platform}`, antes.get(normalizeText(red.platform)) ?? '', red.url);
  }
  return cambios;
}

function vistaInscripcion(db, solicitud, base) {
  const datos = fichaDesdeInscripcion(solicitud);
  const parsed = vtuberCreateSchema.safeParse(datos);
  if (!parsed.success) {
    return {
      ...base,
      puedeAprobar: false,
      problema: { codigo: 'payload_invalido', mensaje: 'Los datos de la inscripción no cumplen el formato.', detalles: formatIssues(parsed.error) },
    };
  }
  const gemelas = db.prepare('SELECT slug, name, status FROM vtuber WHERE search_name = ?').all(normalizeText(parsed.data.name));
  const avisos = gemelas.map((g) => `Ya existe una ficha llamada «${g.name}» (/v/${g.slug}). Revisa que no sea un duplicado.`);
  const corrida = simular(db, () => crearFicha(db, parsed.data));
  if (!corrida.ok) return { ...base, avisos, puedeAprobar: false, problema: problemaDe(corrida.error) };
  return { ...base, avisos, creara: { name: parsed.data.name, slug: corrida.resultado.slug, estado: 'draft' } };
}

function vistaModificacion(db, solicitud, base, { fichaSlug }) {
  let ficha = null;
  try {
    ficha = fichaSlug ? getVtuberBySlug(db, fichaSlug, { includeHidden: true }) : fichaDeLaSolicitud(db, solicitud.datos.ficha);
    if (!ficha) throw new SolicitudError(404, 'ficha_no_encontrada', 'no se encontró esa ficha');
  } catch (error) {
    if (!(error instanceof SolicitudError)) throw error;
    return {
      ...base,
      puedeAprobar: false,
      problema: {
        codigo: error.code,
        mensaje: `No se encontró la ficha «${solicitud.datos.ficha}». ${error.detail === 'no se encontró esa ficha' ? 'Elige cuál es' : error.detail}.`,
      },
      candidatas: candidatasParaReferencia(db, solicitud.datos.ficha),
    };
  }

  const { patch, imagenes } = prepararModificacion(db, solicitud, { ficha });
  const parsed = vtuberUpdateSchema.safeParse(patch);
  const salida = { ...base, ficha: resumenDeFicha(ficha), imagenes };
  if (!parsed.success) {
    return { ...salida, puedeAprobar: false, problema: { codigo: 'payload_invalido', mensaje: 'Los cambios propuestos no cumplen el formato.', detalles: formatIssues(parsed.error) } };
  }
  const cambios = cambiosDeModificacion(ficha, parsed.data);
  const avisos = [];
  if (cambios.length === 0) avisos.push('No cambia nada: los valores propuestos ya coinciden con la ficha.');
  if (imagenes.imageUrl || imagenes.logoUrl) avisos.push('El avatar y el logo vienen como enlace y no se aplican solos: descárgalos y súbelos desde «Imágenes».');
  if (ficha.status !== 'published') avisos.push('La ficha no está publicada: los cambios no se verán en el catálogo hasta que lo esté.');

  const corrida = simular(db, () => aplicarParche(db, ficha.id, parsed.data));
  if (!corrida.ok) return { ...salida, cambios, avisos, puedeAprobar: false, problema: problemaDe(corrida.error) };
  return { ...salida, cambios, avisos };
}

function vistaBaja(db, solicitud, base) {
  let ficha = null;
  try {
    ficha = fichaDeLaSolicitud(db, solicitud.datos.ficha);
  } catch (error) {
    if (!(error instanceof SolicitudError)) throw error;
  }
  const avisos = ['«Marcar procesada» solo cierra la solicitud: la degradación de la ficha (cláusula de salida) se aplica aparte, desde «Premium».'];
  if (!ficha) avisos.unshift(`No se encontró la ficha «${solicitud.datos.ficha}»: ubícala a mano desde «Fichas».`);
  return { ...base, ficha: ficha ? resumenDeFicha(ficha) : null, avisos };
}

/**
 * @param {import('node:sqlite').DatabaseSync} db la base con el diario aplicado
 * @param {{ tipo: string, estado: string, datos: Record<string, any> }} solicitud
 * @param {{ fichaSlug?: string | null }} [opciones] ficha elegida a mano para una modificación
 */
export function vistaPrevia(db, solicitud, { fichaSlug = null } = {}) {
  const base = { tipo: solicitud.tipo, estado: solicitud.estado, puedeAprobar: true, problema: null, avisos: [] };
  if (solicitud.estado !== 'pendiente') return { ...base, puedeAprobar: false };
  if (solicitud.tipo === 'inscripcion') return vistaInscripcion(db, solicitud, base);
  if (solicitud.tipo === 'modificacion') return vistaModificacion(db, solicitud, base, { fichaSlug });
  return vistaBaja(db, solicitud, base);
}
