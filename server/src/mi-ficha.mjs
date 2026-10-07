/**
 * «MI FICHA»: los puntos de habilidad que gana un VTuber al subir de nivel y el aviso de que subió.
 *
 * REGLA
 * -----
 * Cada nivel que la ficha gana con likes da `PUNTOS_POR_NIVEL` puntos (`experiencia.mjs`). Cada punto
 * sube UN rango una habilidad suya, hasta `RANGO_MAXIMO`. Los puntos disponibles NO se guardan: son
 * `nivelesGanados × PUNTOS_POR_NIVEL − rangos repartidos`, así que no hay una cifra que pueda quedar
 * desincronizada del nivel (misma idea que la experiencia, que es función de los likes).
 *
 * LAS HABILIDADES SE IDENTIFICAN POR SU NOMBRE, no por su `id`: el mantenedor reescribe las filas de
 * `skill` al editar una ficha y el id cambiaría. Si una habilidad se renombra o se borra, su rango
 * queda guardado pero NO cuenta (ni resta puntos): al volver a llamarse igual, reaparece.
 *
 * AVISO DE NIVEL
 * --------------
 * `reclamarAvisoDeNivel` es un único UPSERT condicional: aunque dos likes lleguen a la vez y los dos
 * vean la subida, solo UNO gana el derecho a mandar el correo. Si el envío falla se suelta
 * (`soltarAvisoDeNivel`) para que el siguiente like lo reintente en vez de perder el aviso.
 *
 * JS puro sobre un EJECUTOR `{ execute, exec }` (Turso/`file:` en producción, SQLite en los tests).
 */
import { PUNTOS_POR_NIVEL, PUNTOS_STATS_POR_NIVEL, RANGO_MAXIMO } from './experiencia.mjs';
import { normalizeText } from './text.mjs';

const DDL = `
  CREATE TABLE IF NOT EXISTS punto_habilidad (
    vtuber_id  INTEGER NOT NULL,
    clave      TEXT NOT NULL,
    rango      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (vtuber_id, clave)
  );
  CREATE TABLE IF NOT EXISTS punto_stat (
    vtuber_id  INTEGER NOT NULL,
    slug       TEXT NOT NULL,
    puntos     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (vtuber_id, slug)
  );
  CREATE TABLE IF NOT EXISTS aviso_nivel (
    vtuber_id  INTEGER PRIMARY KEY,
    nivel      INTEGER NOT NULL,
    enviado    TEXT NOT NULL
  );
`;

export class PuntosError extends Error {
  constructor(status, code, detail) {
    super(detail ?? code);
    this.name = 'PuntosError';
    this.status = status;
    this.code = code;
    this.detail = detail ?? code;
  }
}

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

/** La clave estable de una habilidad, o `null` si no tiene nombre (no se puede mejorar). */
export function claveDeHabilidad(skill) {
  const nombre = normalizeText(String(skill?.name ?? ''));
  return nombre ? `${skill.category ?? 'other'}:${nombre}` : null;
}

/** Las habilidades que se pueden mejorar: con nombre y sin repetir. */
export function habilidadesMejorables(skills) {
  const vistas = new Set();
  const salida = [];
  for (const skill of skills ?? []) {
    const clave = claveDeHabilidad(skill);
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push({ clave, name: skill.name, category: skill.category, type: skill.type ?? null, effect: skill.effect ?? null });
  }
  return salida;
}

/** Rangos guardados de una ficha, por clave. */
export async function leerRangos(ejecutor, vtuberId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute('SELECT clave, rango FROM punto_habilidad WHERE vtuber_id = ? AND rango > 0', [Number(vtuberId)]);
  return new Map(rows.map((fila) => [String(fila.clave), Math.min(RANGO_MAXIMO, Number(fila.rango))]));
}

/**
 * Cómo está el reparto: rango de cada habilidad vigente y puntos que quedan.
 * @param {{ vtuberId: number, skills: Array<object>, nivelesGanados: number }} entrada
 */
export async function estadoDePuntos(ejecutor, { vtuberId, skills, nivelesGanados }) {
  const rangos = await leerRangos(ejecutor, vtuberId);
  const habilidades = habilidadesMejorables(skills).map((h) => ({ ...h, rango: rangos.get(h.clave) ?? 0 }));
  const repartidos = habilidades.reduce((suma, h) => suma + h.rango, 0);
  const ganados = Math.max(0, Math.trunc(Number(nivelesGanados) || 0)) * PUNTOS_POR_NIVEL;
  return { habilidades, ganados, repartidos, disponibles: Math.max(0, ganados - repartidos), rangoMaximo: RANGO_MAXIMO, puntosPorNivel: PUNTOS_POR_NIVEL };
}

/**
 * Gasta UN punto en una habilidad. Lanza `PuntosError` con un motivo que la pantalla puede explicar.
 */
export async function subirHabilidad(ejecutor, { vtuberId, skills, nivelesGanados, clave }) {
  const e = await conTablas(ejecutor);
  const antes = await estadoDePuntos(e, { vtuberId, skills, nivelesGanados });
  const habilidad = antes.habilidades.find((h) => h.clave === clave);
  if (!habilidad) throw new PuntosError(404, 'habilidad_no_encontrada', 'Esa habilidad ya no está en tu ficha. Recarga la página.');
  if (antes.disponibles < 1) throw new PuntosError(409, 'sin_puntos', 'No te quedan puntos. Ganas más al subir de nivel.');
  if (habilidad.rango >= RANGO_MAXIMO) throw new PuntosError(409, 'rango_maximo', 'Esa habilidad ya está en su rango máximo.');
  // UNA sola sentencia decide: sube el rango solo si, EN ESE MOMENTO, lo repartido de las habilidades vigentes
  // es menor que lo ganado. Dos clics a la vez no pueden gastar un punto que no existe (la base los ordena).
  const claves = antes.habilidades.map((h) => h.clave);
  const escrito = await e.execute(
    `INSERT INTO punto_habilidad (vtuber_id, clave, rango)
     SELECT ?, ?, 1
      WHERE (SELECT COALESCE(SUM(rango), 0) FROM punto_habilidad WHERE vtuber_id = ? AND clave IN (${claves.map(() => '?').join(', ')})) < ?
     ON CONFLICT (vtuber_id, clave) DO UPDATE SET rango = rango + 1 WHERE rango < ?`,
    [Number(vtuberId), clave, Number(vtuberId), ...claves, antes.ganados, RANGO_MAXIMO],
  );
  if (escrito.rowsAffected === 0) {
    // Se nos adelantó otro clic: se explica con el estado de ahora.
    const ahora = await estadoDePuntos(e, { vtuberId, skills, nivelesGanados });
    if (ahora.disponibles < 1) throw new PuntosError(409, 'sin_puntos', 'No te quedan puntos. Ganas más al subir de nivel.');
    throw new PuntosError(409, 'rango_maximo', 'Esa habilidad ya está en su rango máximo.');
  }
  return estadoDePuntos(e, { vtuberId, skills, nivelesGanados });
}

/** Devuelve todos los puntos repartidos para repartirlos de nuevo. */
export async function reiniciarRangos(ejecutor, { vtuberId, skills, nivelesGanados }) {
  const e = await conTablas(ejecutor);
  await e.execute('DELETE FROM punto_habilidad WHERE vtuber_id = ?', [Number(vtuberId)]);
  return estadoDePuntos(e, { vtuberId, skills, nivelesGanados });
}

/* ------------------------------------------------------------------ stats */

/**
 * Los stats que se suben GASTANDO los puntos y cuánto vale UN punto en cada uno. Las escalas son muy distintas
 * (HP llega a 12.440, Ataque a 950): un +1 plano sería invisible, así que cada stat lleva su paso. HP y MP suben
 * también su `max` (la barra se agranda con ellos). Nivel y EXP NO están: salen de los likes. `tope` es el valor
 * máximo absoluto, solo donde lo hay (ninguno de estos hoy; queda para cuando se necesite).
 */
export const STATS_MEJORABLES = Object.freeze({
  hp: { paso: 50 },
  mp: { paso: 25 },
  attack: { paso: 5 },
  magicAttack: { paso: 5 },
  defense: { paso: 5 },
  magicDefense: { paso: 5 },
});

/**
 * Los stats que suben SOLOS con los niveles ganados con likes, sin gastar nada: `suma` cada `cada` niveles.
 * Son derivados como la experiencia (no se guardan: función de `nivelesGanados`), así que no pueden desincronizarse.
 * `tope` es el valor máximo absoluto: la Evasión no pasa de 100 y la Suerte, de 20.
 */
export const STATS_AUTOMATICOS = Object.freeze({
  speed: { cada: 10, suma: 1 },
  evasion: { cada: 10, suma: 1, tope: 100 },
  accuracy: { cada: 10, suma: 1 },
  critic: { cada: 10, suma: 1 },
  luck: { cada: 20, suma: 1, tope: 20 },
});

/** Cuánto suma un stat automático por `nivelesGanados` (0 si no lo es). Sin pasar del tope. */
export function bonoAutomatico(slug, base, nivelesGanados) {
  const regla = STATS_AUTOMATICOS[slug];
  if (!regla || !Number.isFinite(base)) return 0;
  const bono = Math.floor(Math.max(0, Math.trunc(Number(nivelesGanados) || 0)) / regla.cada) * regla.suma;
  return regla.tope === undefined ? bono : Math.max(0, Math.min(bono, regla.tope - base));
}

/** Puntos repartidos por slug de stat (solo los de stats mejorables, mayores que 0). */
export async function leerPuntosDeStats(ejecutor, vtuberId) {
  const e = await conTablas(ejecutor);
  const { rows } = await e.execute('SELECT slug, puntos FROM punto_stat WHERE vtuber_id = ? AND puntos > 0', [Number(vtuberId)]);
  return new Map(rows.filter((f) => STATS_MEJORABLES[f.slug]).map((f) => [String(f.slug), Number(f.puntos)]));
}

/** Valor de un stat con sus puntos, sin pasar del tope (si lo tiene). */
export function valorConPuntos(slug, base, puntos) {
  const regla = STATS_MEJORABLES[slug];
  if (!regla || !Number.isFinite(base)) return base;
  const valor = base + puntos * regla.paso;
  return regla.tope !== undefined ? Math.min(regla.tope, Math.max(base, valor)) : valor;
}

/**
 * Puntos que aún caben en un stat antes de su tope (infinito si no tiene). El tope cuenta desde el valor BASE
 * de la ficha, que no cambia al repartir.
 */
function cabenEn(slug, base, puntos) {
  const { paso, tope } = STATS_MEJORABLES[slug];
  if (tope === undefined) return Infinity;
  return Math.max(0, Math.floor((tope - base) / paso) - puntos);
}

/**
 * Los stats de la ficha tal como los ve «Mi ficha»: base, puntos puestos, valor resultante y si aún admiten más.
 * @param {{ vtuberId: number, stats: Array<{slug: string, label: string, value: number|null}>, nivelesGanados: number }} entrada
 */
export async function estadoDeStats(ejecutor, { vtuberId, stats, nivelesGanados }) {
  const puestos = await leerPuntosDeStats(ejecutor, vtuberId);
  const lista = [];
  for (const stat of stats ?? []) {
    const regla = STATS_MEJORABLES[stat.slug];
    if (!regla || typeof stat.value !== 'number') continue;
    const puntos = puestos.get(stat.slug) ?? 0;
    lista.push({
      slug: stat.slug,
      label: stat.label,
      base: stat.value,
      puntos,
      valor: valorConPuntos(stat.slug, stat.value, puntos),
      paso: regla.paso,
      tope: regla.tope ?? null,
      puedeSubir: cabenEn(stat.slug, stat.value, puntos) > 0,
    });
  }
  const automaticos = [];
  for (const stat of stats ?? []) {
    if (!STATS_AUTOMATICOS[stat.slug] || typeof stat.value !== 'number') continue;
    const regla = STATS_AUTOMATICOS[stat.slug];
    const bono = bonoAutomatico(stat.slug, stat.value, nivelesGanados);
    automaticos.push({ slug: stat.slug, label: stat.label, base: stat.value, bono, valor: stat.value + bono, cada: regla.cada, suma: regla.suma, tope: regla.tope ?? null });
  }
  const repartidos = lista.reduce((suma, s) => suma + s.puntos, 0);
  const ganados = Math.max(0, Math.trunc(Number(nivelesGanados) || 0)) * PUNTOS_STATS_POR_NIVEL;
  return { stats: lista, automaticos, ganados, repartidos, disponibles: Math.max(0, ganados - repartidos), puntosPorNivel: PUNTOS_STATS_POR_NIVEL };
}

/** Gasta UN punto en un stat. Mismo cerrojo que las habilidades: una sola sentencia condicional. */
export async function subirStat(ejecutor, { vtuberId, stats, nivelesGanados, slug }) {
  const e = await conTablas(ejecutor);
  const antes = await estadoDeStats(e, { vtuberId, stats, nivelesGanados });
  const stat = antes.stats.find((s) => s.slug === slug);
  if (!stat) throw new PuntosError(404, 'stat_no_encontrado', 'Ese stat no se puede subir. Recarga la página.');
  if (antes.disponibles < 1) throw new PuntosError(409, 'sin_puntos_stats', 'No te quedan puntos de stats. Ganas más al subir de nivel.');
  if (!stat.puedeSubir) throw new PuntosError(409, 'stat_maximo', 'Ese stat ya llegó a su máximo.');
  const maxPuntos = stat.puntos + cabenEn(stat.slug, stat.base, stat.puntos);
  const slugs = antes.stats.map((s) => s.slug);
  const escrito = await e.execute(
    `INSERT INTO punto_stat (vtuber_id, slug, puntos)
     SELECT ?, ?, 1
      WHERE (SELECT COALESCE(SUM(puntos), 0) FROM punto_stat WHERE vtuber_id = ? AND slug IN (${slugs.map(() => '?').join(', ')})) < ?
     ON CONFLICT (vtuber_id, slug) DO UPDATE SET puntos = puntos + 1 WHERE puntos < ?`,
    [Number(vtuberId), slug, Number(vtuberId), ...slugs, antes.ganados, Number.isFinite(maxPuntos) ? maxPuntos : 1_000_000],
  );
  if (escrito.rowsAffected === 0) {
    const ahora = await estadoDeStats(e, { vtuberId, stats, nivelesGanados });
    if (ahora.disponibles < 1) throw new PuntosError(409, 'sin_puntos_stats', 'No te quedan puntos de stats. Ganas más al subir de nivel.');
    throw new PuntosError(409, 'stat_maximo', 'Ese stat ya llegó a su máximo.');
  }
  return estadoDeStats(e, { vtuberId, stats, nivelesGanados });
}

/** Devuelve todos los puntos de stats repartidos (los de habilidades no se tocan). */
export async function reiniciarStats(ejecutor, { vtuberId, stats, nivelesGanados }) {
  const e = await conTablas(ejecutor);
  await e.execute('DELETE FROM punto_stat WHERE vtuber_id = ?', [Number(vtuberId)]);
  return estadoDeStats(e, { vtuberId, stats, nivelesGanados });
}

/**
 * Aplica a la lista de stats de una ficha pública los puntos repartidos y el bono automático por niveles: el valor sube y, en HP y MP, también el máximo
 * (la barra no puede quedar con más vida que su tope). No muta la entrada.
 */
export function aplicarPuntosAStats(stats, puestos, nivelesGanados = 0) {
  return stats.map((s) => {
    if (typeof s.value !== 'number') return s;
    const bono = bonoAutomatico(s.slug, s.value, nivelesGanados);
    if (bono) return { ...s, value: s.value + bono };
    const puntos = puestos.get(s.slug);
    if (!puntos) return s;
    const valor = valorConPuntos(s.slug, s.value, puntos);
    const sube = valor - s.value;
    return { ...s, value: valor, max: typeof s.max === 'number' ? s.max + sube : s.max };
  });
}

/**
 * ¿Le toca a esta llamada avisar de que la ficha subió a `nivel`? Solo si ganó niveles con likes
 * (`nivel > nivelBase`) y nadie avisó ya de ese nivel o uno mayor.
 */
export async function reclamarAvisoDeNivel(ejecutor, { vtuberId, nivel, nivelBase, ahora = new Date() }) {
  if (!(nivel > nivelBase)) return false;
  const e = await conTablas(ejecutor);
  const resultado = await e.execute(
    `INSERT INTO aviso_nivel (vtuber_id, nivel, enviado) VALUES (?, ?, ?)
     ON CONFLICT (vtuber_id) DO UPDATE SET nivel = excluded.nivel, enviado = excluded.enviado WHERE aviso_nivel.nivel < excluded.nivel`,
    [Number(vtuberId), Math.trunc(nivel), ahora.toISOString()],
  );
  return resultado.rowsAffected > 0;
}

/** Suelta un aviso reclamado cuyo correo no salió, para que el siguiente like lo reintente. */
export async function soltarAvisoDeNivel(ejecutor, { vtuberId, nivel }) {
  const e = await conTablas(ejecutor);
  await e.execute('DELETE FROM aviso_nivel WHERE vtuber_id = ? AND nivel = ?', [Number(vtuberId), Math.trunc(nivel)]);
}
