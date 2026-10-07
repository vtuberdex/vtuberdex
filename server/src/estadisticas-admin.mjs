/**
 * Estadísticas del panel del mantenedor (`GET /api/admin/stats`). Una sola definición para el Express
 * local y la ruta de Next: antes cada uno tenía sus tres consultas copiadas y el panel solo podía pintar
 * cuatro números sueltos.
 *
 * Todo lo del catálogo sale de SQLite con GROUP BY (regla del repo: nunca recorrer filas en JS). Lo que
 * vive en la cola de solicitudes (correos, pendientes) es opcional: sin ejecutor, `correo` y
 * `solicitudes` salen `null` y el panel los omite en vez de fallar.
 */
import { correosDeFichas, listarSolicitudes } from './solicitudes.mjs';
import { getVtuberBySlug, tienePremium } from './search.mjs';

const TOP = 10;

/**
 * Faltantes de cada ficha, calculados EN VIVO sobre la base (con el diario ya aplicado). No se usa la
 * columna `data_quality`: es una foto del scrape que ninguna edición actualiza, y en la base real las
 * 785 fichas traen `sin-color` aunque 211 tienen color, así que «datos sin fallos» salía 0 % para siempre.
 * Las imágenes no se cuentan: las que sube el mantenedor viven fuera de la tabla `asset` (Turso/disco) y
 * una ficha nueva con personaje saldría como si no lo tuviera.
 */
const FALTANTES = {
  'sin-ficha': 'v.has_detail = 0',
  'sin-stats': 'NOT EXISTS (SELECT 1 FROM stat s WHERE s.vtuber_id = v.id)',
  'sin-skills': 'NOT EXISTS (SELECT 1 FROM skill k WHERE k.vtuber_id = v.id)',
  'sin-color': "COALESCE(v.theme_color, '') = ''",
  'sin-redes': 'NOT EXISTS (SELECT 1 FROM social r WHERE r.vtuber_id = v.id)',
  'sin-historia': "COALESCE(v.phrase, '') = '' AND COALESCE(v.card_text, '') = ''",
};

/** @param {import('node:sqlite').DatabaseSync} db */
export function estadisticasDelCatalogo(db) {
  const columnas = Object.entries(FALTANTES)
    .map(([flag, condicion]) => `SUM(CASE WHEN ${condicion} THEN 1 ELSE 0 END) AS "${flag}"`)
    .join(',\n              ');
  const t = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN v.has_detail = 1 THEN 1 ELSE 0 END) AS withDetail,
              SUM(CASE WHEN v.status != 'published' THEN 1 ELSE 0 END) AS notPublished,
              SUM(CASE WHEN ${Object.values(FALTANTES).map((c) => `(${c})`).join(' OR ')} THEN 0 ELSE 1 END) AS sinProblemas,
              ${columnas}
         FROM vtuber v`,
    )
    .get();
  const total = Number(t.total ?? 0);

  const estados = { published: 0, draft: 0, hidden: 0 };
  for (const fila of db.prepare('SELECT status, COUNT(*) AS n FROM vtuber GROUP BY status').all()) {
    estados[fila.status] = Number(fila.n);
  }

  // Misma forma que antes ({ flags, count }), una entrada por faltante: el cliente las suma igual.
  const quality = Object.keys(FALTANTES)
    .map((flag) => ({ flags: [flag], count: Number(t[flag] ?? 0) }))
    .filter((fila) => fila.count > 0);

  const themes = Number(db.prepare('SELECT COUNT(DISTINCT theme_color) AS n FROM vtuber').get().n);

  const paises = db
    .prepare(
      `SELECT c.name AS name, c.flag AS flag, COUNT(DISTINCT vc.vtuber_id) AS count
         FROM vtuber_country vc JOIN country c ON c.id = vc.country_id
        GROUP BY c.id ORDER BY count DESC, c.name ASC LIMIT ${TOP}`,
    )
    .all()
    .map((fila) => ({ name: fila.name, flag: fila.flag ?? null, count: Number(fila.count) }));

  const facciones = db
    .prepare(
      `SELECT f.label AS name, COUNT(vf.vtuber_id) AS count
         FROM faction f LEFT JOIN vtuber_faction vf ON vf.faction_id = f.id
        GROUP BY f.id ORDER BY count DESC, f.label ASC LIMIT ${TOP}`,
    )
    .all()
    .map((fila) => ({ name: fila.name, count: Number(fila.count) }));

  // Una base empaquetada anterior no tiene `premium` (se abre en solo lectura): grados vacíos.
  const grados = tienePremium(db)
    ? db
        .prepare('SELECT grade, COUNT(*) AS count FROM premium GROUP BY grade')
        .all()
        .map((fila) => ({ grade: String(fila.grade), count: Number(fila.count) }))
    : [];

  return {
    totals: {
      total,
      withDetail: Number(t.withDetail ?? 0),
      notPublished: Number(t.notPublished ?? 0),
      sinProblemas: Number(t.sinProblemas ?? 0),
    },
    estados,
    themes,
    quality,
    paises,
    facciones,
    grados,
  };
}

/**
 * Lo del catálogo + lo de la cola. Un fallo de la cola no tumba el panel: se registra y esa parte sale nula.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ execute: Function, exec: Function } | null} ejecutor
 */
export async function estadisticasDelMantenedor(db, ejecutor) {
  const catalogo = estadisticasDelCatalogo(db);
  let correo = null;
  let solicitudes = null;
  if (ejecutor) {
    try {
      const correos = await correosDeFichas(ejecutor, { resolverFicha: (slug) => getVtuberBySlug(db, slug, { includeHidden: true }) });
      correo = { con: correos.size, sin: Math.max(0, catalogo.totals.total - correos.size) };
      const { pendientes } = await listarSolicitudes(ejecutor, { estado: 'pendiente' });
      solicitudes = { pendientes };
    } catch (error) {
      console.error('[admin] estadísticas sin datos de la cola de solicitudes', error);
    }
  }
  return { ...catalogo, correo, solicitudes };
}
