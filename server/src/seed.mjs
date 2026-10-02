/**
 * Importa el dataset del scraper a SQLite.
 *
 * Uso: node src/seed.mjs [--reset] [--dataset ../scraper/out/dataset.json]
 *
 * Es idempotente: vuelve a correr el scrape y este seed actualiza la base sin
 * perder los cambios hechos a mano en el mantenedor (los campos editados se
 * conservan si `--keep-edits` está presente; por defecto manda el dataset).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DB_PATH, getMeta, openDatabase, setMeta, transaction } from './db/index.mjs';
import { FACCION_ALIAS, MAX_FACCIONES } from './mutations.mjs';
import { normalizeText, slugify } from './text.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const value = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const DATASET_PATH = path.resolve(value('dataset', path.join(ROOT, 'scraper', 'out', 'dataset.json')));
const RESET = flag('reset');
const DB_PATH = value('db', DEFAULT_DB_PATH);

/** Lenguas con nombre legible para los filtros. */
const LANGUAGE_NAMES = {
  es: 'Español',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  it: 'Italiano',
  nl: 'Nederlands',
  ru: 'Русский',
  pt: 'Português',
};

const STAT_SLUGS = {
  nivel: 'level',
  exp: 'exp',
  hp: 'hp',
  mp: 'mp',
  ataque: 'attack',
  defensa: 'defense',
  'ataque magico': 'magicAttack',
  'defensa magica': 'magicDefense',
  velocidad: 'speed',
  evasion: 'evasion',
  presicion: 'accuracy',
  precision: 'accuracy',
  critico: 'critic',
  suerte: 'luck',
};

const POWERS = { attack: 1.2, magicAttack: 1.3, speed: 1.1, defense: 0.8, magicDefense: 0.9, critic: 0.6 };

/** Puntaje de "poder" usado para ordenar; 0 si la ficha no trae stats. */
function powerScore(stats) {
  if (!stats || stats.length === 0) return 0;
  const bySlug = new Map(stats.map((stat) => [stat.slug, Number(stat.value) || 0]));
  let total = 0;
  for (const [slug, weight] of Object.entries(POWERS)) {
    total += (bySlug.get(slug) ?? 0) * weight;
  }
  for (const stat of stats) {
    if (!(stat.slug in POWERS)) total += (Number(stat.value) || 0) * 0.3;
  }
  return Math.round(total);
}

function detectQualityFlags(card, detail) {
  const flags = [];
  if (!card.assets.card) flags.push('sin-imagen-carta');
  if (!detail || detail.profile?.length === 0) flags.push('sin-ficha');
  if (!detail || Object.keys(detail.stats ?? {}).length === 0) flags.push('sin-stats');
  if (!detail || (detail.skills?.length ?? 0) === 0) flags.push('sin-skills');
  if (!card.themeColor) flags.push('sin-color');
  // El logo se cuenta por el ASSET generado, no por `detail.logo`: el sitio solo
  // sirve el logo en 211 fichas, pero el resto se recorta de la carta, así que
  // había 785 logos en disco y el panel informaba "sin logo: 631".
  if (!card.assets.logo) flags.push('sin-logo');
  return flags;
}

function buildStats(payload) {
  const stats = [];
  const raw = payload.detail?.stats ?? {};
  for (const [label, rawValue] of Object.entries(raw)) {
    const slug = STAT_SLUGS[normalizeText(label)] ?? slugify(label);
    if (typeof rawValue === 'object' && rawValue !== null) {
      if (rawValue.current === null && rawValue.max === null) continue;
      stats.push({ label, slug, value: rawValue.current ?? null, valueText: null, max: rawValue.max ?? null });
      continue;
    }
    if (rawValue === null || rawValue === '') continue;
    if (typeof rawValue === 'number') {
      stats.push({ label, slug, value: rawValue, valueText: null, max: null });
    } else {
      stats.push({ label, slug, value: null, valueText: String(rawValue), max: null });
    }
  }
  return stats;
}

/** Reemplaza por completo las filas hijas de una carta. */
function replaceChildren(db, vtuberId, payload) {
  const detail = payload.detail ?? {};
  db.prepare('DELETE FROM profile_field WHERE vtuber_id = ?').run(vtuberId);
  db.prepare('DELETE FROM stat WHERE vtuber_id = ?').run(vtuberId);
  db.prepare('DELETE FROM skill WHERE vtuber_id = ?').run(vtuberId);
  db.prepare('DELETE FROM social WHERE vtuber_id = ?').run(vtuberId);
  db.prepare('DELETE FROM asset WHERE vtuber_id = ?').run(vtuberId);

  const profileStmt = db.prepare('INSERT INTO profile_field (vtuber_id, label, value, position) VALUES (?, ?, ?, ?)');
  (detail.profile ?? []).forEach((field, index) => profileStmt.run(vtuberId, field.label, field.value, index));

  const statStmt = db.prepare(
    'INSERT INTO stat (vtuber_id, label, slug, value, value_text, max, position) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const stats = buildStats(payload);
  stats.forEach((stat, index) =>
    statStmt.run(vtuberId, stat.label, stat.slug, stat.value, stat.valueText, stat.max, index),
  );

  const skillStmt = db.prepare(
    `INSERT INTO skill (vtuber_id, category, section, type, name, effect, effect_html, factions, position)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  (detail.skills ?? []).forEach((skill, index) =>
    skillStmt.run(
      vtuberId,
      skill.category ?? 'other',
      skill.section ?? null,
      skill.type ?? null,
      skill.name ?? null,
      skill.effect ?? null,
      skill.effectHtml ?? null,
      JSON.stringify(skill.factions ?? []),
      index,
    ),
  );

  const socialStmt = db.prepare('INSERT INTO social (vtuber_id, platform, label, url, icon, position) VALUES (?, ?, ?, ?, ?, ?)');
  (detail.socials ?? []).forEach((social, index) =>
    socialStmt.run(vtuberId, social.platform, social.label ?? null, social.url, social.icon ?? null, index),
  );

  const assetStmt = db.prepare('INSERT INTO asset (vtuber_id, kind, path, source_url, width, height, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const assets = payload.assets ?? {};
  /**
   * Tipos de asset del VTuber. `avatar` ES el personaje (el scraper deja el
   * personaje en `images/character/` y lo registra en `avatar`), así que no se
   * añade un `character` aparte: sería la MISMA ruta en dos filas y la API
   * devolvería la imagen por duplicado bajo dos claves.
   */
  const kinds = ['card', 'thumb', 'logo', 'character', 'radar', 'background'];
  for (const kind of kinds) {
    const assetPath = assets[kind];
    if (!assetPath) continue;
    // Las rutas del dataset vienen como `images/<carpeta>/<slug>.webp`; se guardan
    // con barra inicial para que el cliente las use como URL absoluta tal cual.
    const publicPath = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
    const absolute = path.join(ROOT, 'data', publicPath);
    let bytes = null;
    let size = { width: null, height: null };
    try {
      bytes = fs.statSync(absolute).size;
      // Las dimensiones se leen de la cabecera del WebP: antes se guardaban en
      // NULL aunque el archivo ya estuviera en disco, y eso dejaba la ficha sin
      // datos de tamaño (y hacía que una subida del mantenedor pareciera la única
      // fuente fiable de ese dato).
      size = readWebpSize(fs.readFileSync(absolute).subarray(0, 64));
    } catch {
      // asset aún no generado
    }
    assetStmt.run(
      vtuberId,
      kind,
      publicPath,
      kind === 'card' ? (payload.source?.indexImage ?? null) : null,
      size.width,
      size.height,
      bytes,
    );
  }

  return stats;
}

function upsertCountry(db, slug, payload) {
  const country = (payload.countries ?? []).find((item) => item.slug === slug);
  db.prepare(
    `INSERT INTO country (slug, name, name_en, flag, lang, vtuber_count)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT (slug) DO UPDATE SET name = excluded.name, flag = excluded.flag`,
  ).run(slug, country?.name ?? slug, country?.name ?? slug, country?.flag ?? null, (payload.languages ?? ['es'])[0]);
  return db.prepare('SELECT id FROM country WHERE slug = ?').get(slug).id;
}

function upsertTag(db, kind, label) {
  const slug = slugify(label);
  db.prepare(
    `INSERT INTO tag (kind, slug, label, vtuber_count) VALUES (?, ?, ?, 0)
     ON CONFLICT (kind, slug) DO UPDATE SET label = excluded.label`,
  ).run(kind, slug, label);
  return db.prepare('SELECT id FROM tag WHERE kind = ? AND slug = ?').get(kind, slug).id;
}

/**
 * Icono de facción: el sitio sirve los emblemas en `facciones/<Nombre>.png` y
 * `get-faction-logos.mjs` los guarda como images/faction/<slug>.png. El nombre de
 * archivo de origen no coincide con el nombre de la facción (trae sufijos de
 * variante), así que se resuelve por el archivo normalizado por slug.
 */
function factionIcon(slug) {
  const dir = path.join(ROOT, 'data', 'images', 'faction');
  if (!fs.existsSync(dir)) return null;
  const direct = path.join(dir, `${slug}.png`);
  if (fs.existsSync(direct)) return `images/faction/${slug}.png`;

  const files = fs.readdirSync(dir);
  // Variantes con sufijo numérico: primal-monarch4, netherbane2, ...
  const withSuffix = files.find((f) => new RegExp(`^${slug}\\d*\\.png$`).test(f));
  if (withSuffix) return `images/faction/${withSuffix}`;

  // El sitio tiene erratas en los nombres de archivo (`apex-dualist` para la
  // facción "Apex Duelist"), así que se prueba por prefijo común más largo.
  const stem = slug.replace(/-/g, '');
  const fuzzy = files.find((f) => {
    const s = f.replace(/\.png$/, '').replace(/\d+$/, '').replace(/-/g, '');
    return s.length > 4 && (stem.startsWith(s.slice(0, 6)) || s.startsWith(stem.slice(0, 6)));
  });
  return fuzzy ? `images/faction/${fuzzy}` : null;
}

/**
 * Lee ancho y alto de la cabecera de un WebP (VP8, VP8L o VP8X) sin dependencias.
 * Los tres formatos guardan el tamaño en sitios distintos; se leen los 30 bytes
 * de cabecera y se devuelve {width:null,height:null} si no se reconoce.
 * @param {Buffer} buf primeros bytes del archivo (>= 30)
 */
export function readWebpSize(buf) {
  const none = { width: null, height: null };
  if (!buf || buf.length < 30) return none;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return none;
  const type = buf.toString('ascii', 12, 16);
  try {
    if (type === 'VP8 ') {
      // Con pérdida: dimensiones en 16 bits tras el start code 0x9d012a.
      const w = buf.readUInt16LE(26) & 0x3fff;
      const h = buf.readUInt16LE(28) & 0x3fff;
      return { width: w, height: h };
    }
    if (type === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (type === 'VP8X') {
      const w = (buf[24] | (buf[25] << 8) | (buf[26] << 16)) + 1;
      const h = (buf[27] | (buf[28] << 8) | (buf[29] << 16)) + 1;
      return { width: w, height: h };
    }
  } catch {
    return none;
  }
  return none;
}

/** Crea o actualiza una facción junto con el emblema que le corresponde. */
function upsertFaction(db, rawLabel) {
  // Las variantes con errata del origen (`Netherbane2`…) se funden en su facción real: sin esto
  // el catálogo acumulaba 26 facciones donde existen 22.
  const label = FACCION_ALIAS[slugify(rawLabel)] ?? rawLabel;
  const slug = slugify(label);
  const icon = factionIcon(slug);
  db.prepare(
    `INSERT INTO faction (slug, label, icon, vtuber_count) VALUES (?, ?, ?, 0)
     ON CONFLICT (slug) DO UPDATE SET label = excluded.label, icon = COALESCE(excluded.icon, faction.icon)`,
  ).run(slug, label, icon);
  return db.prepare('SELECT id FROM faction WHERE slug = ?').get(slug).id;
}

export function seedDatabase({ db, dataset, reset = false }) {
  const started = Date.now();
  if (reset) {
    transaction(db, () => {
      for (const table of [
        'vtuber_country', 'vtuber_language', 'vtuber_tag', 'vtuber_faction',
        'profile_field', 'stat', 'skill', 'social', 'asset', 'vtuber',
        'country', 'language', 'tag', 'faction', 'vtuber_fts',
      ]) {
        db.exec(`DELETE FROM ${table}`);
      }
    });
  }

  const stats = { inserted: 0, updated: 0, skipped: 0 };

  // Lenguas
  const langStmt = db.prepare('INSERT INTO language (code, name) VALUES (?, ?) ON CONFLICT (code) DO UPDATE SET name = excluded.name');
  for (const [code, name] of Object.entries(LANGUAGE_NAMES)) langStmt.run(code, name);

  const findStmt = db.prepare('SELECT id FROM vtuber WHERE dex_number = ?');
  const insertStmt = db.prepare(
    `INSERT INTO vtuber (
       dex_number, slug, name, search_name, alt, phrase, phrase_html, theme_color, secondary_color,
       palette, birthday, height, hashtag, favorite_color, level, exp_current, exp_max,
       hp_current, hp_max, mp_current, mp_max, power_score, has_detail, status,
       source_index_image, source_detail_url, data_quality
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?, ?)`,
  );
  const updateStmt = db.prepare(
    `UPDATE vtuber SET
       slug = ?, name = ?, search_name = ?, alt = ?, phrase = ?, phrase_html = ?,
       theme_color = ?, secondary_color = ?, palette = ?, birthday = ?, height = ?, hashtag = ?,
       favorite_color = ?, level = ?, exp_current = ?, exp_max = ?, hp_current = ?, hp_max = ?,
       mp_current = ?, mp_max = ?, power_score = ?, has_detail = ?,
       source_index_image = ?, source_detail_url = ?, data_quality = ?, updated_at = datetime('now')
     WHERE dex_number = ?`,
  );

  transaction(db, () => {
    for (const payload of dataset.vtubers) {
      const detail = payload.detail ?? {};
      const existing = findStmt.get(payload.dexNumber);
      const rawStats = buildStats(payload);
      const hp = rawStats.find((stat) => stat.slug === 'hp');
      const mp = rawStats.find((stat) => stat.slug === 'mp');
      const quality = detectQualityFlags(payload, detail);

      const common = {
        dexNumber: payload.dexNumber,
        slug: payload.slug,
        name: payload.name,
        searchName: normalizeText(payload.name),
        alt: payload.alt ?? null,
        phrase: detail.phrase ?? null,
        phraseHtml: detail.phraseHtml ?? null,
        themeColor: detail.theme ?? null,
        secondaryColor: detail.favoriteColor ?? null,
        palette: JSON.stringify(detail.palette ?? []),
        birthday: detail.birthday ?? null,
        height: detail.height ?? null,
        hashtag: detail.hashtag ?? null,
        favoriteColor: detail.favoriteColor ?? null,
        level: detail.level ?? null,
        expCurrent: detail.experience?.current ?? null,
        expMax: detail.experience?.max ?? null,
        hpCurrent: hp?.value ?? null,
        hpMax: hp?.max ?? null,
        mpCurrent: mp?.value ?? null,
        mpMax: mp?.max ?? null,
        powerScore: powerScore(rawStats),
        hasDetail: payload.source?.hasDetail ? 1 : 0,
        sourceIndexImage: payload.source?.indexImage ?? null,
        sourceDetailUrl: payload.source?.detailUrl ?? null,
        dataQuality: JSON.stringify(quality),
      };

      let vtuberId;
      if (existing) {
        updateStmt.run(
          common.slug, common.name, common.searchName, common.alt, common.phrase, common.phraseHtml,
          common.themeColor, common.secondaryColor, common.palette, common.birthday, common.height,
          common.hashtag, common.favoriteColor, common.level, common.expCurrent, common.expMax,
          common.hpCurrent, common.hpMax, common.mpCurrent, common.mpMax, common.powerScore,
          common.hasDetail, common.sourceIndexImage, common.sourceDetailUrl, common.dataQuality,
          common.dexNumber,
        );
        vtuberId = existing.id;
        stats.updated += 1;
      } else {
        insertStmt.run(
          common.dexNumber, common.slug, common.name, common.searchName, common.alt, common.phrase,
          common.phraseHtml, common.themeColor, common.secondaryColor, common.palette, common.birthday,
          common.height, common.hashtag, common.favoriteColor, common.level, common.expCurrent,
          common.expMax, common.hpCurrent, common.hpMax, common.mpCurrent, common.mpMax,
          common.powerScore, common.hasDetail, common.sourceIndexImage, common.sourceDetailUrl,
          common.dataQuality,
        );
        vtuberId = findStmt.get(payload.dexNumber).id;
        stats.inserted += 1;
      }

      // Puentes
      db.prepare('DELETE FROM vtuber_country WHERE vtuber_id = ?').run(vtuberId);
      db.prepare('DELETE FROM vtuber_language WHERE vtuber_id = ?').run(vtuberId);
      db.prepare('DELETE FROM vtuber_tag WHERE vtuber_id = ?').run(vtuberId);
      db.prepare('DELETE FROM vtuber_faction WHERE vtuber_id = ?').run(vtuberId);

      const countryStmt = db.prepare('INSERT OR IGNORE INTO vtuber_country (vtuber_id, country_id, position) VALUES (?, ?, ?)');
      (payload.countries ?? []).forEach((country, index) =>
        countryStmt.run(vtuberId, upsertCountry(db, country.slug, payload), index),
      );

      const languageStmt = db.prepare('INSERT OR IGNORE INTO vtuber_language (vtuber_id, code) VALUES (?, ?)');
      for (const code of payload.languages ?? ['es']) {
        if (!LANGUAGE_NAMES[code]) langStmt.run(code, code);
        languageStmt.run(vtuberId, code);
      }

      const tagStmt = db.prepare('INSERT OR IGNORE INTO vtuber_tag (vtuber_id, tag_id, position) VALUES (?, ?, ?)');
      (payload.groups ?? []).forEach((label, index) => tagStmt.run(vtuberId, upsertTag(db, 'group', label), index));
      (payload.artists ?? []).forEach((label, index) => tagStmt.run(vtuberId, upsertTag(db, 'artist', label), index));

      const factionStmt = db.prepare('INSERT OR IGNORE INTO vtuber_faction (vtuber_id, faction_id, position) VALUES (?, ?, ?)');
      // Máximo dos facciones por ficha (la carta tiene dos emblemas): el origen llega a traer 4.
      // `INSERT OR IGNORE` + la clave (ficha, facción) descartan además los duplicados que
      // aparecen al fundir las variantes.
      const facciones = [...new Set((detail.factions ?? []).map((label) => FACCION_ALIAS[slugify(label)] ?? label))]
        .slice(0, MAX_FACCIONES);
      facciones.forEach((label, index) => factionStmt.run(vtuberId, upsertFaction(db, label), index));

      replaceChildren(db, vtuberId, payload);

      // Cuerpo de búsqueda full-text (nombre + frase + etiquetas + países).
      const tagText = [
        ...(payload.groups ?? []),
        ...(payload.artists ?? []),
        ...(payload.countries ?? []).map((country) => country.name),
        ...facciones,
      ].join(' ');
      db.prepare('DELETE FROM vtuber_fts WHERE rowid = ?').run(vtuberId);
      db.prepare('INSERT INTO vtuber_fts (rowid, name, phrase, tags) VALUES (?, ?, ?, ?)').run(
        vtuberId,
        payload.name,
        detail.phrase ?? '',
        tagText,
      );
    }

    // Contadores desnormalizados de facetas.
    db.exec(`
      UPDATE country SET vtuber_count = (
        SELECT COUNT(*) FROM vtuber_country vc JOIN vtuber v ON v.id = vc.vtuber_id
        WHERE vc.country_id = country.id AND v.status = 'published');
      UPDATE tag SET vtuber_count = (
        SELECT COUNT(*) FROM vtuber_tag vt JOIN vtuber v ON v.id = vt.vtuber_id
        WHERE vt.tag_id = tag.id AND v.status = 'published');
      UPDATE faction SET vtuber_count = (
        SELECT COUNT(*) FROM vtuber_faction vf JOIN vtuber v ON v.id = vf.vtuber_id
        WHERE vf.faction_id = faction.id AND v.status = 'published');
    `);

    setMeta(db, 'dataset_generated_at', dataset.generatedAt ?? '');
    setMeta(db, 'dataset_source', dataset.source ?? '');
    setMeta(db, 'seeded_at', new Date().toISOString());
  });

  return { ...stats, ms: Date.now() - started, dbPath: DB_PATH, dataset: DATASET_PATH };
}

/** Cuenta de seguridad para verificar que la importación cuadra. */
export function verifySeed(db, dataset) {
  const counts = {
    vtubers: db.prepare('SELECT COUNT(*) AS n FROM vtuber').get().n,
    expected: dataset.vtubers.length,
    countries: db.prepare('SELECT COUNT(*) AS n FROM country').get().n,
    tags: db.prepare('SELECT COUNT(*) AS n FROM tag').get().n,
    skills: db.prepare('SELECT COUNT(*) AS n FROM skill').get().n,
    assets: db.prepare('SELECT COUNT(*) AS n FROM asset').get().n,
    fts: db.prepare('SELECT COUNT(*) AS n FROM vtuber_fts').get().n,
  };
  counts.ok = counts.vtubers === counts.expected && counts.fts === counts.expected;
  return counts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`[seed] falta el dataset: ${DATASET_PATH} (corre primero el scraper)`);
    process.exit(1);
  }
  const dataset = JSON.parse(fs.readFileSync(DATASET_PATH, 'utf8'));
  const db = openDatabase(DB_PATH);
  const result = seedDatabase({ db, dataset, reset: RESET });
  const check = verifySeed(db, dataset);
  console.log(`[seed] ${JSON.stringify(result)}`);
  console.log(`[seed] verificación: ${JSON.stringify(check)}`);
  const meta = { generatedAt: getMeta(db, 'dataset_generated_at') };
  console.log(`[seed] dataset del ${meta.generatedAt}`);
  db.close();
  if (!check.ok) process.exit(2);
}
