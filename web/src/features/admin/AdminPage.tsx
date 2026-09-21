/**
 * Mantenedor: login, estadísticas de calidad y edición de fichas.
 * Reemplaza el "editar HTML a mano" del origen.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { api } from '../../lib/api';
import { cardPalette } from '../../lib/color';
import type { VtuberCard, VtuberDetail } from '../../lib/types';
import { ImageManager } from './ImageManager';

const TOKEN_KEY = 'vtuberdex.admin.token';

interface AdminStats {
  totals: { total: number; withDetail: number; notPublished: number };
  themes: number;
  quality: Array<{ flags: string[]; count: number }>;
}

const FLAG_LABELS: Record<string, string> = {
  'sin-imagen-carta': 'Sin imagen de carta',
  'sin-ficha': 'Sin ficha personal',
  'sin-stats': 'Sin atributos',
  'sin-skills': 'Sin habilidades',
  'sin-color': 'Sin color de marca',
  'sin-logo': 'Sin logo',
};

export function AdminPage() {
  const [token, setToken] = useState<string | null>(() => window.localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audit, setAudit] = useState<Array<{ id: number; actor: string; action: string; entityId: number | null; createdAt: string }>>([]);
  const [rows, setRows] = useState<VtuberCard[]>([]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<VtuberDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // Sesión guardada -> validar contra la API.
  useEffect(() => {
    if (!token) return;
    api
      .session(token)
      .then((response) => setUser(response.user))
      .catch(() => {
        window.localStorage.removeItem(TOKEN_KEY);
        setToken(null);
      });
  }, [token]);

  const loadAdmin = useCallback(async () => {
    if (!token) return;
    try {
      const [statsResponse, auditResponse] = await Promise.all([api.adminStats(token), api.audit(token)]);
      setStats(statsResponse);
      setAudit(auditResponse.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error');
    }
  }, [token]);

  useEffect(() => {
    void loadAdmin();
  }, [loadAdmin]);

  // Búsqueda del mantenedor (incluye borradores y ocultos vía API pública filtrada).
  useEffect(() => {
    if (!user) return;
    const controller = new AbortController();
    api
      .list({
        q: query,
        countries: [],
        languages: [],
        groups: [],
        artists: [],
        factions: [],
        language: null,
        sort: 'dex',
        page: 1,
        perPage: 40,
      }, controller.signal)
      .then((response) => setRows(response.items))
      .catch(() => undefined);
    return () => controller.abort();
  }, [query, user, savedAt]);

  const login = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const response = await api.login(credentials.username, credentials.password);
      window.localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setUser(response.user);
      setCredentials({ username: '', password: '' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'credenciales inválidas');
    }
  };

  const logout = () => {
    window.localStorage.removeItem(TOKEN_KEY);
    setToken(null);
    setUser(null);
    setSelected(null);
    setStats(null);
  };

  const openEditor = async (slug: string) => {
    setError(null);
    try {
      const detail = await api.detail(slug);
      setSelected(detail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error');
    }
  };

  const save = async (patch: Record<string, unknown>) => {
    if (!token || !selected) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateVtuber(token, selected.id, patch);
      setSelected(updated);
      setSavedAt(new Date().toISOString());
      await loadAdmin();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error al guardar');
    } finally {
      setSaving(false);
    }
  };

  const qualitySummary = useMemo(
    () =>
      (stats?.quality ?? [])
        .flatMap((bucket) => bucket.flags.map((flag) => ({ flag, count: bucket.count })))
        .reduce<Record<string, number>>((accumulator, item) => {
          accumulator[item.flag] = (accumulator[item.flag] ?? 0) + item.count;
          return accumulator;
        }, {}),
    [stats],
  );

  if (!user) {
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <form
          onSubmit={login}
          className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-6"
          data-testid="admin-login"
        >
          <h1 className="text-xl font-extrabold text-dex-ink">Mantenedor VTuberDex</h1>
          <p className="text-sm text-dex-muted">Inicia sesión para editar fichas, colores y visibilidad.</p>
          <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
            Usuario
            <input
              value={credentials.username}
              onChange={(event) => setCredentials((current) => ({ ...current, username: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm text-dex-ink outline-none focus:border-dex-accent"
              autoComplete="username"
            />
          </label>
          <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
            Contraseña
            <input
              type="password"
              value={credentials.password}
              onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm text-dex-ink outline-none focus:border-dex-accent"
              autoComplete="current-password"
            />
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-xl bg-dex-accent px-4 py-2.5 text-sm font-bold text-black"
            disabled={!credentials.username || !credentials.password}
          >
            Entrar
          </button>
          <p className="text-center text-xs text-dex-muted">
            <Link to="/" className="hover:text-dex-ink">
              ← Volver al catálogo
            </Link>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-dex-ink">Mantenedor</h1>
          <p className="text-sm text-dex-muted">
            Sesión de {user.username} · {user.role}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/" className="rounded-lg border border-dex-line px-3 py-2 text-xs text-dex-muted hover:text-dex-ink">
            Ver catálogo
          </Link>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-dex-line px-3 py-2 text-xs text-dex-muted hover:text-dex-ink"
          >
            Salir
          </button>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          data-testid="admin-error"
          className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {savedAt && (
        <p
          role="status"
          data-testid="admin-saved"
          className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200"
        >
          Guardado a las {new Date(savedAt).toLocaleTimeString('es-CL')}
        </p>
      )}

      {/* Métricas */}
      {stats && (
        <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'VTubers', value: stats.totals.total },
            { label: 'Con ficha completa', value: stats.totals.withDetail },
            { label: 'Sin publicar', value: stats.totals.notPublished },
            { label: 'Colores de marca', value: stats.themes },
          ].map((metric) => (
            <div key={metric.label} className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">{metric.label}</p>
              <p className="mt-1 font-mono text-2xl font-bold text-dex-ink">{metric.value}</p>
            </div>
          ))}
        </section>
      )}

      {Object.keys(qualitySummary).length > 0 && (
        <section className="mb-6 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">Calidad de datos</h2>
          <ul className="mt-3 flex flex-wrap gap-2">
            {Object.entries(qualitySummary).map(([flag, count]) => (
              <li key={flag} className="rounded-full border border-dex-line px-3 py-1 text-xs text-dex-muted">
                {FLAG_LABELS[flag] ?? flag}: <span className="font-mono text-dex-ink">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Lista */}
        <aside className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
          <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
            Buscar ficha
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm text-dex-ink outline-none focus:border-dex-accent"
              placeholder="nombre o número"
            />
          </label>
          <ul className="dex-scroll mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => openEditor(row.slug)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                    selected?.id === row.id ? 'bg-dex-accent/15 text-dex-ink' : 'text-dex-muted hover:bg-white/5'
                  }`}
                >
                  <span className="font-mono text-[11px] text-dex-muted">#{String(row.dexNumber).padStart(3, '0')}</span>
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  {row.status !== 'published' && (
                    <span className="rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200">{row.status}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {/* Editor */}
        <section className="min-w-0">
          {!selected ? (
            <div className="rounded-2xl border border-dex-line bg-dex-panel/60 px-6 py-16 text-center text-sm text-dex-muted">
              Elige una ficha de la lista para editarla.
            </div>
          ) : (
            <div className="space-y-6">
              <EditorCard
                key={selected.id}
                detail={selected}
                saving={saving}
                savedAt={savedAt}
                error={error}
                onSave={save}
              />
              {/* Gestión de imágenes: va DESPUÉS del formulario para que el botón
                  "Guardar cambios" quede al final de la edición de la ficha. */}
              {token && (
                <ImageManager
                  token={token}
                  detail={selected}
                  onUpdated={(vtuber) => {
                    // Se conserva el editor abierto: reemplazar una imagen no debe
                    // sacarte de la ficha en la que estás trabajando.
                    setSelected(vtuber);
                    void loadAdmin();
                  }}
                />
              )}
            </div>
          )}

          <section className="mt-6 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">Actividad reciente</h2>
            <ul className="mt-3 space-y-1 font-mono text-xs text-dex-muted">
              {audit.slice(0, 12).map((entry) => (
                <li key={entry.id}>
                  {entry.createdAt} · {entry.actor} · {entry.action}
                  {entry.entityId ? ` · #${entry.entityId}` : ''}
                </li>
              ))}
              {audit.length === 0 && <li key="empty">Sin registros todavía.</li>}
            </ul>
          </section>
        </section>
      </div>
    </div>
  );
}

/** Formulario de edición de una ficha. */
function EditorCard({
  detail,
  saving,
  savedAt,
  error,
  onSave,
}: {
  detail: VtuberDetail;
  saving: boolean;
  /** Marca de tiempo del último guardado, para el aviso de éxito. */
  savedAt: string | null;
  /** Mensaje de error del guardado, si lo hubo. */
  error: string | null;
  onSave: (patch: Record<string, unknown>) => void;
}) {
  const [form, setForm] = useState({
    name: detail.name,
    themeColor: detail.themeColor ?? '#5eead4',
    birthday: detail.birthday ?? '',
    height: detail.height ?? '',
    hashtag: detail.hashtag ?? '',
    favoriteColor: detail.favoriteColor ?? '',
    status: detail.status,
    phrase: detail.phrase ?? '',
  });
  const palette = cardPalette(form.themeColor, detail.secondaryColor);

  return (
    <form
      className="space-y-5 rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="admin-editor"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          name: form.name,
          themeColor: form.themeColor,
          birthday: form.birthday || null,
          height: form.height || null,
          hashtag: form.hashtag || null,
          favoriteColor: form.favoriteColor || null,
          status: form.status,
          phrase: form.phrase || null,
        });
      }}
    >
      <header className="flex items-center gap-4">
        {/* Vista previa del PERSONAJE: es la imagen de identidad del VTuber. La
            miniatura no se muestra aquí porque es una copia reducida del
            personaje, no una imagen con vida propia. */}
        {(detail.images.character ?? detail.images.card) && (
          <img
            src={(detail.images.character ?? detail.images.card) as string}
            alt=""
            className="h-20 w-16 rounded-lg object-cover ring-1 ring-dex-line"
            style={{ boxShadow: `0 0 24px ${palette.accent}44` }}
          />
        )}
        <div className="min-w-0">
          <h2 className="truncate text-lg font-extrabold text-dex-ink">{detail.name}</h2>
          <p className="font-mono text-xs text-dex-muted">
            #{String(detail.dexNumber).padStart(3, '0')} · /v/{detail.slug}
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
          Nombre
          <input
            value={form.name}
            onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm normal-case text-dex-ink outline-none focus:border-dex-accent"
          />
        </label>
        <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
          Color de marca
          <span className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={form.themeColor}
              onChange={(event) => setForm((current) => ({ ...current, themeColor: event.target.value }))}
              className="h-9 w-12 rounded border border-dex-line bg-dex-void"
            />
            <input
              value={form.themeColor}
              onChange={(event) => setForm((current) => ({ ...current, themeColor: event.target.value }))}
              pattern="^#[0-9a-fA-F]{6}$"
              className="w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-xs text-dex-ink outline-none focus:border-dex-accent"
            />
          </span>
        </label>
        {(
          [
            ['birthday', 'Cumpleaños'],
            ['height', 'Altura'],
            ['hashtag', 'Hashtag'],
            ['favoriteColor', 'Color favorito'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
            {label}
            <input
              value={form[key]}
              onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm normal-case text-dex-ink outline-none focus:border-dex-accent"
            />
          </label>
        ))}
        <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
          Visibilidad
          <select
            value={form.status}
            onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as VtuberDetail['status'] }))}
            className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm normal-case text-dex-ink outline-none focus:border-dex-accent"
          >
            <option value="published">publicado</option>
            <option value="draft">borrador</option>
            <option value="hidden">oculto</option>
          </select>
        </label>
      </div>

      <label className="block text-xs uppercase tracking-[0.14em] text-dex-muted">
        Frase de presentación
        <textarea
          value={form.phrase}
          onChange={(event) => setForm((current) => ({ ...current, phrase: event.target.value }))}
          rows={3}
          className="mt-1 w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 text-sm normal-case text-dex-ink outline-none focus:border-dex-accent"
        />
      </label>

      {/* Avisos AL FINAL del formulario, junto al botón: es donde está el foco
          cuando pulsas guardar, así que el resultado se ve sin buscar arriba. */}
      {error && (
        <p
          role="alert"
          data-testid="admin-editor-error"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}
      {savedAt && !error && (
        <p
          role="status"
          data-testid="admin-editor-saved"
          className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200"
        >
          Guardado a las {new Date(savedAt).toLocaleTimeString('es-CL')}
        </p>
      )}

      <footer className="flex items-center justify-between gap-3">
        <p className="text-xs text-dex-muted">
          {detail.profile.length} campos de ficha · {detail.stats.length} atributos · {detail.skills.length} habilidades
        </p>
        <button
          type="submit"
          disabled={saving}
          className="rounded-xl bg-dex-accent px-4 py-2 text-sm font-bold text-black disabled:opacity-50"
        >
          {saving ? 'Guardando…' : 'Guardar cambios'}
        </button>
      </footer>
    </form>
  );
}

export default AdminPage;
