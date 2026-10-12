import { rachaDe, rangoDeGrado } from './premium.mjs';

/**
 * Experiencia de un VTuber: cómo los likes la hacen subir.
 *
 * REGLA DE NEGOCIO
 * ----------------
 * Cada like que recibe la ficha suma `XP_POR_LIKE` puntos de experiencia sobre lo que la ficha ya
 * traía (la experiencia del scrape o la que escribió el mantenedor). Al llenar la barra
 * (`max`) la ficha sube de nivel, la barra se vacía y el siguiente nivel pide más.
 *
 * ES UNA FUNCIÓN DE LOS DATOS, NO UN CONTADOR GUARDADO. La experiencia y el nivel que ve el
 * visitante se CALCULAN con el número de likes en el momento de leer: no hay una segunda cifra
 * que pueda quedar desincronizada de los likes, y cambiar `XP_POR_LIKE` o la curva reescribe
 * toda la historia sin migrar nada. Es JavaScript puro (sin Node ni DOM) para que el servidor y
 * las pruebas la compartan.
 *
 * LA CURVA
 * --------
 * El primer nivel pide lo que ya dice la ficha (`max`, o 100 si no tiene); desde ahí cada nivel
 * pide `BASE_NIVEL + PASO_NIVEL x (nivel - 1)`, y nunca MENOS que el anterior: una ficha del
 * scrape con `max = 500` no puede bajar a 250 al subir de nivel.
 *
 * EL CONTADOR TOTAL NO SE BORRA (como en Ragnarok Online)
 * -------------------------------------------------------
 * La barra se vacía al subir de nivel (`current`), pero `total` es la experiencia ACUMULADA de toda
 * la vida de la ficha: lo que ya valían los niveles anteriores según la curva, más lo de la barra,
 * más los likes. Nunca baja y no se reinicia: es lo que la persona ve crecer aunque la barra vuelva
 * a cero. Es otra función de los mismos datos, no un segundo contador guardado.
 *
 * PUNTOS DE HABILIDAD
 * -------------------
 * Cada nivel que la ficha GANA con likes da `PUNTOS_POR_NIVEL` puntos para subir sus habilidades
 * (`nivelesGanados`). Se cuentan desde el nivel que traía la ficha (el del scrape o el del
 * mantenedor): las 785 fichas no nacen con cientos de puntos por un nivel que no ganaron aquí.
 * Cuántos se gastaron y en qué vive en `server/src/mi-ficha.mjs`.
 *
 * XP DEL JUEGO (Minecraft)
 * ------------------------
 * La titular de una ficha puede vincular su cuenta de Minecraft y lo que gana jugando llega como
 * `xpJuego` (`server/src/minecraft.mjs`, un libro de eventos con tope diario). Se SUMA a la barra igual
 * que la de los likes: sigue siendo una función de los datos (likes + libro), no un contador aparte, así
 * que los niveles ganados, los puntos y el aviso de subida salen solos sin tocar nada más.
 */

/** Puntos de experiencia por like. */
export const XP_POR_LIKE = 10;
/** Experiencia que pide el nivel 1 cuando la ficha no trae una. */
export const BASE_NIVEL = 100;
/** Cuánto más pide cada nivel que el anterior. */
export const PASO_NIVEL = 50;
/** Puntos de habilidad que da cada nivel ganado. */
export const PUNTOS_POR_NIVEL = 3;
/** Rango máximo de una habilidad: con 3 puntos por nivel, 5 rangos se alcanzan sin que sea eterno ni trivial. */
export const RANGO_MAXIMO = 5;
/**
 * Puntos de STATS que da cada nivel ganado. Es una bolsa APARTE de la de habilidades (`PUNTOS_POR_NIVEL`):
 * no se mezclan ni se compensan; cada una se gasta solo en lo suyo. Qué vale un punto en cada stat y sus
 * topes viven en `STATS_MEJORABLES` (`server/src/mi-ficha.mjs`).
 */
export const PUNTOS_STATS_POR_NIVEL = 10;
/**
 * XP de juego que puede sumar una ficha en un día (de Chile). Diez likes = 100 XP; el tope equivale a 30
 * likes al día: jugar mucho ayuda, pero no deja a los likes de adorno ni premia un bot con la sesión abierta.
 */
export const XP_JUEGO_MAX_DIA = 300;
/**
 * XP que una ficha puede sumar al día SOLO por entregas del plugin de Minecraft (motivo `entrega`), aparte y ADEMÁS de
 * `XP_JUEGO_MAX_DIA`. Es lo que hace rentable el trabajo de repartidor (llevar paquetes en la mochila, cruzar zonas de
 * varados) sin abrir la puerta a que matar mobs rinda más: cada tope cuenta solo lo suyo.
 */
export const XP_ENTREGA_MAX_DIA = 600;
/**
 * LA EXPERIENCIA DE UNA FICHA (la fórmula única, sin ajustes a mano)
 * ------------------------------------------------------------------
 * `experienciaDeFicha` IGNORA el nivel y la barra que traiga la ficha (scrape o mantenedor): esos números eran
 * manuales y desparejos. Todo sale de cuatro datos medibles, y cada constante de abajo es la única perilla:
 *
 *   base  = likes x XP_POR_LIKE + min(días, ANTIGUEDAD_TOPE_DIAS) x XP_POR_DIA + xpJuego
 *   total = round(base x multiplicadorPremium(grado)) + min(meses de racha, RACHA_TOPE_MESES) x XP_POR_MES_RACHA
 *
 * Nerf: lo que no son likes tiene tope (antigüedad 365 días = 1095 XP, racha 12 meses = 600 XP, juego 300/día),
 * así que a la larga mandan los likes. Equilibrio: el premium multiplica de x1,05 (grado 6) a x1,50 (BL), un
 * paso de 0,05 por posición en `GRADOS`; los grados degradados y las fichas normales no multiplican.
 */
/** XP por día desde el alta de la ficha en el sitio. */
export const XP_POR_DIA = 3;
/** Días de antigüedad que cuentan: pasado este tope la antigüedad deja de dar XP. */
export const ANTIGUEDAD_TOPE_DIAS = 365;
/** XP por mes seguido de donación (la racha de `rachaDe`). */
export const XP_POR_MES_RACHA = 50;
/** Meses de racha que cuentan. */
export const RACHA_TOPE_MESES = 12;
/** Cuánto suma al multiplicador cada posición de la escala premium. */
export const PASO_MULTIPLICADOR_PREMIUM = 0.05;

/** Multiplicador de XP de un grado: 1 sin premium (o degradado), 1,05 en el 6 … 1,45 en el 10 y 1,50 en la BL. */
export function multiplicadorPremium(grado) {
  const rango = rangoDeGrado(grado);
  return rango < 0 ? 1 : 1 + PASO_MULTIPLICADOR_PREMIUM * (rango + 1);
}

/** Días enteros desde `desde` (`AAAA-MM-DD` o `AAAA-MM-DD HH:MM:SS`, UTC) hasta `hasta`; 0 si falta una o es futura. */
export function diasEntre(desde, hasta = new Date()) {
  const texto = String(desde ?? '').trim().replace(' ', 'T');
  const inicio = Date.parse(texto.includes('T') ? `${texto}Z` : `${texto}T00:00:00Z`);
  const fin = hasta instanceof Date ? hasta.getTime() : Date.parse(hasta);
  return Number.isFinite(inicio) && Number.isFinite(fin) ? Math.max(0, Math.floor((fin - inicio) / 86_400_000)) : 0;
}

/**
 * Experiencia de una ficha desde cero (nivel 1, barra vacía) con la fórmula de arriba.
 *
 * @param {{ likes?: number, xpJuego?: number, dias?: number, premium?: { grade: string, since: string, gradedAt: string }|null, ahora?: string }} datos
 *   `dias` es la antigüedad en el sitio; `ahora` (`AAAA-MM-DD`) fija la fecha de la racha.
 * @returns lo mismo que `experienciaConLikes`, más `desglose` con lo que aportó cada fuente.
 */
export function experienciaDeFicha({ likes = 0, xpJuego = 0, dias = 0, premium = null, ahora } = {}) {
  const totalLikes = Math.max(0, entero(likes, 0));
  const xpLikes = totalLikes * XP_POR_LIKE;
  const xpAntiguedad = Math.min(Math.max(0, entero(dias, 0)), ANTIGUEDAD_TOPE_DIAS) * XP_POR_DIA;
  const xpPartida = Math.max(0, entero(xpJuego, 0));
  const multiplicador = multiplicadorPremium(premium?.grade);
  const xpRacha = Math.min(rachaDe(premium, ahora), RACHA_TOPE_MESES) * XP_POR_MES_RACHA;
  const total = Math.round((xpLikes + xpAntiguedad + xpPartida) * multiplicador) + xpRacha;
  const exp = experienciaConLikes({}, 0, total);
  return { ...exp, likes: totalLikes, desglose: { likes: xpLikes, antiguedad: xpAntiguedad, juego: xpPartida, multiplicador, racha: xpRacha, total } };
}

/** Tope de niveles por cálculo: corta cualquier entrada absurda (`max` ínfimo, likes enormes). */
const MAX_NIVELES_POR_CALCULO = 100_000;

/** Experiencia que pide un nivel (sin tener en cuenta el `max` propio de la ficha). */
export function umbralDeNivel(nivel) {
  return BASE_NIVEL + PASO_NIVEL * (Math.max(1, nivel) - 1);
}

const entero = (valor, porDefecto) => (Number.isFinite(Number(valor)) && valor !== null ? Math.trunc(Number(valor)) : porDefecto);

/**
 * Nivel y barra de experiencia resultantes de sumar `likes` a la base de la ficha.
 *
 * @param {{ level?: number|null, current?: number|null, max?: number|null }} base
 * @param {number} likes
 * @param {number} [xpJuego] XP ganada jugando (Minecraft); se suma a la barra como la de los likes.
 * @returns {{ level: number, current: number, max: number, total: number, nivelesGanados: number, likes: number, xpPorLike: number }}
 */
export function experienciaConLikes(base, likes, xpJuego = 0) {
  const totalLikes = Math.max(0, entero(likes, 0));
  const extra = Math.max(0, entero(xpJuego, 0));
  let nivel = Math.max(1, entero(base?.level, 1));
  const nivelBase = nivel;
  let max = Math.max(1, entero(base?.max, 0) || umbralDeNivel(nivel));
  const actualBase = Math.max(0, entero(base?.current, 0));
  let actual = actualBase + totalLikes * XP_POR_LIKE + extra;
  // Lo que valieron los niveles que la ficha ya traía + su barra + los likes + el juego: no se reinicia nunca.
  let total = actualBase + totalLikes * XP_POR_LIKE + extra;
  for (let n = 1; n < nivelBase; n += 1) total += umbralDeNivel(n);
  for (let vueltas = 0; actual >= max && vueltas < MAX_NIVELES_POR_CALCULO; vueltas += 1) {
    actual -= max;
    nivel += 1;
    max = Math.max(max, umbralDeNivel(nivel));
  }
  return { level: nivel, current: actual, max, total, nivelesGanados: nivel - nivelBase, likes: totalLikes, xpPorLike: XP_POR_LIKE };
}
