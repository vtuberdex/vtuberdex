/**
 * Rutas de la API del VTuberDex.
 *
 * Todas las escrituras pasan por `replaceChildren`-like helpers centralizados
 * para que el panel de administración no pueda dejar datos huérfanos.
 */
import express from 'express';

import { facetCounts, getNeighbors, getVtuberBySlug, searchVtubers } from './search.mjs';
import { hashPassword, verifyPassword } from './auth.mjs';
import { listQuerySchema, vtuberUpdateSchema, formatIssues, loginSchema, bulkStatusSchema } from './validation.mjs';
import { slugify, normalizeText } from './text.mjs';
import { UPLOADABLE_KINDS, MAX_UPLOAD_BYTES, saveUploadedImage, removeUploadedImage } from './uploads.mjs';

const splitCsv = (value) => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

/** Registra una acción del mantenedor para poder auditar cambios. */
function audit(db, actor, entity, entityId, action, payload) {
  db.prepare(
    'INSERT INTO audit_log (actor, entity, entity_id, action, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(actor, entity, entityId ?? null, action, payload ? JSON.stringify(payload) : null);
}

function upsertTag(db, kind, label) {
  const slug = slugify(label);
  db.prepare(
    `INSERT INTO tag (kind, slug, label, vtuber_count) VALUES (?, ?, ?, 0)
     ON CONFLICT (kind, slug) DO UPDATE SET label = excluded.label`,
  ).run(kind, slug, label);
  return db.prepare('SELECT id FROM tag WHERE kind = ? AND slug = ?').get(kind, slug).id;
}

function upsertFaction(db, label) {
  const slug = slugify(label);
  db.prepare(
    `INSERT INTO faction (slug, label, vtuber_count) VALUES (?, ?, 0)
     ON CONFLICT (slug) DO UPDATE SET label = excluded.label`,
  ).run(slug, label);
  return db.prepare('SELECT id FROM faction WHERE slug = ?').get(slug).id;
}

/** Reemplaza las relaciones multivaluadas de una carta. */
export function replaceRelations(db, vtuberId, patch) {
  if (patch.countries) {
    db.prepare('DELETE FROM vtuber_country WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_country (vtuber_id, country_id, position) VALUES (?, ?, ?)');
    patch.countries.forEach((slug, index) => {
      const country = db.prepare('SELECT id FROM country WHERE slug = ?').get(slug);
      if (!country) throw Object.assign(new Error(`país desconocido: ${slug}`), { status: 422 });
      insert.run(vtuberId, country.id, index);
    });
  }
  if (patch.languages) {
    db.prepare('DELETE FROM vtuber_language WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_language (vtuber_id, code) VALUES (?, ?)');
    patch.languages.forEach((code) => insert.run(vtuberId, code));
  }
  if (patch.groups) {
    db.prepare(`DELETE FROM vtuber_tag WHERE vtuber_id = ? AND tag_id IN (SELECT id FROM tag WHERE kind = 'group')`).run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_tag (vtuber_id, tag_id, position) VALUES (?, ?, ?)');
    patch.groups.forEach((label, index) => insert.run(vtuberId, upsertTag(db, 'group', label), index));
  }
  if (patch.artists) {
    db.prepare(`DELETE FROM vtuber_tag WHERE vtuber_id = ? AND tag_id IN (SELECT id FROM tag WHERE kind = 'artist')`).run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_tag (vtuber_id, tag_id, position) VALUES (?, ?, ?)');
    patch.artists.forEach((label, index) => insert.run(vtuberId, upsertTag(db, 'artist', label), index));
  }
  if (patch.factions) {
    db.prepare('DELETE FROM vtuber_faction WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT OR IGNORE INTO vtuber_faction (vtuber_id, faction_id, position) VALUES (?, ?, ?)');
    patch.factions.forEach((label, index) => insert.run(vtuberId, upsertFaction(db, label), index));
  }
  if (patch.profile) {
    db.prepare('DELETE FROM profile_field WHERE vtuber_id = ?').run(vtuberId);
    const insert = db.prepare('INSERT INTO profile_field (vtuber_id, label, value, position) VALUES (?, ?, ?, ?)');
    patch.profile.forEach((field, index) => insert.run(vtuberId, field.label, field.value, index));
  }
}

/** Recalcula el texto indexado en FTS para una carta. */
export function refreshSearchIndex(db, vtuberId) {
  const row = db
    .prepare(
      `SELECT v.name, v.phrase,
              (SELECT group_concat(t.label, ' ') FROM vtuber_tag vt JOIN tag t ON t.id = vt.tag_id WHERE vt.vtuber_id = v.id) AS tagText,
              (SELECT group_concat(c.name, ' ') FROM vtuber_country vc JOIN country c ON c.id = vc.country_id WHERE vc.vtuber_id = v.id) AS countryText,
              (SELECT group_concat(f.label, ' ') FROM vtuber_faction vf JOIN faction f ON f.id = vf.faction_id WHERE vf.vtuber_id = v.id) AS factionText
         FROM vtuber v WHERE v.id = ?`,
    )
    .get(vtuberId);
  if (!row) return;
  const tags = [row.tagText, row.countryText, row.factionText].filter(Boolean).join(' ');
  db.prepare('DELETE FROM vtuber_fts WHERE rowid = ?').run(vtuberId);
  db.prepare('INSERT INTO vtuber_fts (rowid, name, phrase, tags) VALUES (?, ?, ?, ?)').run(
    vtuberId,
    row.name,
    row.phrase ?? '',
    tags,
  );
}

function refreshFacetCounters(db) {
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
}

/**
 * Construye el router de la API.
 * @param {{db: import('node:sqlite').DatabaseSync, sessions: object, imageRoot: string}} deps
 */
export function createApiRouter({ db, sessions, imageRoot }) {
  const router = express.Router();

  // ---------------------------------------------------------------- catálogo
  router.get('/health', (req, res) => {
    const counts = db
      .prepare(
        `SELECT COUNT(*) AS vtubers,
                SUM(CASE WHEN has_detail = 1 THEN 1 ELSE 0 END) AS withDetail
           FROM vtuber WHERE status = 'published'`,
      )
      .get();
    res.json({ status: 'ok', ...counts, sessions: sessions.size });
  });

  router.get('/vtubers', (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'query_invalida', issues: formatIssues(parsed.error) });
      return;
    }
    const { q, countries, languages, groups, artists, factions, sort, page, perPage, language, facet } = parsed.data;
    const result = searchVtubers(db, {
      q,
      countries: splitCsv(countries),
      languages: splitCsv(languages),
      groups: splitCsv(groups),
      artists: splitCsv(artists),
      factions: splitCsv(factions),
      sort,
      page,
      perPage,
    });
    const facets = facet ? facetCounts(db, { language, q }) : null;
    res.json({ ...result, facets });
  });

  router.get('/vtubers/:slug', (req, res) => {
    const card = getVtuberBySlug(db, req.params.slug);
    if (!card) {
      res.status(404).json({ error: 'no_encontrado' });
      return;
    }
    res.json({ ...card, neighbors: getNeighbors(db, card.dexNumber) });
  });

  // --------------------------------------------------------------- facetas
  router.get('/meta', (req, res) => {
    const language = typeof req.query.language === 'string' ? req.query.language : null;
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    res.json({
      ...facetCounts(db, { language, q }),
      generatedAt: db.prepare(`SELECT value FROM meta WHERE key = 'dataset_generated_at'`).get()?.value ?? null,
    });
  });

  // ------------------------------------------------------------ mantenedor
  router.post('/admin/login', (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    const { username, password } = parsed.data;
    const user = db.prepare('SELECT id, username, password_hash, role FROM admin_user WHERE username = ?').get(username);
    if (!user || !verifyPassword(password, user.password_hash)) {
      res.status(401).json({ error: 'credenciales_invalidas' });
      return;
    }
    db.prepare(`UPDATE admin_user SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    const token = sessions.issue({ id: user.id, username: user.username, role: user.role });
    audit(db, user.username, 'admin_user', user.id, 'login', null);
    res.json({ token, user: { username: user.username, role: user.role } });
  });

  router.get('/admin/session', (req, res) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? sessions.read(token) : null;
    if (!user) {
      res.status(401).json({ error: 'no_autenticado' });
      return;
    }
    res.json({ user });
  });

  const requireAdmin = (req, res, next) => {
    const header = req.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const user = token ? sessions.read(token) : null;
    if (!user) {
      res.status(401).json({ error: 'no_autenticado' });
      return;
    }
    req.user = user;
    next();
  };

  router.patch('/admin/vtubers/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM vtuber WHERE id = ?').get(id);
    if (!current) {
      res.status(404).json({ error: 'no_encontrado' });
      return;
    }
    const parsed = vtuberUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    const patch = parsed.data;
    const columns = {
      name: 'name',
      phrase: 'phrase',
      themeColor: 'theme_color',
      birthday: 'birthday',
      height: 'height',
      hashtag: 'hashtag',
      favoriteColor: 'favorite_color',
      status: 'status',
    };
    const updates = [];
    const args = [];
    for (const [key, column] of Object.entries(columns)) {
      if (patch[key] !== undefined) {
        updates.push(`${column} = ?`);
        args.push(patch[key]);
      }
    }
    if (patch.name !== undefined) {
      updates.push('search_name = ?', 'slug = ?');
      const slug = slugify(patch.name);
      const clash = db.prepare('SELECT id FROM vtuber WHERE slug = ? AND id != ?').get(slug, id);
      if (clash) {
        res.status(409).json({ error: 'slug_duplicado', detail: slug });
        return;
      }
      args.push(normalizeText(patch.name), slug);
    }

    db.exec('BEGIN');
    try {
      if (updates.length > 0) {
        db.prepare(`UPDATE vtuber SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id);
      }
      replaceRelations(db, id, patch);
      refreshSearchIndex(db, id);
      refreshFacetCounters(db);
      audit(db, req.user.username, 'vtuber', id, 'update', patch);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      res.status(error.status ?? 500).json({ error: 'error_al_guardar', detail: error.message });
      return;
    }

    const updated = getVtuberBySlug(db, db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(id).slug, { includeHidden: true });
    res.json(updated);
  });

  // ------------------------------------------------- subida de imágenes (admin)
  // El cuerpo llega como binario crudo (`express.raw`), así que hay que subir el
  // límite SOLO en estas rutas: el JSON global está en 1 MB y una imagen lo
  // supera. El tipo se valida por contenido con `sharp` dentro de `saveUploadedImage`.
  const rawImage = express.raw({
    type: () => true,
    limit: MAX_UPLOAD_BYTES,
  });

  router.post('/admin/vtubers/:id/image/:kind', requireAdmin, rawImage, async (req, res) => {
    const id = Number(req.params.id);
    const kind = req.params.kind;
    const row = db.prepare('SELECT id, slug FROM vtuber WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'no_encontrado' });
      return;
    }
    if (!UPLOADABLE_KINDS[kind]) {
      res.status(400).json({ error: 'kind_invalido', allowed: Object.keys(UPLOADABLE_KINDS) });
      return;
    }
    try {
      const saved = await saveUploadedImage({
        buffer: req.body,
        kind,
        slug: row.slug,
        imageRoot,
        sharp: await import('sharp').then((m) => m.default),
      });
      // La ruta es canónica (data/images/<carpeta>/<slug>.webp), así que se
      // actualiza la fila existente o se crea si el VTuber no tenía ese asset.
      const existing = db.prepare('SELECT id FROM asset WHERE vtuber_id = ? AND kind = ?').get(id, kind);
      if (existing) {
        db.prepare('UPDATE asset SET path = ?, width = ?, height = ?, bytes = ? WHERE id = ?')
          .run(saved.path, saved.width, saved.height, saved.bytes, existing.id);
      } else {
        db.prepare('INSERT INTO asset (vtuber_id, kind, path, source_url, width, height, bytes) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(id, kind, saved.path, null, saved.width, saved.height, saved.bytes);
      }
      audit(db, req.user.username, 'vtuber', id, `upload-${kind}`, {
        path: saved.path,
        width: saved.width,
        height: saved.height,
        bytes: saved.bytes,
        replaced: Boolean(existing),
      });
      const updated = getVtuberBySlug(db, row.slug, { includeHidden: true });
      res.json({ ok: true, kind, asset: saved, vtuber: updated });
    } catch (error) {
      const known = ['no_es_imagen', 'archivo_vacio', 'kind_invalido', 'archivo_demasiado_grande'];
      const status = known.includes(error.message) ? 400 : 500;
      res.status(status).json({ error: error.message ?? 'error_al_subir' });
    }
  });

  router.delete('/admin/vtubers/:id/image/:kind', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const kind = req.params.kind;
    const row = db.prepare('SELECT id, slug FROM vtuber WHERE id = ?').get(id);
    if (!row) {
      res.status(404).json({ error: 'no_encontrado' });
      return;
    }
    if (!UPLOADABLE_KINDS[kind]) {
      res.status(400).json({ error: 'kind_invalido', allowed: Object.keys(UPLOADABLE_KINDS) });
      return;
    }
    const removed = await removeUploadedImage({ kind, slug: row.slug, imageRoot });
    db.prepare('DELETE FROM asset WHERE vtuber_id = ? AND kind = ?').run(id, kind);
    audit(db, req.user.username, 'vtuber', id, `remove-${kind}`, removed);
    const updated = getVtuberBySlug(db, row.slug, { includeHidden: true });
    res.json({ ok: true, kind, vtuber: updated });
  });

  router.post('/admin/vtubers/bulk-status', requireAdmin, (req, res) => {
    const parsed = bulkStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    const { ids, status } = parsed.data;
    const update = db.prepare(`UPDATE vtuber SET status = ?, updated_at = datetime('now') WHERE id = ?`);
    db.exec('BEGIN');
    try {
      ids.forEach((id) => update.run(status, id));
      refreshFacetCounters(db);
      audit(db, req.user.username, 'vtuber', null, 'bulk-status', { ids, status });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      res.status(500).json({ error: 'error_al_guardar', detail: error.message });
      return;
    }
    res.json({ updated: ids.length, status });
  });

  router.get('/admin/audit', requireAdmin, (req, res) => {
    const rows = db
      .prepare('SELECT id, actor, entity, entity_id AS entityId, action, payload, created_at AS createdAt FROM audit_log ORDER BY id DESC LIMIT 100')
      .all();
    res.json({ items: rows });
  });

  router.get('/admin/stats', requireAdmin, (req, res) => {
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN has_detail = 1 THEN 1 ELSE 0 END) AS withDetail,
                SUM(CASE WHEN status != 'published' THEN 1 ELSE 0 END) AS notPublished
           FROM vtuber`,
      )
      .get();
    const quality = db
      .prepare(`SELECT data_quality AS flags, COUNT(*) AS count FROM vtuber GROUP BY data_quality ORDER BY count DESC`)
      .all()
      .map((row) => ({ flags: JSON.parse(row.flags ?? '[]'), count: row.count }));
    const themes = db.prepare('SELECT COUNT(DISTINCT theme_color) AS n FROM vtuber').get().n;
    res.json({ totals, themes, quality });
  });

  void imageRoot;
  return router;
}

export { hashPassword };
