/**
 * Marca las fichas SIN CORREO (`sinCorreo: true`) al leer, para que la carta se pinte degradada
 * (grado 4, sin placa) y la ficha diga que falta el correo.
 *
 * El correo vive fuera del catálogo (inscripción aprobada o correo fijado a mano, en el almacén de
 * solicitudes), así que se cruza aquí y no en SQL. `correosDeFichas` resuelve todas las fichas en una
 * pasada; el resultado se recuerda unos segundos porque la lista pública se pide mucho.
 *
 * Si el almacén falla NO se marca nada: degradar todo el catálogo por una avería sería peor que no avisar.
 * Una ficha con premium (cualquier grado) conserva el suyo: la marca es solo para las que no tienen grado.
 */
import { correosDeFichas } from '../server/src/solicitudes.mjs';
import { getVtuberBySlug } from '../server/src/search.mjs';
import { ejecutorDeSolicitudes } from './solicitudes.mjs';

const TTL_MS = 30_000;
const memo = (globalThis.__vtuberdexSinCorreo ??= { hasta: 0, ids: null });

async function idsConCorreo(db, ejecutor) {
  if (memo.ids && Date.now() < memo.hasta) return memo.ids;
  const e = ejecutor ?? (await ejecutorDeSolicitudes());
  const mapa = await correosDeFichas(e, { resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }) });
  memo.ids = new Set(mapa.keys());
  memo.hasta = Date.now() + TTL_MS;
  return memo.ids;
}

/** Solo para los tests. */
export function __reiniciarSinCorreo() {
  memo.ids = null;
  memo.hasta = 0;
}

/**
 * @param {any} db base del catálogo (con el diario)
 * @param {object[]} cartas tarjetas o fichas
 * @returns {Promise<object[]>} las mismas, con `sinCorreo: true` donde corresponda
 */
export async function marcarSinCorreo(db, cartas, { ejecutor } = {}) {
  try {
    const conCorreo = await idsConCorreo(db, ejecutor);
    return cartas.map((c) => (c.premium || conCorreo.has(c.id) ? c : { ...c, sinCorreo: true }));
  } catch (error) {
    console.error(`[sin-correo] no se pudo cruzar con el almacén de correos: ${error.message}`);
    return cartas;
  }
}
