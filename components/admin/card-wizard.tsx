'use client';
/**
 * Asistente de carta: UNA sola experiencia para crear y para editar.
 *
 * - Modo `create`: el paso 1 crea el borrador (POST) y desde ahí cada «Siguiente» guarda
 *   (PATCH) solo lo que cambió, así que nada se pierde si se cierra a la mitad: la carta
 *   queda como borrador y se continúa después desde la lista.
 * - Modo `edit`: los mismos pasos, navegables en cualquier orden, con «Guardar» siempre a
 *   mano y «Siguiente» opcional.
 *
 * El estado (formulario + ficha del servidor) vive AQUÍ y no en cada paso: cambiar de paso
 * no pierde nada, y subir una imagen (que actualiza la ficha del servidor) no pisa lo que
 * hay escrito en el formulario sin guardar. Los pasos son componentes presentacionales en
 * `steps/`. El guardado manda un PATCH con lo modificado (`buildPatch`).
 */
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api } from '@/lib/api';
import type { FactionRow, VtuberDetail } from '@/lib/types';
import type { ChipOption } from '@/components/admin/chip-picker';
import { checklist, percent, stepComplete, type StepId } from '@/components/admin/completeness';
import { FactionWizard } from '@/components/admin/faction-wizard';
import { buildPatch, createBody, DEFAULT_THEME, emptyForm, formFromDetail, slugifyUrl, type EditorForm } from '@/components/admin/form-model';
import { AttributesStep } from '@/components/admin/steps/attributes-step';
import { ColorsStep } from '@/components/admin/steps/colors-step';
import { IdentityStep } from '@/components/admin/steps/identity-step';
import { ImagesStep } from '@/components/admin/steps/images-step';
import { ReviewStep } from '@/components/admin/steps/review-step';
import { StoryStep } from '@/components/admin/steps/story-step';
import { Dialog, ghostButton, primaryButton, Reason } from '@/components/admin/ui';

export interface SaveFailure {
  message: string;
  status?: number;
}

type Notify = (kind: 'ok' | 'error', text: string) => void;

const STEPS: Array<{ id: StepId; label: string; help: string }> = [
  { id: 'identidad', label: 'Identidad', help: 'Nombre, dirección de la página, país y número.' },
  { id: 'imagenes', label: 'Imágenes', help: 'Personaje, logo y fondo.' },
  { id: 'colores', label: 'Colores y facciones', help: 'El color de la carta y su(s) facción(es).' },
  { id: 'historia', label: 'Historia', help: 'Frase, lore y datos de perfil.' },
  { id: 'atributos', label: 'Atributos, habilidades y redes', help: 'Números, poderes y enlaces.' },
  { id: 'revision', label: 'Revisar y publicar', help: 'Comprueba y decide si se publica.' },
];
const stepLabel = (id: StepId) => STEPS.find((step) => step.id === id)?.label ?? id;

/** Explica un 409: ¿fue el número de dex o la dirección de la página? Cada uno se resuelve distinto. */
export function conflictKind(error: SaveFailure | null, dexRequested: boolean, slugRequested: boolean): 'dex' | 'slug' | null {
  if (error?.status !== 409) return null;
  if (/slug|url|direcci/i.test(error.message)) return 'slug';
  if (/dex|n[uú]mero|#\d+/i.test(error.message) && dexRequested) return 'dex';
  if (dexRequested && !slugRequested) return 'dex';
  return slugRequested ? 'slug' : dexRequested ? 'dex' : null;
}

export function CardWizard({
  token,
  mode,
  initial,
  factions,
  countryOptions,
  languageOptions,
  notify,
  onChanged,
  onFactionsChanged,
  onExit,
  onCreateAnother,
}: {
  token: string;
  mode: 'create' | 'edit';
  initial: VtuberDetail | null;
  factions: FactionRow[];
  countryOptions: ChipOption[];
  languageOptions: ChipOption[];
  notify: Notify;
  /** Se llama tras cada creación o guardado exitoso (el padre refresca lista y métricas). */
  onChanged: (detail: VtuberDetail) => void;
  onFactionsChanged: (items: FactionRow[]) => void;
  onExit: () => void;
  onCreateAnother?: () => void;
}) {
  const [detail, setDetail] = useState<VtuberDetail | null>(initial);
  const [form, setForm] = useState<EditorForm>(() => (initial ? formFromDetail(initial) : emptyForm()));
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveFailure | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [slugAuto, setSlugAuto] = useState(mode === 'create');
  const [nextDex, setNextDex] = useState<number | null>(null);
  const [origin, setOrigin] = useState('');
  const [factionDialog, setFactionDialog] = useState(false);
  const [finished, setFinished] = useState(false);

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
  }, [token, detail?.dexNumber]);

  const items = useMemo(
    () =>
      checklist({
        name: form.name,
        slug: form.slug,
        character: Boolean(detail?.images.character),
        logo: Boolean(detail?.images.logo),
        themeColor: Boolean(detail?.themeColor) || form.themeColor.toLowerCase() !== DEFAULT_THEME,
        factions: form.factions.length,
        phrase: Boolean(form.phrase.trim()),
        cardText: Boolean(form.cardText.trim()),
        stats: form.stats.filter((stat) => stat.label.trim()).length,
        socials: form.socials.filter((social) => social.url.trim()).length,
        profile: form.profile.filter((field) => field.label.trim()).length,
        skills: form.skills.filter((skill) => skill.name.trim() || skill.effect.trim()).length,
      }),
    [form, detail],
  );
  const total = percent(items);

  const { patch, errors } = useMemo(() => (detail ? buildPatch(detail, form) : { patch: {}, errors: [] as string[] }), [detail, form]);
  const changes = detail ? Object.keys(patch).length : form.name.trim() ? 1 : 0;
  const lastIndex = STEPS.length - 1;
  const nameMissing = !form.name.trim();
  const normalizedSlug = slugifyUrl(form.slug);

  const adopt = (next: VtuberDetail) => {
    setDetail(next);
    setForm(formFromDetail(next));
    setSlugAuto(false);
    setSavedAt(new Date().toISOString());
    onChanged(next);
  };

  const fail = (cause: unknown, requested: { dex: boolean; slug: boolean }) => {
    const failure: SaveFailure = {
      message: cause instanceof Error ? cause.message : 'No se pudo guardar.',
      status: (cause as { status?: number }).status,
    };
    setError(failure);
    const kind = conflictKind(failure, requested.dex, requested.slug);
    notify('error', kind === 'slug' ? `${failure.message}. Esa dirección ya está en uso.` : failure.message);
  };

  /** Crea (paso 1 del modo create) o guarda lo modificado. `true` = se puede continuar. */
  const persist = async (): Promise<boolean> => {
    setError(null);
    if (!detail) {
      const { body } = createBody(form);
      if (!body) {
        setAttempted(true);
        return false;
      }
      setSaving(true);
      try {
        const created = await api.createVtuber(token, body);
        adopt(created);
        notify('ok', `Borrador «${created.name}» creado con el número #${created.dexNumber}.`);
        return true;
      } catch (cause) {
        fail(cause, { dex: body.dexNumber !== undefined, slug: body.slug !== undefined });
        return false;
      } finally {
        setSaving(false);
      }
    }
    if (errors.length > 0) {
      setAttempted(true);
      return false;
    }
    if (Object.keys(patch).length === 0) return true;
    setSaving(true);
    try {
      const updated = await api.updateVtuber(token, detail.id, patch);
      /**
       * Solo se adopta la respuesta si trae la ficha entera: una ruta antigua devolvía
       * `{ok, slug, editado}` y adoptarla dejaba el asistente sin nombre ni campos.
       */
      if (updated?.slug) adopt(updated);
      else setSavedAt(new Date().toISOString());
      notify('ok', 'Cambios guardados.');
      return true;
    } catch (cause) {
      fail(cause, { dex: patch.dexNumber !== undefined, slug: patch.slug !== undefined });
      return false;
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    if (await persist()) setIndex((current) => Math.min(current + 1, lastIndex));
  };
  const finish = async () => {
    if (!(await persist())) return;
    if (mode === 'create') setFinished(true);
  };

  const onNameChange = (name: string) => setForm((current) => ({ ...current, name, slug: slugAuto ? slugifyUrl(name) : current.slug }));
  const onSlugChange = (slug: string) => {
    setSlugAuto(false);
    set('slug', slug);
  };

  const jumpToFirstPending = () => {
    const pending = items.find((item) => !item.optional && !item.ok);
    setIndex(STEPS.findIndex((step) => step.id === (pending?.step ?? 'revision')));
  };

  const conflict = conflictKind(error, patch.dexNumber !== undefined || (!detail && !form.dexEnd && Boolean(form.dexNumber)), patch.slug !== undefined || !detail);
  const step = STEPS[index];
  const current = detail?.name ?? form.name;

  if (finished && detail) {
    return (
      <div className="space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6" data-testid="wizard-done">
        <h2 className="text-xl font-extrabold text-dex-ink">¡Carta «{detail.name}» lista!</h2>
        <p className="text-sm text-dex-muted">
          {detail.status === 'published' ? 'Ya es pública.' : 'Quedó como borrador: no se ve en el catálogo hasta que la publiques.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {detail.status === 'published' && (
            <Link href={`/v/${detail.slug}`} className={primaryButton} target="_blank">
              Ver la página pública
            </Link>
          )}
          {onCreateAnother && (
            <button type="button" className={ghostButton} onClick={onCreateAnother}>
              Crear otra carta
            </button>
          )}
          <button type="button" className={ghostButton} onClick={onExit}>
            Volver a la lista
          </button>
        </div>
      </div>
    );
  }

  const submitLabel = index === lastIndex ? (mode === 'create' ? 'Finalizar' : 'Guardar cambios') : mode === 'create' ? 'Siguiente' : 'Guardar cambios';

  return (
    <>
    <form
      className="rounded-2xl border border-dex-line bg-dex-panel/60"
      data-testid="admin-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (mode === 'create') void (index === lastIndex ? finish() : goNext());
        else void persist();
      }}
    >
      <header className="space-y-3 p-5 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold text-dex-ink">{mode === 'create' && !detail ? 'Nueva carta' : current || 'Sin nombre'}</h2>
            {detail && (
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
            )}
          </div>
          <p className="font-mono text-xs text-dex-muted" data-testid="wizard-percent">
            {total}% completa
          </p>
        </div>
        <div
          role="progressbar"
          aria-label="Progreso del asistente"
          aria-valuemin={0}
          aria-valuemax={STEPS.length}
          aria-valuenow={index + 1}
          className="h-1.5 overflow-hidden rounded-full bg-white/10"
        >
          <div className="h-full bg-dex-accent transition-all" style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
        </div>

        <nav aria-label="Pasos de la carta">
          <ol className="flex flex-wrap gap-1.5">
            {STEPS.map((item, i) => {
              const complete = stepComplete(items, item.id);
              const locked = !detail && i > 0;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={locked}
                    title={locked ? 'Primero crea el borrador en el paso 1' : item.help}
                    aria-current={i === index ? 'step' : undefined}
                    onClick={() => setIndex(i)}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${
                      i === index ? 'border-dex-accent bg-dex-accent/15 text-dex-ink' : 'border-dex-line text-dex-muted hover:text-dex-ink'
                    }`}
                  >
                    <span aria-hidden className={complete ? 'text-emerald-300' : complete === false ? 'text-amber-300' : ''}>
                      {complete ? '✓' : i + 1}
                    </span>
                    {item.label}
                    {complete && <span className="sr-only"> (completo)</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      {mode === 'edit' && detail && form.status !== 'published' && (
        <p data-testid="admin-draft-notice" className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100">
          <span>
            Esta carta está en <strong>{form.status === 'draft' ? 'borrador' : 'oculta'}</strong>: no se ve en el catálogo hasta que la publiques (último paso).
          </span>
          <button type="button" className={ghostButton} onClick={jumpToFirstPending}>
            Continuar asistente
          </button>
        </p>
      )}

      <section aria-labelledby="wizard-step-title" className="space-y-4 p-5">
        <div>
          <h3 id="wizard-step-title" className="text-base font-bold text-dex-ink">
            Paso {index + 1} de {STEPS.length}: {step.label}
          </h3>
          <p className="text-xs text-dex-muted">{step.help}</p>
        </div>

        {step.id === 'identidad' && (
          <IdentityStep
            form={form}
            set={set}
            setForm={setForm}
            mode={mode}
            nextDex={nextDex}
            currentDex={detail?.dexNumber ?? null}
            currentSlug={detail?.slug ?? null}
            origin={origin}
            countryOptions={countryOptions}
            languageOptions={languageOptions}
            onNameChange={onNameChange}
            onSlugChange={onSlugChange}
          />
        )}
        {step.id === 'imagenes' && detail && <ImagesStep token={token} detail={detail} onUpdated={setDetail} />}
        {step.id === 'colores' && <ColorsStep form={form} set={set} factions={factions} onCreateFaction={() => setFactionDialog(true)} />}
        {step.id === 'historia' && <StoryStep form={form} set={set} />}
        {step.id === 'atributos' && <AttributesStep form={form} set={set} />}
        {step.id === 'revision' && (
          <ReviewStep
            form={form}
            set={set}
            items={items}
            slug={detail?.slug ?? normalizedSlug}
            onJump={(target) => setIndex(STEPS.findIndex((candidate) => candidate.id === target))}
            stepLabel={stepLabel}
          />
        )}
      </section>

      {/* Barra pegada al borde inferior: el resultado se ve donde está el foco. */}
      <footer className="sticky bottom-0 space-y-2 rounded-b-2xl border-t border-dex-line bg-dex-panel/95 p-4 backdrop-blur">
        {((detail && errors.length > 0) || (attempted && !detail && nameMissing)) && (
          <ul role="alert" data-testid="admin-editor-invalid" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            {(detail ? errors : ['Escribe un nombre para continuar.']).map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        )}
        {error && (
          <div role="alert" data-testid="admin-editor-error" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
            <p>{error.message}</p>
            {conflict === 'dex' && (
              <p className="mt-1 text-xs text-red-100/80" data-testid="admin-dex-hint">
                Ese número ya está en uso. Para quedarte con él, abre primero a la ficha que lo tiene y muévela a un número libre (por ejemplo, «Mandar al final»); después vuelve a guardar esta.
              </p>
            )}
            {conflict === 'slug' && (
              <p className="mt-1 text-xs text-red-100/80" data-testid="admin-slug-hint">
                Esa dirección de página ya la usa otra carta. Prueba con «{normalizedSlug || 'nombre'}-2» u otra variante.
              </p>
            )}
          </div>
        )}
        {savedAt && !error && (
          <p role="status" data-testid="admin-editor-saved" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200">
            Guardado a las {new Date(savedAt).toLocaleTimeString('es-CL')}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={ghostButton} disabled={index === 0 || saving} onClick={() => setIndex(index - 1)}>
            ← Atrás
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode === 'create' && (
              <button
                type="button"
                className={ghostButton}
                disabled={saving || nameMissing}
                onClick={async () => {
                  if (await persist()) onExit();
                }}
              >
                Guardar y salir
              </button>
            )}
            {(mode === 'edit' || (mode === 'create' && detail)) && (
              <button
                type={mode === 'edit' ? 'submit' : 'button'}
                className={ghostButton}
                disabled={saving || changes === 0 || (detail !== null && errors.length > 0)}
                onClick={mode === 'edit' ? undefined : () => void persist()}
              >
                {saving ? 'Guardando…' : mode === 'edit' ? 'Guardar cambios' : 'Guardar'}
              </button>
            )}
            {mode === 'edit' && index < lastIndex && (
              <button type="button" className={ghostButton} disabled={saving} onClick={() => void goNext()}>
                Siguiente →
              </button>
            )}
            {mode === 'create' && (
              <button type="submit" className={primaryButton} disabled={saving || (!detail && nameMissing)}>
                {saving ? 'Guardando…' : submitLabel}
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {mode === 'create' && !detail && nameMissing && <Reason>Escribe un nombre para continuar.</Reason>}
          {mode === 'edit' && changes === 0 && <p className="text-[11px] text-dex-muted">Sin cambios pendientes: no hay nada que guardar.</p>}
          {mode === 'edit' && changes > 0 && (
            <p className="text-[11px] text-dex-muted">
              {changes} {changes === 1 ? 'campo modificado' : 'campos modificados'} sin guardar.
            </p>
          )}
          {detail && errors.length > 0 && <Reason>Corrige los errores marcados para poder guardar.</Reason>}
        </div>
      </footer>

    </form>
    {factionDialog && (
      <Dialog title="Nueva facción" onClose={() => setFactionDialog(false)}>
        <FactionWizard
          token={token}
          factions={factions}
          onItems={onFactionsChanged}
          onClose={() => setFactionDialog(false)}
          onDone={(faction) => {
            setFactionDialog(false);
            setForm((currentForm) => (currentForm.factions.length < 2 && !currentForm.factions.includes(faction.slug) ? { ...currentForm, factions: [...currentForm.factions, faction.slug] } : currentForm));
          }}
        />
      </Dialog>
    )}
    </>
  );
}
