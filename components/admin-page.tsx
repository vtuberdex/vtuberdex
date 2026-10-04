'use client';
/**
 * Mantenedor: orquestador. Login, métricas y dos secciones («Fichas» y «Emblemas y
 * facciones»); el trabajo de cada una vive en `components/admin/`.
 * Reemplaza el "editar HTML a mano" del origen. Aquí solo está el estado que comparten
 * (sesión, catálogo de facciones, qué ficha está abierta) y los avisos.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { facetValue, type FactionRow, type VtuberDetail } from '@/lib/types';
import { DEFAULT_SEARCH } from '@/lib/query';
import { CardWizard } from '@/components/admin/card-wizard';
import { FactionManager } from '@/components/admin/faction-manager';
import { GettingStarted } from '@/components/admin/getting-started';
import { PremiumManager } from '@/components/admin/premium-manager';
import { SolicitudesManager } from '@/components/admin/solicitudes-manager';
import { VtuberList } from '@/components/admin/vtuber-list';
import type { ChipOption } from '@/components/admin/chip-picker';
import { primaryButton } from '@/components/admin/ui';
import { ToastContainer, useToasts } from '@/components/toast';

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

type Section = 'fichas' | 'emblemas' | 'premium' | 'solicitudes';
type View = { kind: 'none' } | { kind: 'create'; n: number } | { kind: 'edit'; detail: VtuberDetail; epoch: number };

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
  const [section, setSection] = useState<Section>('fichas');
  const [view, setView] = useState<View>({ kind: 'none' });
  /** Sube tras cada guardado/alta: la lista lateral vuelve a pedir su página. */
  const [listVersion, setListVersion] = useState(0);
  const { toasts, add: notify, remove: removeToast } = useToasts();

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

  // Catálogo de facciones y opciones de país/idioma para los selectores del asistente.
  const loadFactions = useCallback(async () => {
    if (!token) return;
    try {
      setFactions((await api.factions(token)).items);
    } catch {
      // El asistente sigue funcionando sin selector de facciones; la sección de emblemas muestra su propio error al operar.
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
    setView({ kind: 'none' });
    setStats(null);
    setFactions([]);
  };

  const startCreate = () => {
    setSection('fichas');
    setView((current) => ({ kind: 'create', n: current.kind === 'create' ? current.n + 1 : 0 }));
  };

  const openEditor = async (id: number) => {
    if (!token) return;
    setError(null);
    try {
      // Por id y por la ruta del mantenedor: `api.detail(slug)` da 404 en borradores y ocultos.
      const detail = await api.adminDetail(token, id);
      setView({ kind: 'edit', detail, epoch: 0 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error');
    }
  };

  /** Tras guardar o crear: la lista, las métricas y los conteos de facciones cambian. */
  const changed = () => {
    setListVersion((current) => current + 1);
    void loadAdmin();
    void loadFactions();
  };

  /** Fusionar/eliminar una facción cambia las fichas: la abierta se recarga para no pisar el cambio al guardar. */
  const factionStructureChanged = () => {
    setListVersion((current) => current + 1);
    void loadAdmin();
    if (view.kind === 'edit' && token) {
      const epoch = view.epoch + 1;
      void api
        .adminDetail(token, view.detail.id)
        .then((detail) => setView({ kind: 'edit', detail, epoch }))
        .catch(() => undefined);
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
            <Link href="/" className="hover:text-dex-ink">
              ← Volver al catálogo
            </Link>
          </p>
        </form>
      </div>
    );
  }

  const sections: Array<{ id: Section; label: string }> = [
    { id: 'fichas', label: 'Fichas' },
    { id: 'emblemas', label: 'Emblemas y facciones' },
    { id: 'premium', label: 'Premium' },
    { id: 'solicitudes', label: 'Solicitudes' },
  ];

  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-16 pt-6 sm:px-6 lg:px-8">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
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

      <GettingStarted onGoFactions={() => setSection('emblemas')} onNewCard={startCreate} />

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

      <div role="tablist" aria-label="Secciones del mantenedor" className="mb-6 flex gap-1 border-b border-dex-line">
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`section-tab-${item.id}`}
            aria-selected={section === item.id}
            aria-controls={`section-${item.id}`}
            onClick={() => setSection(item.id)}
            className={`border-b-2 px-4 py-2.5 text-sm font-semibold ${
              section === item.id ? 'border-dex-accent text-dex-ink' : 'border-transparent text-dex-muted hover:text-dex-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Las dos secciones se montan siempre y la inactiva se oculta: así cambiar de pestaña no descarta lo que hay escrito en el asistente. */}
      <div role="tabpanel" id="section-emblemas" aria-labelledby="section-tab-emblemas" hidden={section !== 'emblemas'}>
        {token && (
          <FactionManager
            token={token}
            factions={factions}
            onItems={setFactions}
            onStructureChanged={factionStructureChanged}
            onAssign={() => {
              setSection('fichas');
              notify('ok', 'Abre una ficha y elige la facción en el paso «Colores y facciones».');
            }}
            notify={notify}
          />
        )}
      </div>

      {/* Premium se monta al abrirla (no antes): pide su propia lista y no debe alterar la carga de las otras. */}
      <div role="tabpanel" id="section-premium" aria-labelledby="section-tab-premium" hidden={section !== 'premium'}>
        {token && section === 'premium' && <PremiumManager token={token} notify={notify} onChanged={changed} />}
      </div>

      <div role="tabpanel" id="section-solicitudes" aria-labelledby="section-tab-solicitudes" hidden={section !== 'solicitudes'}>
        {token && section === 'solicitudes' && <SolicitudesManager token={token} notify={notify} onChanged={changed} />}
      </div>

      <div role="tabpanel" id="section-fichas" aria-labelledby="section-tab-fichas" hidden={section !== 'fichas'}>
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <div className="space-y-4">
            <button type="button" onClick={startCreate} className={`${primaryButton} w-full py-3`}>
              Nueva carta
            </button>
            {token && (
              <VtuberList
                token={token}
                selectedId={view.kind === 'edit' ? view.detail.id : null}
                refreshKey={listVersion}
                onOpen={(row) => openEditor(row.id)}
                onCreate={startCreate}
              />
            )}
          </div>

          <section className="min-w-0">
            {token && view.kind === 'create' && (
              <CardWizard
                key={`new-${view.n}`}
                token={token}
                mode="create"
                initial={null}
                factions={factions}
                countryOptions={countryOptions}
                languageOptions={languageOptions}
                notify={notify}
                onChanged={changed}
                onFactionsChanged={setFactions}
                onExit={() => setView({ kind: 'none' })}
                onCreateAnother={startCreate}
              />
            )}
            {token && view.kind === 'edit' && (
              <CardWizard
                key={`${view.detail.id}:${view.epoch}`}
                token={token}
                mode="edit"
                initial={view.detail}
                factions={factions}
                countryOptions={countryOptions}
                languageOptions={languageOptions}
                notify={notify}
                onChanged={changed}
                onFactionsChanged={setFactions}
                onExit={() => setView({ kind: 'none' })}
              />
            )}
            {view.kind === 'none' && (
              <div className="rounded-2xl border border-dashed border-dex-line px-6 py-16 text-center">
                <p className="text-sm text-dex-muted">Elige una ficha de la lista para editarla, o crea una nueva.</p>
                <button type="button" onClick={startCreate} className={`${primaryButton} mt-4`}>
                  Nueva carta
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

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
    </div>
  );
}

export default AdminPage;
