/**
 * Rutas de la API del VTuberDex.
 *
 * Todas las escrituras pasan por `replaceChildren`-like helpers centralizados
 * para que el panel de administración no pueda dejar datos huérfanos.
 */
import express from 'express';

import { facetCounts, getNeighbors, getVtuberBySlug, searchVtubers } from './search.mjs';
import { hashPassword, verifyPassword } from './auth.mjs';
import {
  adminListQuerySchema,
  bulkStatusSchema,
  factionCreateSchema,
  factionUpdateSchema,
  formatIssues,
  listQuerySchema,
  loginSchema,
  vtuberCreateSchema,
  vtuberUpdateSchema,
} from './validation.mjs';
import {
  MutationError,
  aplicarParche,
  crearFaccion,
  crearFicha,
  editarFaccion,
  eliminarFaccion,
  listarFacciones,
  refreshFacetCounters,
  ultimoDex,
} from './mutations.mjs';
import { UPLOADABLE_KINDS, MAX_UPLOAD_BYTES, saveUploadedImage, removeUploadedImage } from './uploads.mjs';

const splitCsv = (value) => String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);

/** Registra una acción del mantenedor para poder auditar cambios. */
function audit(db, actor, entity, entityId, action, payload) {
  db.prepare(
    'INSERT INTO audit_log (actor, entity, entity_id, action, payload) VALUES (?, ?, ?, ?, ?)',
  ).run(actor, entity, entityId ?? null, action, payload ? JSON.stringify(payload) : null);
}

/** Responde un error de mutación con el estado y el código que le corresponden. */
function responderError(res, error) {
  if (error instanceof MutationError) {
    res.status(error.status).json({ error: error.code, detail: error.detail });
    return;
  }
  res.status(500).json({ error: 'error_al_guardar', detail: error.message });
}

/** Ejecuta `fn` en una transacción; si lanza, deshace todo y relanza. */
function enTransaccion(db, fn) {
  db.exec('BEGIN');
  try {
    const resultado = fn();
    db.exec('COMMIT');
    return resultado;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
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

  /**
   * Listado del MANTENEDOR: incluye borradores y ocultos. La ruta pública solo devuelve lo
   * publicado, así que una ficha en borrador (o una carta recién creada) no podía abrirse para
   * editarla.
   */
  router.get('/admin/vtubers', requireAdmin, (req, res) => {
    const parsed = adminListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'query_invalida', issues: formatIssues(parsed.error) });
      return;
    }
    const { q, status, page, perPage } = parsed.data;
    res.json(
      searchVtubers(db, { q, page, perPage, includeHidden: true, status: status === 'all' ? null : status, sort: 'dex' }),
    );
  });

  /** Detalle por id, sin filtrar por estado: es lo que el editor abre. */
  router.get('/admin/vtubers/:id', requireAdmin, (req, res) => {
    const row = db.prepare('SELECT slug FROM vtuber WHERE id = ?').get(Number(req.params.id));
    const detail = row ? getVtuberBySlug(db, row.slug, { includeHidden: true }) : null;
    if (!detail) {
      res.status(404).json({ error: 'no_encontrado' });
      return;
    }
    res.json(detail);
  });

  /** El siguiente número libre al final de la dex, para el botón "al final". */
  router.get('/admin/dex/next', requireAdmin, (req, res) => {
    res.json({ next: ultimoDex(db) + 1 });
  });

  router.post('/admin/vtubers', requireAdmin, (req, res) => {
    const parsed = vtuberCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    try {
      const creada = enTransaccion(db, () => {
        const resultado = crearFicha(db, parsed.data);
        audit(db, req.user.username, 'vtuber', resultado.id, 'create', parsed.data);
        return resultado;
      });
      res.status(201).json(getVtuberBySlug(db, creada.slug, { includeHidden: true }));
    } catch (error) {
      responderError(res, error);
    }
  });

  router.patch('/admin/vtubers/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT id FROM vtuber WHERE id = ?').get(id);
    if (!current) {
      res.status(404).json({ error: 'no_encontrado' });
      return;
    }
    const parsed = vtuberUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    try {
      const slug = enTransaccion(db, () => {
        const resultado = aplicarParche(db, id, parsed.data);
        audit(db, req.user.username, 'vtuber', id, 'update', parsed.data);
        return resultado;
      });
      res.json(getVtuberBySlug(db, slug, { includeHidden: true }));
    } catch (error) {
      responderError(res, error);
    }
  });

  // ------------------------------------------------------------- facciones
  router.get('/admin/factions', requireAdmin, (req, res) => {
    res.json({ items: listarFacciones(db) });
  });

  router.post('/admin/factions', requireAdmin, (req, res) => {
    const parsed = factionCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    try {
      const faccion = enTransaccion(db, () => {
        const creada = crearFaccion(db, parsed.data);
        audit(db, req.user.username, 'faction', creada.id, 'create', parsed.data);
        return creada;
      });
      res.status(201).json({ faction: faccion, items: listarFacciones(db) });
    } catch (error) {
      responderError(res, error);
    }
  });

  router.patch('/admin/factions/:id', requireAdmin, (req, res) => {
    const parsed = factionUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'payload_invalido', issues: formatIssues(parsed.error) });
      return;
    }
    try {
      const id = Number(req.params.id);
      const faccion = enTransaccion(db, () => {
        const editada = editarFaccion(db, id, parsed.data);
        audit(db, req.user.username, 'faction', id, 'update', parsed.data);
        return editada;
      });
      res.json({ faction: faccion, items: listarFacciones(db) });
    } catch (error) {
      responderError(res, error);
    }
  });

  /** `DELETE /admin/factions/:id?mergeInto=<id>`: sin `mergeInto` las fichas pierden la facción. */
  router.delete('/admin/factions/:id', requireAdmin, (req, res) => {
    try {
      const id = Number(req.params.id);
      const mergeInto = req.query.mergeInto === undefined ? null : Number(req.query.mergeInto);
      if (mergeInto !== null && !Number.isInteger(mergeInto)) {
        res.status(400).json({ error: 'fusion_invalida', detail: 'mergeInto debe ser un id' });
        return;
      }
      enTransaccion(db, () => {
        eliminarFaccion(db, id, { fusionarEn: mergeInto });
        audit(db, req.user.username, 'faction', id, mergeInto === null ? 'delete' : 'merge', { mergeInto });
      });
      res.json({ ok: true, items: listarFacciones(db) });
    } catch (error) {
      responderError(res, error);
    }
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
