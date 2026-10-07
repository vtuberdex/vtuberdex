/**
 * Marcas que se cruzan al leer, porque viven fuera del catálogo:
 *  - `sinCorreo: true`: la ficha no tiene correo (la carta se pinta con desgaste, grado 6, sin placa).
 *  - `graduado: true`: la persona se graduó. Es solo una marca y EXCLUYE de `sinCorreo`: no hay a quién
 *    pedirle el correo.
 *
 * El correo está en el almacén de solicitudes (inscripción aprobada o correo fijado a mano) y la lista de
 * graduados junto a él; `correosDeFichas` resuelve todas las fichas en una pasada y el resultado se recuerda
 * unos segundos porque la lista pública se pide mucho.
 *
 * Si el almacén falla NO se marca nada: degradar todo el catálogo por una avería sería peor que no avisar.
 * Una ficha con premium (cualquier grado) conserva el suyo: `sinCorreo` es solo para las que no tienen grado.
 */
import { correosDeFichas, idsGraduados } from '../server/src/solicitudes.mjs';
import { getVtuberBySlug } from '../server/src/search.mjs';
import { ejecutorDeSolicitudes } from './solicitudes.mjs';

const TTL_MS = 30_000;
const memo = (globalThis.__vtuberdexSinCorreo ??= { hasta: 0, conCorreo: null, graduados: null });

async function cargar(db, ejecutor) {
  if (memo.conCorreo && Date.now() < memo.hasta) return memo;
  const e = ejecutor ?? (await ejecutorDeSolicitudes());
  const mapa = await correosDeFichas(e, { resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }) });
  memo.graduados = await idsGraduados(e);
  memo.conCorreo = new Set(mapa.keys());
  memo.hasta = Date.now() + TTL_MS;
  return memo;
}

/** Solo para los tests. */
export function __reiniciarSinCorreo() {
  memo.conCorreo = null;
  memo.graduados = null;
  memo.hasta = 0;
}

/**
 * @param {any} db base del catálogo (con el diario)
 * @param {object[]} cartas tarjetas o fichas
 * @returns {Promise<object[]>} las mismas, con `graduado` / `sinCorreo` donde corresponda
 */
export async function marcarSinCorreo(db, cartas, { ejecutor } = {}) {
  try {
    const { conCorreo, graduados } = await cargar(db, ejecutor);
    return cartas.map((c) => {
      if (graduados.has(c.id)) return { ...c, graduado: true };
      return c.premium || conCorreo.has(c.id) ? c : { ...c, sinCorreo: true };
    });
  } catch (error) {
    console.error(`[sin-correo] no se pudo cruzar con el almacén de correos: ${error.message}`);
    return cartas;
  }
}
