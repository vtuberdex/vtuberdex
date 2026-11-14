// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
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
 * `steps/` y la cabecera, avisos y botonera en `card-wizard-partes.tsx`. El guardado manda un
 * PATCH con lo modificado (`buildPatch`).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import { api } from "@/lib/api";
import type { FactionRow, VtuberDetail, VtuberPatch } from "@/lib/types";
import type { ChipOption } from "@/components/admin/chip-picker";
import {
  AvisoDeBorrador,
  AvisosDelGuardado,
  BotoneraDelAsistente,
  CabeceraDelAsistente,
  etiquetaDeEnvio,
  PasoDelAsistente,
  PistasDelAsistente,
  STEPS,
  type SaveFailure,
  type WizardMode,
  WizardDone,
} from "@/components/admin/card-wizard-partes";
import {
  checklist,
  percent,
  type StepId,
} from "@/components/admin/completeness";
import { FactionWizard } from "@/components/admin/faction-wizard";
import {
  buildPatch,
  createBody,
  DEFAULT_THEME,
  emptyForm,
  formFromDetail,
  slugifyUrl,
  type EditorForm,
} from "@/components/admin/form-model";
import { Dialog } from "@/components/admin/ui";

export type { SaveFailure } from "@/components/admin/card-wizard-partes";

type Notify = (kind: "ok" | "error", text: string) => void;

/** Explica un 409: ¿fue el número de dex o la dirección de la página? Cada uno se resuelve distinto. */
export function conflictKind(
  error: SaveFailure | null,
  dexRequested: boolean,
  slugRequested: boolean,
): "dex" | "slug" | null {
  if (error?.status !== 409) {
    return null;
  }
  if (/slug|url|direcci/i.test(error.message)) {
    return "slug";
  }
  if (/dex|n[uú]mero|#\d+/i.test(error.message) && dexRequested) {
    return "dex";
  }
  if (dexRequested && !slugRequested) {
    return "dex";
  }
  // Aquí, o se pidió la dirección, o no se pidió ninguna de las dos.
  return slugRequested ? "slug" : null;
}

/** Qué se pidió cambiar: decide a cuál de los dos atribuir un 409 ambiguo. */
function conflictoDelFormulario(
  error: SaveFailure | null,
  patch: VtuberPatch,
  detail: VtuberDetail | null,
  form: EditorForm,
): "dex" | "slug" | null {
  const dexAlCrear = !detail && !form.dexEnd && Boolean(form.dexNumber);
  return conflictKind(
    error,
    patch.dexNumber !== undefined || dexAlCrear,
    patch.slug !== undefined || !detail,
  );
}

/** Cambios pendientes: los campos del PATCH, o el nombre escrito si aún no hay borrador. */
function contarCambios(
  detail: VtuberDetail | null,
  patch: VtuberPatch,
  form: EditorForm,
): number {
  if (detail) {
    return Object.keys(patch).length;
  }
  return form.name.trim() ? 1 : 0;
}

const statusDe = (cause: unknown) => (cause as { status?: number }).status;

/** Lo que se avisa tras guardar el correo: quitado, guardado, y si salió la bienvenida. */
function avisoDeCorreo(
  stored: string,
  bienvenida: string | undefined,
): ["ok" | "error", string] {
  if (!stored) {
    return ["ok", "Correo quitado."];
  }
  if (bienvenida === "enviada") {
    return [
      "ok",
      `Correo guardado. Se envió el correo de bienvenida a ${stored}.`,
    ];
  }
  if (bienvenida === "fallo") {
    return [
      "error",
      "Correo guardado, pero no se pudo enviar la bienvenida. Revisa el servidor de correo.",
    ];
  }
  return ["ok", "Correo guardado."];
}

function fallaDeCorreo(cause: unknown): SaveFailure {
  return {
    message:
      cause instanceof Error
        ? `Correo: ${cause.message}`
        : "No se pudo guardar el correo.",
    status: statusDe(cause),
  };
}

function fallaDeGuardado(cause: unknown): SaveFailure {
  return {
    message: cause instanceof Error ? cause.message : "No se pudo guardar.",
    status: statusDe(cause),
  };
}

/** Las facciones que trae la ficha más la recién creada, si cabe (máximo 2) y no estaba. */
function sumarFaccion(form: EditorForm, slug: string): EditorForm {
  if (form.factions.length >= 2 || form.factions.includes(slug)) {
    return form;
  }
  return { ...form, factions: [...form.factions, slug] };
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
}: Readonly<{
  token: string;
  mode: WizardMode;
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
}>) {
  const [detail, setDetail] = useState<VtuberDetail | null>(initial);
  const [form, setForm] = useState<EditorForm>(() =>
    initial ? formFromDetail(initial) : emptyForm(),
  );
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<SaveFailure | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [nextDex, setNextDex] = useState<number | null>(null);
  const [origin, setOrigin] = useState("");
  const [factionDialog, setFactionDialog] = useState(false);
  const [finished, setFinished] = useState(false);
  // El correo no es parte de la ficha (es confidencial y vive aparte): se edita y se guarda por su propia ruta.
  const correoInicial = initial?.email ?? "";
  const [email, setEmail] = useState(correoInicial);
  const [emailSaved, setEmailSaved] = useState(correoInicial);
  const [savingEmail, setSavingEmail] = useState(false);

  /*
   * Los manejadores que bajan a los pasos van en `useCallback`: el componente ya memoiza `items` y el
   * parche, y así los pasos reciben siempre la misma función en vez de una nueva en cada tecla.
   */
  const set = useCallback(
    <K extends keyof EditorForm>(key: K, value: EditorForm[K]) =>
      setForm((actual) => ({ ...actual, [key]: value })),
    [],
  );

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
        themeColor:
          Boolean(detail?.themeColor) ||
          form.themeColor.toLowerCase() !== DEFAULT_THEME,
        factions: form.factions.length,
        phrase: Boolean(form.phrase.trim()),
        cardText: Boolean(form.cardText.trim()),
        stats: form.stats.filter((stat) => stat.label.trim()).length,
        socials: form.socials.filter((social) => social.url.trim()).length,
        profile: form.profile.filter((field) => field.label.trim()).length,
        skills: form.skills.filter(
          (skill) => skill.name.trim() || skill.effect.trim(),
        ).length,
      }),
    [form, detail],
  );
  const total = percent(items);

  const { patch, errors } = useMemo(
    () =>
      detail ? buildPatch(detail, form) : { patch: {}, errors: [] as string[] },
    [detail, form],
  );
  const changes = contarCambios(detail, patch, form);
  const lastIndex = STEPS.length - 1;
  const nameMissing = !form.name.trim();
  const normalizedSlug = slugifyUrl(form.slug);

  const adopt = useCallback(
    (next: VtuberDetail) => {
      setDetail(next);
      setForm(formFromDetail(next));
      setSavedAt(new Date().toISOString());
      onChanged(next);
    },
    [onChanged],
  );

  const fail = useCallback(
    (cause: unknown, requested: { dex: boolean; slug: boolean }) => {
      const failure = fallaDeGuardado(cause);
      setError(failure);
      const kind = conflictKind(failure, requested.dex, requested.slug);
      notify(
        "error",
        kind === "slug"
          ? `${failure.message}. Esa dirección ya está en uso.`
          : failure.message,
      );
    },
    [notify],
  );

  /** Guarda el correo si cambió. `false` = falló (ya avisó) y no hay que seguir. */
  const persistEmail = useCallback(
    async (id: number): Promise<boolean> => {
      const wanted = email.trim();
      if (wanted === emailSaved.trim()) {
        return true;
      }
      try {
        const response = await api.setVtuberEmail(token, id, wanted || null);
        const stored = response.email ?? "";
        setEmail(stored);
        setEmailSaved(stored);
        notify(...avisoDeCorreo(stored, response.bienvenida));
        return true;
      } catch (cause) {
        const failure = fallaDeCorreo(cause);
        setError(failure);
        notify("error", failure.message);
        return false;
      }
    },
    [email, emailSaved, token, notify],
  );

  const saveEmailOnly = useCallback(async () => {
    if (!detail) {
      return;
    }
    setError(null);
    setSavingEmail(true);
    try {
      await persistEmail(detail.id);
    } finally {
      setSavingEmail(false);
    }
  }, [detail, persistEmail]);

  /** Paso 1 del modo create: crea el borrador. */
  const crearBorrador = useCallback(async (): Promise<boolean> => {
    const { body } = createBody(form);
    if (!body) {
      setAttempted(true);
      return false;
    }
    setSaving(true);
    try {
      const created = await api.createVtuber(token, body);
      adopt(created);
      notify(
        "ok",
        `Borrador «${created.name}» creado con el número #${created.dexNumber}.`,
      );
      // La ficha ya existe: si el correo falla se avisa, pero el borrador no se pierde ni se reintenta crear.
      return await persistEmail(created.id);
    } catch (cause) {
      fail(cause, {
        dex: body.dexNumber !== undefined,
        slug: body.slug !== undefined,
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [form, token, adopt, notify, persistEmail, fail]);

  /** Guarda lo modificado de una ficha que ya existe (sin cambios en la ficha, solo el correo). */
  const guardarCambios = useCallback(
    async (actual: VtuberDetail): Promise<boolean> => {
      if (errors.length > 0) {
        setAttempted(true);
        return false;
      }
      setSaving(true);
      try {
        if (Object.keys(patch).length === 0) {
          // `persistEmail` atrapa sus propios fallos: este camino nunca cae al `catch` de abajo.
          return await persistEmail(actual.id);
        }
        const updated = await api.updateVtuber(token, actual.id, patch);
        /**
         * Solo se adopta la respuesta si trae la ficha entera: una ruta antigua devolvía
         * `{ok, slug, editado}` y adoptarla dejaba el asistente sin nombre ni campos.
         */
        if (updated?.slug) {
          adopt(updated);
        } else {
          setSavedAt(new Date().toISOString());
        }
        notify("ok", "Cambios guardados.");
        return await persistEmail(actual.id);
      } catch (cause) {
        fail(cause, {
          dex: patch.dexNumber !== undefined,
          slug: patch.slug !== undefined,
        });
        return false;
      } finally {
        setSaving(false);
      }
    },
    [errors, patch, token, adopt, notify, persistEmail, fail],
  );

  /** Crea (paso 1 del modo create) o guarda lo modificado. `true` = se puede continuar. */
  const persist = useCallback(async (): Promise<boolean> => {
    setError(null);
    return detail ? guardarCambios(detail) : crearBorrador();
  }, [detail, guardarCambios, crearBorrador]);

  const goNext = useCallback(async () => {
    if (await persist()) {
      setIndex((actual) => Math.min(actual + 1, lastIndex));
    }
  }, [persist, lastIndex]);
  const finish = async () => {
    if (!(await persist())) {
      return;
    }
    if (mode === "create") {
      setFinished(true);
    }
  };
  const guardarYSalir = useCallback(async () => {
    if (await persist()) {
      onExit();
    }
  }, [persist, onExit]);
  const guardar = useCallback(() => void persist(), [persist]);
  const siguiente = useCallback(() => void goNext(), [goNext]);
  const salir = useCallback(() => void guardarYSalir(), [guardarYSalir]);
  const atras = useCallback(() => setIndex((actual) => actual - 1), []);

  // La dirección no se escribe a mano: sale SIEMPRE del nombre, también al editar (la anterior sigue
  // redirigiendo por `slug_alias`), así nombre y URL no pueden desincronizarse.
  const onNameChange = useCallback(
    (name: string) =>
      setForm((actual) => ({ ...actual, name, slug: slugifyUrl(name) })),
    [],
  );

  const jumpToFirstPending = useCallback(() => {
    const pending = items.find((item) => !item.optional && !item.ok);
    setIndex(
      STEPS.findIndex((paso) => paso.id === (pending?.step ?? "revision")),
    );
  }, [items]);

  const saltarAPaso = useCallback(
    (target: StepId) =>
      setIndex(STEPS.findIndex((candidate) => candidate.id === target)),
    [],
  );
  const abrirDialogoDeFaccion = useCallback(() => setFactionDialog(true), []);
  const cerrarDialogoDeFaccion = useCallback(() => setFactionDialog(false), []);
  const alCrearFaccion = useCallback((faction: FactionRow) => {
    setFactionDialog(false);
    setForm((currentForm) => sumarFaccion(currentForm, faction.slug));
  }, []);

  const conflict = conflictoDelFormulario(error, patch, detail, form);
  const pasoActual = STEPS[index];

  if (finished && detail) {
    return (
      <WizardDone
        detail={detail}
        onCreateAnother={onCreateAnother}
        onExit={onExit}
      />
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (mode === "edit") {
      void persist();
      return;
    }
    void (index === lastIndex ? finish() : goNext());
  };

  return (
    <>
      <form
        className="rounded-2xl border border-dex-line bg-dex-panel/60"
        data-testid="admin-editor"
        onSubmit={onSubmit}
      >
        <CabeceraDelAsistente
          mode={mode}
          detail={detail}
          formName={form.name}
          total={total}
          index={index}
          items={items}
          onSelect={setIndex}
        />

        {mode === "edit" && detail && form.status !== "published" && (
          <AvisoDeBorrador
            status={form.status}
            onContinue={jumpToFirstPending}
          />
        )}

        <section aria-labelledby="wizard-step-title" className="space-y-4 p-5">
          <div>
            <h3
              id="wizard-step-title"
              className="text-base font-bold text-dex-ink"
            >
              Paso {index + 1} de {STEPS.length}: {pasoActual.label}
            </h3>
            <p className="text-xs text-dex-muted">{pasoActual.help}</p>
          </div>

          <PasoDelAsistente
            stepId={pasoActual.id}
            form={form}
            set={set}
            setForm={setForm}
            mode={mode}
            token={token}
            detail={detail}
            setDetail={setDetail}
            nextDex={nextDex}
            origin={origin}
            countryOptions={countryOptions}
            languageOptions={languageOptions}
            onNameChange={onNameChange}
            email={email}
            onEmailChange={setEmail}
            emailDirty={Boolean(detail) && email.trim() !== emailSaved.trim()}
            savingEmail={savingEmail}
            onSaveEmail={saveEmailOnly}
            factions={factions}
            onCreateFaction={abrirDialogoDeFaccion}
            items={items}
            normalizedSlug={normalizedSlug}
            onJump={saltarAPaso}
          />
        </section>

        {/* Barra pegada al borde inferior: el resultado se ve donde está el foco. */}
        <footer className="sticky bottom-0 space-y-2 rounded-b-2xl border-t border-dex-line bg-dex-panel/95 p-4 backdrop-blur">
          <AvisosDelGuardado
            detail={detail}
            errors={errors}
            attempted={attempted}
            nameMissing={nameMissing}
            error={error}
            conflict={conflict}
            normalizedSlug={normalizedSlug}
            savedAt={savedAt}
          />
          <BotoneraDelAsistente
            mode={mode}
            detail={detail}
            index={index}
            lastIndex={lastIndex}
            saving={saving}
            nameMissing={nameMissing}
            changes={changes}
            errors={errors}
            submitLabel={etiquetaDeEnvio(mode, index === lastIndex)}
            onBack={atras}
            onSaveAndExit={salir}
            onSave={guardar}
            onNext={siguiente}
          />
          <PistasDelAsistente
            mode={mode}
            detail={detail}
            nameMissing={nameMissing}
            changes={changes}
            errors={errors}
          />
        </footer>
      </form>
      {factionDialog && (
        <Dialog title="Nueva facción" onClose={cerrarDialogoDeFaccion}>
          <FactionWizard
            token={token}
            factions={factions}
            onItems={onFactionsChanged}
            onClose={cerrarDialogoDeFaccion}
            onDone={alCrearFaccion}
          />
        </Dialog>
      )}
    </>
  );
}
