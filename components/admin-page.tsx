'use client';
/**
 * Mantenedor: orquestador. Login, métricas, lista, facciones y editor.
 * Reemplaza el "editar HTML a mano" del origen. Cada pieza del editor vive en
 * `components/admin/`; aquí solo está el estado que comparten (sesión, ficha
 * seleccionada, catálogo de facciones) y el guardado.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { facetValue, type FactionRow, type VtuberDetail, type VtuberPatch } from '@/lib/types';
import { DEFAULT_SEARCH } from '@/lib/query';
import { EditorCard, type SaveFailure } from '@/components/admin/editor-card';
import { FactionManager } from '@/components/admin/faction-manager';
import { NewCardDialog } from '@/components/admin/new-card-dialog';
import { VtuberList } from '@/components/admin/vtuber-list';
import type { ChipOption } from '@/components/admin/chip-picker';
import { ImageManager } from '@/components/image-manager';

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
  // El token se lee del `localStorage` en un `useEffect`, NO en el inicializador
  // del estado. Este componente es de cliente ('use client'), pero Next lo
  // renderiza igualmente en el SERVIDOR para mandar el HTML inicial, y ahí
  // `window` no existe: accederlo durante el render daba
  // "ReferenceError: window is not defined" y la página entera respondía 500.
  // Con `useState(null)` + efecto, el HTML sale sin sesión y el cliente decide.
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<{ username: string; role: string } | null>(null);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [audit, setAudit] = useState<Array<{ id: number; actor: string; action: string; entityId: number | null; createdAt: string }>>([]);
  const [factions, setFactions] = useState<FactionRow[]>([]);
  const [countryOptions, setCountryOptions] = useState<ChipOption[]>([]);
  const [languageOptions, setLanguageOptions] = useState<ChipOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [createdNotice, setCreatedNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);
  /** Sube solo tras un guardado exitoso: remonta el editor con lo que devolvió el servidor. */
  const [editorVersion, setEditorVersion] = useState(0);
  const [selected, setSelected] = useState<VtuberDetail | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  // El token se lee al MONTAR, no durante el render: en el servidor no hay
  // `localStorage`. Este efecto corre solo en el cliente.
  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (stored) setToken(stored);
  }, []);

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

  // Catálogo de facciones y opciones de país/idioma para los selectores del editor.
  const loadFactions = useCallback(async () => {
    if (!token) return;
    try {
      setFactions((await api.factions(token)).items);
    } catch {
      // El editor sigue funcionando sin selector de facciones; el panel mostrará su propio error al operar.
    }
  }, [token]);

  useEffect(() => {
    if (!user || !token) return;
    void loadFactions();
    // Las facetas salen de la API pública (`facet=all`): una página de 1 ficha basta.
    api
      .list({ ...DEFAULT_SEARCH, perPage: 1 })
      .then((response) => {
        setCountryOptions((response.facets?.countries ?? []).map((bucket) => ({ value: facetValue(bucket), label: bucket.name })));
        setLanguageOptions((response.facets?.languages ?? []).map((bucket) => ({ value: facetValue(bucket), label: bucket.name })));
      })
      .catch(() => undefined);
  }, [user, token, loadFactions]);

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
    setFactions([]);
  };

  const openEditor = async (id: number) => {
    if (!token) return;
    setError(null);
    setSaveError(null);
    setSavedAt(null);
    setCreatedNotice(null);
    setCreating(false);
    try {
      // Por id y por la ruta del mantenedor: `api.detail(slug)` da 404 en borradores y ocultos.
      setSelected(await api.adminDetail(token, id));
      setEditorVersion((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error');
    }
  };

  const save = async (patch: VtuberPatch) => {
    if (!token || !selected) return;
    setSaving(true);
    setError(null);
    setSaveError(null);
    try {
      const updated = await api.updateVtuber(token, selected.id, patch);
      /**
       * Solo se reemplaza la ficha seleccionada si la respuesta la trae entera.
       *
       * `save` hacía `setSelected(updated)` sin comprobar nada, y la ruta de producción
       * devolvía `{ok, slug, editado}` en vez del detalle: el resultado era la ficha vacía
       * después de guardar (sin nombre, sin campos, sin imágenes) porque el objeto seleccionado
       * pasaba a tener esos campos en `undefined`. La ruta ya devuelve el detalle, y esta guarda
       * evita que un despliegue anterior repita el síntoma en silencio.
       */
      if (updated?.slug) {
        setSelected(updated);
        setEditorVersion((current) => current + 1);
      }
      setSavedAt(new Date().toISOString());
      // Cambiar número, estado o facciones mueve conteos de la lista, de las métricas y del catálogo.
      await Promise.all([loadAdmin(), loadFactions()]);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'error al guardar';
      setError(message);
      setSaveError({ message, status: (cause as { status?: number }).status });
    } finally {
      setSaving(false);
    }
  };

  const created = (detail: VtuberDetail) => {
    setCreating(false);
    setSelected(detail);
    setEditorVersion((current) => current + 1);
    setSavedAt(null);
    setCreatedNotice(
      `Carta «${detail.name}» creada como BORRADOR con el número #${detail.dexNumber}: aún no se ve en el catálogo. Complétala y cambia la visibilidad a «publicado» cuando esté lista.`,
    );
    void loadAdmin();
    void loadFactions();
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
            <Link href="/" className="hover:text-dex-ink">
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
          <Link href="/" className="rounded-lg border border-dex-line px-3 py-2 text-xs text-dex-muted hover:text-dex-ink">
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

      {createdNotice && (
        <p
          role="status"
          data-testid="admin-created"
          className="mb-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
        >
          {createdNotice}
        </p>
      )}

      {token && (
        <details className="mb-6 rounded-2xl border border-dex-line bg-dex-panel/60 p-4" data-testid="faction-panel">
          <summary className="cursor-pointer text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
            Administrar facciones ({factions.length})
          </summary>
          <div className="mt-4">
            <FactionManager
              token={token}
              factions={factions}
              onItems={(items) => {
                setFactions(items);
                // Fusionar o eliminar cambia las facciones de muchas fichas: la ficha abierta se recarga
                // para que el selector no muestre una facción que ya no existe.
                if (selected) void api.adminDetail(token, selected.id).then(setSelected).catch(() => undefined);
              }}
            />
          </div>
        </details>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setCreating((current) => !current)}
            className="w-full rounded-xl bg-dex-accent px-4 py-2.5 text-sm font-bold text-black"
          >
            {creating ? 'Cerrar' : 'Nueva carta'}
          </button>
          {creating && token && (
            <NewCardDialog token={token} countryOptions={countryOptions} onCreated={created} onCancel={() => setCreating(false)} />
          )}
          {token && (
            <VtuberList
              token={token}
              selectedId={selected?.id ?? null}
              refreshKey={`${savedAt}|${createdNotice}`}
              onOpen={(row) => openEditor(row.id)}
            />
          )}
        </div>

        {/* Editor */}
        <section className="min-w-0">
          {!selected ? (
            <div className="rounded-2xl border border-dex-line bg-dex-panel/60 px-6 py-16 text-center text-sm text-dex-muted">
              Elige una ficha de la lista para editarla, o crea una nueva.
            </div>
          ) : (
            <div className="space-y-6">
              {token && (
                <EditorCard
                  key={`${selected.id}:${editorVersion}`}
                  token={token}
                  detail={selected}
                  factions={factions}
                  countryOptions={countryOptions}
                  languageOptions={languageOptions}
                  saving={saving}
                  savedAt={savedAt}
                  error={saveError}
                  onSave={save}
                />
              )}
              {/* Gestión de imágenes: va DESPUÉS del formulario. */}
              {token && (
                <ImageManager
                  token={token}
                  detail={selected}
                  onUpdated={(vtuber) => {
                    // Se conserva el editor abierto: reemplazar una imagen no debe
                    // sacarte de la ficha en la que estás trabajando. Solo se
                    // actualiza el detalle; no se toca la búsqueda ni el scroll.
                    setSelected(vtuber);
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

export default AdminPage;
