/**
 * De un slug que manda el navegador a un ID de ficha PÚBLICA, o `null`.
 *
 * POR QUÉ: las estadísticas cuentan qué fichas se ven, y el slug viene del cliente, o sea, de cualquiera. No se
 * puede contar tal cual: un texto inventado crearía un contador nuevo por cada valor (y el slug de una baja no debe
 * ni confirmarse). Aquí se valida contra el catálogo con las MISMAS reglas que `/v/:slug`: publicada, no dada de baja
 * (grado 1) y los slugs antiguos (`slug_alias`) siguen resolviendo. Lo que sale es el id interno: el slug no se
 * guarda en ningún sitio.
 *
 * Con caché corta (positiva y negativa) y tope: un latido cada 20 s por pestaña no puede ser una consulta cada vez.
 */
import { dbConDiario } from './diario.mjs';

const POSITIVO_MS = 10 * 60_000;
const NEGATIVO_MS = 60_000;
const MAX_CACHE = 2_000;
const SLUG_VALIDO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const GRADO_DE_BAJA = '1';

const CLAVE = Symbol.for('vtuberdex.ficha-id');
const cache = () => (globalThis[CLAVE] ??= new Map());

/** Para los tests: olvida la caché. */
export function __reiniciarFichaId() {
  delete globalThis[CLAVE];
}

function buscar(db, slug) {
  const publica = (fila) => (fila && fila.status === 'published' && fila.grade !== GRADO_DE_BAJA ? Number(fila.id) : null);
  const consultas = [
    // Con la tabla de premium (donde vive el grado de baja)…
    `SELECT v.id, v.status, p.grade FROM vtuber v LEFT JOIN premium p ON p.vtuber_id = v.id WHERE v.slug = ?`,
    `SELECT v.id, v.status, p.grade FROM slug_alias a JOIN vtuber v ON v.id = a.vtuber_id LEFT JOIN premium p ON p.vtuber_id = v.id WHERE a.slug = ?`,
  ];
  // …y sin ella, para una base empaquetada anterior que todavía no la tiene.
  const sinPremium = [
    `SELECT v.id, v.status, NULL AS grade FROM vtuber v WHERE v.slug = ?`,
    `SELECT v.id, v.status, NULL AS grade FROM slug_alias a JOIN vtuber v ON v.id = a.vtuber_id WHERE a.slug = ?`,
  ];
  for (const lote of [consultas, sinPremium]) {
    try {
      for (const sql of lote) {
        const fila = db.prepare(sql).get(slug);
        // Si la fila existe se decide ahí: una ficha que no es pública no se busca además por alias (sería la misma).
        if (fila) return publica(fila);
      }
      return null;
    } catch {
      /* sin la tabla de premium: se prueba el siguiente lote */
    }
  }
  return null;
}

/**
 * @param {unknown} slug lo que mandó el navegador (sin confiar en nada)
 * @param {{ db?: any, ahora?: number }} [opciones]
 * @returns {Promise<number | null>}
 */
export async function idDeFichaPublica(slug, { db = null, ahora = Date.now() } = {}) {
  if (typeof slug !== 'string' || slug.length > 120 || !SLUG_VALIDO.test(slug)) return null;
  const c = cache();
  const hit = c.get(slug);
  if (hit && hit.hasta > ahora) return hit.id;

  const base = db ?? (await dbConDiario({ ttlMs: 60_000 }));
  const id = buscar(base, slug);
  if (c.size >= MAX_CACHE) c.delete(c.keys().next().value);
  c.set(slug, { id, hasta: ahora + (id === null ? NEGATIVO_MS : POSITIVO_MS) });
  return id;
}

/**
 * Nombres para mostrar de unos ids. Una ficha retirada o no publicada NO muestra su nombre (en una baja es secreto).
 * @param {unknown[]} ids
 * @param {{ db?: any }} [opciones]
 * @returns {Promise<Map<number, { id: number, nombre: string, dex: number | null, slug: string | null }>>}
 */
export async function nombresDeFichas(ids, { db = null } = {}) {
  const unicos = [...new Set(ids.filter((n) => Number.isInteger(n) && n > 0))].slice(0, 100);
  if (!unicos.length) return new Map();
  const base = db ?? (await dbConDiario({ ttlMs: 60_000 }));
  const marcas = unicos.map(() => '?').join(',');
  let filas;
  try {
    filas = base.prepare(`SELECT v.id, v.name, v.slug, v.dex_number AS dex, v.status, p.grade FROM vtuber v LEFT JOIN premium p ON p.vtuber_id = v.id WHERE v.id IN (${marcas})`).all(...unicos);
  } catch {
    filas = base.prepare(`SELECT v.id, v.name, v.slug, v.dex_number AS dex, v.status, NULL AS grade FROM vtuber v WHERE v.id IN (${marcas})`).all(...unicos);
  }
  return new Map(
    filas.map((f) => {
      const visible = f.status === 'published' && f.grade !== GRADO_DE_BAJA;
      return [Number(f.id), visible ? { id: Number(f.id), nombre: f.name, dex: Number(f.dex), slug: f.slug } : { id: Number(f.id), nombre: 'Ficha retirada', dex: null, slug: null }];
    }),
  );
}
