/**
 * Motor de búsqueda y facetas sobre SQLite.
 *
 * Reemplaza el buscador del origen (que hacía `scrollIntoView` a la primera
 * coincidencia del DOM y avisaba con un `alert`) por:
 *   · consultas paginadas con total real,
 *   · coincidencia difusa por tokens (FTS5) + LIKE como respaldo,
 *   · orden configurable (dex, A-Z, poder),
 *   · conteos de facetas calculados en la base, no recorriendo 785 divs.
 */
import { normalizeText } from './text.mjs';

const SORT_SQL = {
  dex: 'v.dex_number ASC',
  'dex-desc': 'v.dex_number DESC',
  name: 'v.search_name ASC',
  power: 'v.power_score DESC NULLS LAST, v.dex_number ASC',
};

/** Expresión SQL que arma el objeto VTuber de la vista de carta. */
const CARD_SELECT = `
  SELECT
    v.id, v.dex_number AS dexNumber, v.slug, v.name, v.phrase,
    v.card_text AS cardText, v.card_text_confidence AS cardTextConfidence,
    v.theme_color AS themeColor, v.secondary_color AS secondaryColor,
    v.palette AS paletteJson, v.level, v.power_score AS powerScore,
    v.exp_current AS expCurrent, v.exp_max AS expMax,
    v.has_detail AS hasDetail, v.status,
    v.birthday, v.height, v.hashtag, v.favorite_color AS favoriteColor,
    a_card.path  AS cardImage,
    a_thumb.path AS thumbImage,
    a_logo.path  AS logoImage,
    a_character.path AS characterImage,
    a_background.path AS backgroundImage,
    a_radar.path AS radarImage,
    (SELECT json_group_array(json_object('slug', c.slug, 'name', c.name, 'flag', c.flag))
       FROM (SELECT country_id FROM vtuber_country WHERE vtuber_id = v.id ORDER BY position) vc
       JOIN country c ON c.id = vc.country_id) AS countriesJson,
    (SELECT json_group_array(t.label)
       FROM (SELECT tag_id FROM vtuber_tag WHERE vtuber_id = v.id AND position >= 0 ORDER BY position) vt
       JOIN tag t ON t.id = vt.tag_id AND t.kind = 'group') AS groupsJson,
    (SELECT json_group_array(t.label)
       FROM (SELECT tag_id FROM vtuber_tag WHERE vtuber_id = v.id AND position >= 0 ORDER BY position) vt
       JOIN tag t ON t.id = vt.tag_id AND t.kind = 'artist') AS artistsJson,
    (SELECT json_group_array(f.label)
       FROM (SELECT faction_id FROM vtuber_faction WHERE vtuber_id = v.id ORDER BY position) vf
       JOIN faction f ON f.id = vf.faction_id) AS factionsJson,
    /* Facciones con su emblema: la carta 3D lo superpone como holograma. */
    (SELECT json_group_array(json_object('label', f.label, 'icon', f.icon))
       FROM (SELECT faction_id FROM vtuber_faction WHERE vtuber_id = v.id ORDER BY position) vf
       JOIN faction f ON f.id = vf.faction_id) AS factionIconsJson,
    (SELECT json_group_array(code) FROM vtuber_language WHERE vtuber_id = v.id) AS languagesJson,
    (SELECT json_group_array(value) FROM (
        SELECT value FROM stat WHERE vtuber_id = v.id AND value IS NOT NULL
        ORDER BY position LIMIT 5)) AS statsPreviewJson,
    (SELECT COUNT(*) FROM social WHERE vtuber_id = v.id) AS socialCount
  FROM vtuber v
  LEFT JOIN asset a_card   ON a_card.vtuber_id = v.id AND a_card.kind = 'card'
  LEFT JOIN asset a_thumb  ON a_thumb.vtuber_id = v.id AND a_thumb.kind = 'thumb'
  LEFT JOIN asset a_logo   ON a_logo.vtuber_id = v.id AND a_logo.kind = 'logo'
  LEFT JOIN asset a_character ON a_character.vtuber_id = v.id AND a_character.kind = 'character'
  LEFT JOIN asset a_background ON a_background.vtuber_id = v.id AND a_background.kind = 'background'
  LEFT JOIN asset a_radar  ON a_radar.vtuber_id = v.id AND a_radar.kind = 'radar'
`;

const parseJsonArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

/**
 * `node:sqlite` devuelve objetos sin prototipo. Se normalizan a objetos planos
 * para que el resto del código (y los consumidores de la API) trabajen con
 * estructuras corrientes, comparables con `deepEqual`.
 */
const plain = (row) => (row ? { ...row } : row);

/**
 * Las rutas de assets se sirven desde la raíz del sitio (`/images/...`): una
 * ruta relativa se rompería en rutas anidadas del SPA (`/v/:slug/images/...`).
 */
const toPublicPath = (value) => (value && !value.startsWith('/') && !/^https?:/.test(value) ? `/${value}` : value);

/** Fila SQL -> objeto JSON que consume la app. */
export function mapCard(row) {
  if (!row) return null;
  return {
    id: row.id,
    dexNumber: row.dexNumber,
    slug: row.slug,
    name: row.name,
    phrase: row.phrase,
    /** Texto personalizado impreso en la carta (OCR). */
    cardText: row.cardText ?? null,
    cardTextConfidence: row.cardTextConfidence ?? null,
    themeColor: row.themeColor,
    secondaryColor: row.secondaryColor,
    palette: parseJsonArray(row.paletteJson),
    level: row.level,
    powerScore: row.powerScore,
    hasDetail: Boolean(row.hasDetail),
    status: row.status,
    birthday: row.birthday,
    height: row.height,
    hashtag: row.hashtag,
    favoriteColor: row.favoriteColor,
    countries: parseJsonArray(row.countriesJson),
    groups: parseJsonArray(row.groupsJson),
    artists: parseJsonArray(row.artistsJson),
    factions: parseJsonArray(row.factionsJson),
    /** Facciones con emblema, para superponerlo como holograma en la carta. */
    factionIcons: parseJsonArray(row.factionIconsJson)
      .map((f) => ({ label: f?.label ?? null, icon: f?.icon ? toPublicPath(f.icon) : null }))
      .filter((f) => f.label),
    languages: parseJsonArray(row.languagesJson),
    statsPreview: parseJsonArray(row.statsPreviewJson).filter((value) => typeof value === 'number'),
    socialCount: row.socialCount ?? 0,
    images: {
      /**
       * El PERSONAJE normalizado al lienzo de carta. Es lo que deben usar las
       * vistas que dibujan al VTuber (la carta 3D, el listado): ya viene en la
       * proporción correcta, así que estirarla a un marco no lo deforma.
       */
      character: toPublicPath(row.characterImage),
      /**
       * El FONDO: capa opcional que la carta 3D pinta POR DETRÁS del personaje.
       * Puede ser `null` —hoy lo es en las 785 fichas, porque el tipo acaba de
       * nacer y nadie ha subido ninguna— y la carta se dibuja igual que antes.
       */
      background: toPublicPath(row.backgroundImage),
      /** La FICHA apaisada del sitio (legacy): respaldo si no hay personaje. */
      card: toPublicPath(row.cardImage),
      thumb: toPublicPath(row.thumbImage),
      logo: toPublicPath(row.logoImage),
      radar: toPublicPath(row.radarImage),
    },
  };
}

/**
 * Traduce el término de búsqueda a una expresión segura para FTS5.
 * "mizuno ark" -> `mizuno* AND ark*` (prefijos, sin sintaxis del usuario).
 */
export function buildFtsQuery(term) {
  const tokens = normalizeText(term)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0)
    .slice(0, 8);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"*`).join(' AND ');
}

/** Normaliza la lista de países pedida (acepta slug o nombre). */
function normalizeCountryFilters(values) {
  return values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => value.toLowerCase());
}

/**
 * Busca cartas con filtros facetados.
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {object} params
 */
export function searchVtubers(db, params = {}) {
  const {
    q = '',
    countries = [],
    languages = [],
    groups = [],
    artists = [],
    factions = [],
    sort = 'dex',
    page = 1,
    perPage = 24,
    includeHidden = false,
    minPower = null,
    theme = null,
  } = params;

  const where = [];
  const args = [];

  if (!includeHidden) where.push(`v.status = 'published'`);
  if (theme) {
    where.push('v.theme_color = ?');
    args.push(theme);
  }
  if (minPower !== null) {
    where.push('v.power_score >= ?');
    args.push(minPower);
  }

  const term = String(q).trim();
  if (term) {
    const ftsQuery = buildFtsQuery(term);
    const like = `%${normalizeText(term)}%`;
    if (ftsQuery) {
      where.push(`(
        v.id IN (SELECT rowid FROM vtuber_fts WHERE vtuber_fts MATCH ?)
        OR v.search_name LIKE ?
        OR v.card_text LIKE ?
        OR v.dex_number = ?
      )`);
      args.push(ftsQuery, like, like, Number(term) || -1);
    } else {
      where.push('(v.search_name LIKE ? OR v.card_text LIKE ? OR v.dex_number = ?)');
      args.push(like, like, Number(term) || -1);
    }
  }

  const countryList = normalizeCountryFilters(countries);
  if (countryList.length > 0) {
    where.push(`EXISTS (
      SELECT 1 FROM vtuber_country vc JOIN country c ON c.id = vc.country_id
      WHERE vc.vtuber_id = v.id AND (c.slug IN (${countryList.map(() => '?').join(',')})
        OR lower(c.name) IN (${countryList.map(() => '?').join(',')}))
    )`);
    args.push(...countryList, ...countryList);
  }

  if (languages.length > 0) {
    const langList = languages.flatMap((value) => String(value).split(',')).map((v) => v.trim()).filter(Boolean);
    if (langList.length > 0) {
      where.push(`EXISTS (
        SELECT 1 FROM vtuber_language vl
        WHERE vl.vtuber_id = v.id AND vl.code IN (${langList.map(() => '?').join(',')})
      )`);
      args.push(...langList);
    }
  }

  const tagFilter = (kind, values) => {
    const list = values.flatMap((value) => String(value).split(',')).map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (list.length === 0) return;
    where.push(`EXISTS (
      SELECT 1 FROM vtuber_tag vt JOIN tag t ON t.id = vt.tag_id
      WHERE vt.vtuber_id = v.id AND t.kind = ?
        AND (t.slug IN (${list.map(() => '?').join(',')}) OR lower(t.label) IN (${list.map(() => '?').join(',')}))
    )`);
    args.push(kind, ...list, ...list);
  };
  tagFilter('group', groups);
  tagFilter('artist', artists);

  if (factions.length > 0) {
    const list = factions.flatMap((value) => String(value).split(',')).map((v) => v.trim().toLowerCase()).filter(Boolean);
    if (list.length > 0) {
      where.push(`EXISTS (
        SELECT 1 FROM vtuber_faction vf JOIN faction f ON f.id = vf.faction_id
        WHERE vf.vtuber_id = v.id AND (f.slug IN (${list.map(() => '?').join(',')}) OR lower(f.label) IN (${list.map(() => '?').join(',')}))
      )`);
      args.push(...list, ...list);
    }
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const orderSql = SORT_SQL[sort] ?? SORT_SQL.dex;
  const safePerPage = Math.min(Math.max(Number(perPage) || 24, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safePerPage;

  const total = db.prepare(`SELECT COUNT(*) AS total FROM vtuber v ${whereSql}`).get(...args).total;
  const rows = db
    .prepare(`${CARD_SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT ? OFFSET ?`)
    .all(...args, safePerPage, offset);

  return {
    items: rows.map(mapCard),
    total,
    page: safePage,
    perPage: safePerPage,
    pageCount: Math.max(Math.ceil(total / safePerPage), 1),
  };
}

/**
 * Conteos de facetas para los filtros ya aplicados, respetando el idioma
 * seleccionado (así solo se ofrecen países que existen en ese idioma).
 */
export function facetCounts(db, params = {}) {
  const { language = null, q = '', includeHidden = false } = params;
  const baseArgs = [];
  const baseWhere = [];
  if (!includeHidden) baseWhere.push(`v.status = 'published'`);
  if (language) {
    baseWhere.push(`EXISTS (SELECT 1 FROM vtuber_language vl WHERE vl.vtuber_id = v.id AND vl.code = ?)`);
    baseArgs.push(language);
  }
  const term = String(q).trim();
  if (term) {
    const ftsQuery = buildFtsQuery(term);
    const like = `%${normalizeText(term)}%`;
    if (ftsQuery) {
      baseWhere.push(`(v.id IN (SELECT rowid FROM vtuber_fts WHERE vtuber_fts MATCH ?) OR v.search_name LIKE ?)`);
      baseArgs.push(ftsQuery, like);
    } else {
      baseWhere.push('v.search_name LIKE ?');
      baseArgs.push(like);
    }
  }
  const baseSql = baseWhere.length ? `WHERE ${baseWhere.join(' AND ')}` : '';

  const countries = db
    .prepare(
      `SELECT c.slug, c.name, c.flag, COUNT(DISTINCT v.id) AS count
         FROM vtuber v
         JOIN vtuber_country vc ON vc.vtuber_id = v.id
         JOIN country c ON c.id = vc.country_id
         ${baseSql}
        GROUP BY c.id ORDER BY count DESC, c.name ASC`,
    )
    .all(...baseArgs);

  const languages = db
    .prepare(
      `SELECT vl.code AS code, COALESCE(l.name, vl.code) AS name, COUNT(DISTINCT v.id) AS count
         FROM vtuber v JOIN vtuber_language vl ON vl.vtuber_id = v.id
         LEFT JOIN language l ON l.code = vl.code
         ${baseSql}
        GROUP BY vl.code ORDER BY count DESC`,
    )
    .all(...baseArgs);

  const groups = db
    .prepare(
      `SELECT t.slug, t.label AS name, COUNT(DISTINCT v.id) AS count
         FROM vtuber v JOIN vtuber_tag vt ON vt.vtuber_id = v.id
         JOIN tag t ON t.id = vt.tag_id AND t.kind = 'group'
         ${baseSql}
        GROUP BY t.id ORDER BY count DESC, t.label ASC`,
    )
    .all(...baseArgs);

  const artists = db
    .prepare(
      `SELECT t.slug, t.label AS name, COUNT(DISTINCT v.id) AS count
         FROM vtuber v JOIN vtuber_tag vt ON vt.vtuber_id = v.id
         JOIN tag t ON t.id = vt.tag_id AND t.kind = 'artist'
         ${baseSql}
        GROUP BY t.id ORDER BY count DESC, t.label ASC`,
    )
    .all(...baseArgs);

  const factions = db
    .prepare(
      `SELECT f.slug, f.label AS name, COUNT(DISTINCT v.id) AS count
         FROM vtuber v JOIN vtuber_faction vf ON vf.vtuber_id = v.id
         JOIN faction f ON f.id = vf.faction_id
         ${baseSql}
        GROUP BY f.id ORDER BY count DESC, f.label ASC`,
    )
    .all(...baseArgs);

  const totals = db
    .prepare(`SELECT COUNT(*) AS total,
                     SUM(CASE WHEN v.has_detail = 1 THEN 1 ELSE 0 END) AS withDetail,
                     COUNT(DISTINCT v.theme_color) AS themes
                FROM vtuber v ${baseSql}`)
    .get(...baseArgs);

  return { countries, languages, groups, artists, factions, totals };
}

/** Detalle completo de una carta (perfil, stats, skills, socials, assets). */
export function getVtuberBySlug(db, slug, { includeHidden = false } = {}) {
  const where = includeHidden ? '' : `AND v.status = 'published'`;
  const row = db
    .prepare(`${CARD_SELECT} WHERE v.slug = ? ${where}`)
    .get(slug);
  if (!row) return null;
  const card = mapCard(row);

  card.profile = db
    .prepare('SELECT label, value FROM profile_field WHERE vtuber_id = ? ORDER BY position')
    .all(row.id);
  card.stats = db
    .prepare('SELECT label, slug, value, value_text AS valueText, max, position FROM stat WHERE vtuber_id = ? ORDER BY position')
    .all(row.id);
  card.skills = db
    .prepare('SELECT category, section, type, name, effect, effect_html AS effectHtml, factions AS factionsJson, position FROM skill WHERE vtuber_id = ? ORDER BY position')
    .all(row.id)
    .map((skill) => ({ ...skill, factions: parseJsonArray(skill.factionsJson) }));
  card.socials = db
    .prepare('SELECT platform, label, url, icon FROM social WHERE vtuber_id = ? ORDER BY position')
    .all(row.id);
  card.assets = db
    .prepare('SELECT kind, path, source_url AS sourceUrl, width, height, bytes FROM asset WHERE vtuber_id = ?')
    .all(row.id)
    .map((asset) => ({ ...asset, path: toPublicPath(asset.path) }));
  card.experience =
    row.expCurrent === null && row.expMax === null
      ? null
      : { current: row.expCurrent, max: row.expMax };
  return card;
}

/** Vecinos de dex de una carta (para navegar sin volver al catálogo). */
export function getNeighbors(db, dexNumber) {
  const prev = db
    .prepare(`SELECT dex_number AS dexNumber, slug, name FROM vtuber WHERE dex_number < ? AND status = 'published' ORDER BY dex_number DESC LIMIT 1`)
    .get(dexNumber);
  const next = db
    .prepare(`SELECT dex_number AS dexNumber, slug, name FROM vtuber WHERE dex_number > ? AND status = 'published' ORDER BY dex_number ASC LIMIT 1`)
    .get(dexNumber);
  return { prev: plain(prev ?? null), next: plain(next ?? null) };
}
