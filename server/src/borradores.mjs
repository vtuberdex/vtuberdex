/**
 * BORRADORES de la inscripción: lo que la persona lleva escrito, guardado en el servidor y atado a su
 * CORREO VERIFICADO para que pueda cerrar la pestaña y volver (correo + código nuevo) a donde se quedó.
 *
 * Es JS puro sobre un EJECUTOR (`{ execute, exec }`), igual que `solicitudes.mjs`.
 *
 * QUÉ SE GUARDA
 * -------------
 * Solo los campos del formulario, pasados por una lista blanca (`sanearBorrador`): el servidor no
 * guarda lo que le llegue. Nunca los términos aceptados (se aceptan al enviar, con la versión vigente) ni el
 * campo trampa. Un borrador por correo (clave `email + tipo`): guardar de nuevo lo reemplaza.
 *
 * CUÁNDO SE BORRA
 * ---------------
 * Al enviar la inscripción (ya es una solicitud) y a los 60 días sin tocarlo (se purga al guardar otro,
 * sin un trabajo aparte). El correo en un borrador es un dato personal más: ver la cláusula 4 de los
 * términos.
 */
import { PERFIL_CAMPOS, SolicitudError } from './solicitudes.mjs';

export const VIDA_BORRADOR_MS = 60 * 24 * 60 * 60 * 1000;
/** Tope del JSON guardado: el formulario completo no llega ni a 20 KB. */
const MAX_BYTES = 40_000;

const DDL = `
  CREATE TABLE IF NOT EXISTS borrador (
    email       TEXT NOT NULL,
    tipo        TEXT NOT NULL,
    datos       TEXT NOT NULL,
    actualizado TEXT NOT NULL,
    PRIMARY KEY (email, tipo)
  );
`;

const tablasListas = new WeakMap();
async function conTablas(ejecutor) {
  if (!tablasListas.has(ejecutor)) {
    const promesa = Promise.resolve(ejecutor.exec(DDL)).catch((error) => {
      tablasListas.delete(ejecutor);
      throw error;
    });
    tablasListas.set(ejecutor, promesa);
  }
  await tablasListas.get(ejecutor);
  return ejecutor;
}

/** Campos de texto del formulario y su largo máximo (los mismos del esquema de la inscripción). */
const TEXTOS = {
  name: 160,
  country: 60,
  phrase: 600,
  cardText: 4000,
  themeColor: 20,
  imageUrl: 500,
  logoUrl: 500,
  zodiac: 40,
  ...Object.fromEntries(PERFIL_CAMPOS.map(([clave, max]) => [clave, max])),
};

const comoTexto = (valor, max) => (typeof valor === 'string' ? valor.slice(0, max) : '');

/**
 * Se queda solo con lo que el formulario conoce, recortado a su máximo. Lo que sobre se ignora (no es
 * error: un cliente más nuevo que el servidor no debe perder el borrador entero por un campo extra).
 * `paso` solo puede ser 3, 4 o 5: el borrador existe después de verificar el correo, y los pasos 1 y 2 son el
 * nombre con el correo y el código.
 *
 * @param {unknown} entrada
 * @returns {Record<string, any>}
 */
export function sanearBorrador(entrada) {
  /** @type {Record<string, any>} */
  const datos = entrada && typeof entrada === 'object' ? entrada : {};
  /** @type {Record<string, any>} */
  const limpio = {};
  for (const [clave, max] of Object.entries(TEXTOS)) limpio[clave] = comoTexto(datos[clave], max);
  limpio.languages = Array.isArray(datos.languages) ? datos.languages.filter((c) => typeof c === 'string').map((c) => c.slice(0, 8)).slice(0, 12) : [];
  limpio.socials = Array.isArray(datos.socials)
    ? datos.socials
        .filter((r) => r && typeof r === 'object')
        .slice(0, 10)
        .map((r) => ({ platform: comoTexto(r.platform, 40), url: comoTexto(r.url, 500) }))
    : [];
  limpio.paso = datos.paso === 5 ? 5 : datos.paso === 4 ? 4 : 3;
  return limpio;
}

/** Guarda (o reemplaza) el borrador de este correo. Devuelve la marca de tiempo. */
export async function guardarBorrador(ejecutor, { email, tipo = 'inscripcion', datos, ahora = new Date() }) {
  const limpio = sanearBorrador(datos);
  const json = JSON.stringify(limpio);
  if (json.length > MAX_BYTES) throw new SolicitudError(413, 'borrador_demasiado_grande', 'El borrador es demasiado grande para guardarlo.');
  const e = await conTablas(ejecutor);
  const marca = ahora.toISOString();
  await e.execute(
    `INSERT INTO borrador (email, tipo, datos, actualizado) VALUES (?, ?, ?, ?)
     ON CONFLICT (email, tipo) DO UPDATE SET datos = excluded.datos, actualizado = excluded.actualizado`,
    [email, tipo, json, marca],
  );
  await e.execute('DELETE FROM borrador WHERE actualizado < ?', [new Date(ahora.getTime() - VIDA_BORRADOR_MS).toISOString()]);
  return marca;
}

/** El borrador de este correo, o `null` (también si ya venció). */
export async function leerBorrador(ejecutor, { email, tipo = 'inscripcion', ahora = new Date() }) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute('SELECT datos, actualizado FROM borrador WHERE email = ? AND tipo = ?', [email, tipo]);
  if (!rows[0]) return null;
  if (String(rows[0].actualizado) < new Date(ahora.getTime() - VIDA_BORRADOR_MS).toISOString()) return null;
  try {
    return { datos: sanearBorrador(JSON.parse(rows[0].datos)), actualizado: rows[0].actualizado };
  } catch {
    return null;
  }
}

export async function borrarBorrador(ejecutor, { email, tipo = 'inscripcion' }) {
  const e = await conTablas(ejecutor);
  await e.execute('DELETE FROM borrador WHERE email = ? AND tipo = ?', [email, tipo]);
}
