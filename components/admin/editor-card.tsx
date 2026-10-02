'use client';
/**
 * Editor completo de una ficha, en pestañas.
 *
 * Todo el estado vive aquí (no en cada pestaña) y hay UN solo «Guardar cambios» que
 * manda un único PATCH con lo modificado (`buildPatch`). Las pestañas existen para
 * que los ~35 campos no sean un muro; cambiar de pestaña no pierde nada porque el
 * formulario es el mismo. El padre remonta el editor (`key`) solo tras un guardado
 * exitoso, para que el formulario parta de lo que el servidor devolvió (URL
 * normalizada, número reasignado) y NO al subir una imagen, que perdería lo escrito.
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import { cardPalette } from '@/lib/color';
import type { FactionRow, VtuberDetail, VtuberPatch, VtuberStatus } from '@/lib/types';
import { ChipPicker, type ChipOption } from '@/components/admin/chip-picker';
import { FactionPicker } from '@/components/admin/faction-picker';
import { buildPatch, formFromDetail, slugifyUrl, type EditorForm } from '@/components/admin/form-model';
import { ProfileEditor, SkillsEditor, SocialsEditor, StatsEditor } from '@/components/admin/list-sections';
import { Field, ghostButton, inputClass, primaryButton } from '@/components/admin/ui';

type TabId = 'general' | 'facciones' | 'lore' | 'perfil' | 'stats' | 'skills' | 'redes';

export interface SaveFailure {
  message: string;
  status?: number;
}

export function EditorCard({
  token,
  detail,
  factions,
  countryOptions,
  languageOptions,
  saving,
  savedAt,
  error,
  onSave,
}: {
  token: string;
  detail: VtuberDetail;
  factions: FactionRow[];
  countryOptions: ChipOption[];
  languageOptions: ChipOption[];
  saving: boolean;
  /** Marca de tiempo del último guardado, para el aviso de éxito. */
  savedAt: string | null;
  /** Fallo del guardado, si lo hubo. */
  error: SaveFailure | null;
  onSave: (patch: VtuberPatch) => void;
}) {
  const [form, setForm] = useState<EditorForm>(() => formFromDetail(detail));
  const [tab, setTab] = useState<TabId>('general');
  const [nextDex, setNextDex] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const set = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  // El origen se lee en un efecto: durante el render del servidor no hay `window`.
  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    let alive = true;
    api
      .dexNext(token)
      .then((response) => alive && setNextDex(response.next))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [token, detail.dexNumber]);

  const palette = cardPalette(form.themeColor, detail.secondaryColor);
  const { patch, errors } = useMemo(() => buildPatch(detail, form), [detail, form]);
  const changes = Object.keys(patch).length;
  const [attempted, setAttempted] = useState(false);

  const normalizedSlug = slugifyUrl(form.slug);
  const slugChanged = normalizedSlug !== detail.slug && normalizedSlug !== '';
  const dexChanged = patch.dexNumber !== undefined;
  // 409 sin tocar la URL = número ocupado; con la URL cambiada el aviso de abajo sirve para los dos casos.
  const dexConflict = error?.status === 409 && dexChanged;

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'facciones', label: `Facciones (${form.factions.length}/2)` },
    { id: 'lore', label: 'Lore' },
    { id: 'perfil', label: `Perfil (${form.profile.length})` },
    { id: 'stats', label: `Atributos (${form.stats.length})` },
    { id: 'skills', label: `Habilidades (${form.skills.length})` },
    { id: 'redes', label: `Redes (${form.socials.length})` },
  ];

  const colorField = (key: 'themeColor') => (
    <Field label="Color de marca">
      <span className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(form[key]) ? form[key] : '#5eead4'}
          onChange={(event) => set(key, event.target.value)}
          className="h-9 w-12 rounded border border-dex-line bg-dex-void"
        />
        <input
          value={form[key]}
          onChange={(event) => set(key, event.target.value)}
          pattern="^#[0-9a-fA-F]{6}$"
          className="w-full rounded-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-xs text-dex-ink outline-none focus:border-dex-accent"
        />
      </span>
    </Field>
  );

  return (
    <form
      className="rounded-2xl border border-dex-line bg-dex-panel/60"
      data-testid="admin-editor"
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (errors.length > 0 || changes === 0) return;
        onSave(patch);
      }}
    >
      <header className="flex items-center gap-4 p-5 pb-3">
        {/* Vista previa del PERSONAJE: es la imagen de identidad del VTuber. */}
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
            #{String(detail.dexNumber).padStart(3, '0')} ·{' '}
            {detail.status === 'published' ? (
              <Link href={`/v/${detail.slug}`} className="hover:text-dex-ink">
                /v/{detail.slug}
              </Link>
            ) : (
              <span>/v/{detail.slug}</span>
            )}
          </p>
        </div>
      </header>

      {form.status !== 'published' && (
        <p
          data-testid="admin-draft-notice"
          className="mx-5 mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
        >
          Esta carta está en <strong>{form.status === 'draft' ? 'borrador' : 'oculta'}</strong>: no se ve en el catálogo ni en su
          página pública hasta que la pongas en «publicado» (pestaña General, campo Visibilidad).
        </p>
      )}

      <div role="tablist" aria-label="Secciones de la ficha" className="dex-scroll flex gap-1 overflow-x-auto border-b border-dex-line px-5">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={tab === item.id}
            aria-controls={`panel-${item.id}`}
            onClick={() => setTab(item.id)}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold ${
              tab === item.id ? 'border-dex-accent text-dex-ink' : 'border-transparent text-dex-muted hover:text-dex-ink'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4 p-5">
        {tab === 'general' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nombre">
                <input value={form.name} onChange={(event) => set('name', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Visibilidad">
                <select value={form.status} onChange={(event) => set('status', event.target.value as VtuberStatus)} className={inputClass}>
                  <option value="published">publicado</option>
                  <option value="draft">borrador</option>
                  <option value="hidden">oculto</option>
                </select>
              </Field>

              <div className="sm:col-span-2">
                <Field
                  label="URL de la página"
                  hint={
                    <>
                      Se guarda en minúsculas y con guiones. La URL anterior (/v/{detail.slug}) seguirá redirigiendo a la nueva.
                    </>
                  }
                >
                  <span className="mt-1 flex items-stretch">
                    <span className="flex items-center rounded-l-lg border border-r-0 border-dex-line bg-dex-void/60 px-3 font-mono text-xs text-dex-muted">/v/</span>
                    <input
                      aria-label="URL de la página"
                      value={form.slug}
                      onChange={(event) => set('slug', event.target.value)}
                      className="w-full rounded-r-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-sm text-dex-ink outline-none focus:border-dex-accent"
                    />
                  </span>
                </Field>
                <p className="mt-1 break-all font-mono text-[11px] text-dex-muted" data-testid="slug-preview">
                  {origin}/v/{normalizedSlug || '…'}
                  {slugChanged && <span className="ml-2 text-amber-200">(cambio pendiente)</span>}
                </p>
              </div>

              <div className="sm:col-span-2">
                <Field
                  label="Número de dex"
                  hint="Un número ocupado no se intercambia: para usarlo, mueve antes a la ficha que lo tiene a un número libre (por ejemplo, al final). Al guardar, el número anterior de esta ficha queda libre."
                >
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      aria-label="Número de dex"
                      value={form.dexEnd ? (nextDex ?? '') : form.dexNumber}
                      onChange={(event) => setForm((current) => ({ ...current, dexNumber: event.target.value, dexEnd: false }))}
                      className="w-32 rounded-lg border border-dex-line bg-dex-void px-3 py-2 font-mono text-sm text-dex-ink outline-none focus:border-dex-accent"
                    />
                    <button
                      type="button"
                      className={ghostButton}
                      aria-pressed={form.dexEnd}
                      onClick={() => setForm((current) => ({ ...current, dexEnd: !current.dexEnd, dexNumber: String(detail.dexNumber) }))}
                    >
                      Mandar al final{nextDex !== null ? ` (#${nextDex})` : ''}
                    </button>
                    {form.dexEnd && <span className="text-[11px] normal-case text-dex-muted">Se asignará el último número libre al guardar.</span>}
                  </span>
                </Field>
              </div>

              {colorField('themeColor')}
              <Field label="Color secundario (texto)">
                <input value={form.secondaryColor} onChange={(event) => set('secondaryColor', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Nivel">
                <input inputMode="numeric" value={form.level} onChange={(event) => set('level', event.target.value)} className={inputClass} />
              </Field>
              {(
                [
                  ['birthday', 'Cumpleaños'],
                  ['height', 'Altura'],
                  ['hashtag', 'Hashtag'],
                  ['favoriteColor', 'Color favorito'],
                ] as const
              ).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input value={form[key]} onChange={(event) => set(key, event.target.value)} className={inputClass} />
                </Field>
              ))}
              <ChipPicker label="Países" options={countryOptions} value={form.countries} onChange={(next) => set('countries', next)} max={6} />
              <ChipPicker label="Idiomas" options={languageOptions} value={form.languages} onChange={(next) => set('languages', next)} max={6} />
              <Field label="Grupos (separados por coma)">
                <input value={form.groups} onChange={(event) => set('groups', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Artistas (separados por coma)">
                <input value={form.artists} onChange={(event) => set('artists', event.target.value)} className={inputClass} />
              </Field>
            </div>
          </>
        )}

        {tab === 'facciones' && (
          <FactionPicker factions={factions} value={form.factions} onChange={(next) => set('factions', next)} />
        )}

        {tab === 'lore' && (
          <>
            <Field label="Frase de presentación">
              <textarea value={form.phrase} onChange={(event) => set('phrase', event.target.value)} rows={3} className={inputClass} />
            </Field>
            <Field label="Lore / historia de la carta" hint={`${form.cardText.length} / 4000 caracteres`}>
              <textarea
                value={form.cardText}
                onChange={(event) => set('cardText', event.target.value)}
                rows={10}
                maxLength={4000}
                className={inputClass}
              />
            </Field>
          </>
        )}

        {tab === 'perfil' && <ProfileEditor items={form.profile} onChange={(next) => set('profile', next)} />}
        {tab === 'stats' && <StatsEditor items={form.stats} onChange={(next) => set('stats', next)} />}
        {tab === 'skills' && <SkillsEditor items={form.skills} onChange={(next) => set('skills', next)} />}
        {tab === 'redes' && <SocialsEditor items={form.socials} onChange={(next) => set('socials', next)} />}
      </div>

      {/* Barra de guardado pegada al borde inferior: el resultado se ve donde está el foco. */}
      <footer className="sticky bottom-0 space-y-2 rounded-b-2xl border-t border-dex-line bg-dex-panel/95 p-4 backdrop-blur">
        {attempted && errors.length > 0 && (
          <ul role="alert" data-testid="admin-editor-invalid" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {error && (
          <div role="alert" data-testid="admin-editor-error" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            <p>{error.message}</p>
            {dexConflict && (
              <p className="mt-1 text-xs text-red-100/80" data-testid="admin-dex-hint">
                Ese número ya está en uso. Para quedarte con él, abre primero a la ficha que lo tiene y muévela a un número libre (por ejemplo, «Mandar al final»); después vuelve a guardar esta.
              </p>
            )}
          </div>
        )}
        {savedAt && !error && (
          <p role="status" data-testid="admin-editor-saved" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
            Guardado a las {new Date(savedAt).toLocaleTimeString('es-CL')}
          </p>
        )}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-dex-muted">{changes === 0 ? 'Sin cambios pendientes' : `${changes} ${changes === 1 ? 'campo modificado' : 'campos modificados'}`}</p>
          <button type="submit" disabled={saving || changes === 0} className={primaryButton}>
            {saving ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      </footer>
    </form>
  );
}
