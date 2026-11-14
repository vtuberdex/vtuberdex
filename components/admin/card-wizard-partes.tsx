// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Piezas PRESENTACIONALES del asistente de carta (`card-wizard.tsx`).
 *
 * El asistente era un solo componente de casi 700 líneas con toda la cabecera, los ocho pasos, los avisos y
 * la botonera en el mismo JSX: cada `&&` y cada ternario sumaban a una única función (complejidad 82) y
 * leerla obligaba a seguir media docena de condiciones cruzadas por modo y por estado. Aquí cada trozo
 * recibe lo que necesita ya calculado y decide UNA cosa; el estado, el guardado y la navegación siguen
 * viviendo en `CardWizard` (cambiar de paso no pierde nada, ver allí el porqué).
 */
import type { Dispatch, ReactNode, SetStateAction } from "react";
import Link from "next/link";

import type { FactionRow, VtuberDetail } from "@/lib/types";
import type { ChipOption } from "@/components/admin/chip-picker";
import {
  stepComplete,
  type CheckItem,
  type StepId,
} from "@/components/admin/completeness";
import type { EditorForm } from "@/components/admin/form-model";
import { AttributesStep } from "@/components/admin/steps/attributes-step";
import { SkillsStep } from "@/components/admin/steps/skills-step";
import { SocialsStep } from "@/components/admin/steps/socials-step";
import { ColorsStep } from "@/components/admin/steps/colors-step";
import { IdentityStep } from "@/components/admin/steps/identity-step";
import { ImagesStep } from "@/components/admin/steps/images-step";
import { ReviewStep } from "@/components/admin/steps/review-step";
import { StoryStep } from "@/components/admin/steps/story-step";
import type { StepProps } from "@/components/admin/steps/types";
import { ghostButton, primaryButton, Reason } from "@/components/admin/ui";

export type WizardMode = "create" | "edit";

export interface SaveFailure {
  message: string;
  status?: number;
}

export const STEPS: Array<{ id: StepId; label: string; help: string }> = [
  {
    id: "identidad",
    label: "Identidad",
    help: "Nombre, dirección de la página, país y número.",
  },
  { id: "imagenes", label: "Imágenes", help: "Personaje, logo y fondo." },
  {
    id: "colores",
    label: "Colores y facciones",
    help: "El color de la carta y su(s) facción(es).",
  },
  { id: "historia", label: "Historia", help: "Frase, lore y datos de perfil." },
  {
    id: "atributos",
    label: "Atributos",
    help: "Los números que se dibujan como barras (vida, ataque…).",
  },
  {
    id: "habilidades",
    label: "Habilidades",
    help: "El kit del RPG: 2 activas, 2 pasivas y la Ultimate.",
  },
  { id: "redes", label: "Redes sociales", help: "Los enlaces a sus canales." },
  {
    id: "revision",
    label: "Revisar y publicar",
    help: "Comprueba y decide si se publica.",
  },
];

export const stepLabel = (id: StepId) =>
  STEPS.find((step) => step.id === id)?.label ?? id;

export const GUARDAR_CAMBIOS = "Guardar cambios";
const GUARDANDO = "Guardando…";

/** Texto del botón principal del modo crear (en el último paso finaliza). */
export function etiquetaDeEnvio(mode: WizardMode, ultimo: boolean): string {
  if (mode === "edit") {
    return GUARDAR_CAMBIOS;
  }
  return ultimo ? "Finalizar" : "Siguiente";
}

function etiquetaDeGuardar(mode: WizardMode, saving: boolean): string {
  if (saving) {
    return GUARDANDO;
  }
  return mode === "edit" ? GUARDAR_CAMBIOS : "Guardar";
}

/** Color de la marca de cada paso: completo, incompleto o «no aplica» (`null`). */
function claseDeCompletitud(complete: boolean | null): string {
  if (complete) {
    return "text-emerald-300";
  }
  return complete === false ? "text-amber-300" : "";
}

export function WizardDone({
  detail,
  onCreateAnother,
  onExit,
}: Readonly<{
  detail: VtuberDetail;
  onCreateAnother?: () => void;
  onExit: () => void;
}>) {
  const publicada = detail.status === "published";
  return (
    <div
      className="space-y-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6"
      data-testid="wizard-done"
    >
      <h2 className="text-xl font-extrabold text-dex-ink">
        ¡Carta «{detail.name}» lista!
      </h2>
      <p className="text-sm text-dex-muted">
        {publicada
          ? "Ya es pública."
          : "Quedó como borrador: no se ve en el catálogo hasta que la publiques."}
      </p>
      <div className="flex flex-wrap gap-2">
        {publicada && (
          <Link
            href={`/v/${detail.slug}`}
            className={primaryButton}
            target="_blank"
          >
            Ver la página pública
          </Link>
        )}
        {onCreateAnother && (
          <button
            type="button"
            className={ghostButton}
            onClick={onCreateAnother}
          >
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

function TituloDelAsistente({
  mode,
  detail,
  formName,
}: Readonly<{
  mode: WizardMode;
  detail: VtuberDetail | null;
  formName: string;
}>) {
  if (mode === "create" && !detail) {
    return <>Nueva carta</>;
  }
  return <>{(detail?.name ?? formName) || "Sin nombre"}</>;
}

function DireccionDeLaFicha({ detail }: Readonly<{ detail: VtuberDetail }>) {
  return (
    <p className="font-mono text-xs text-dex-muted">
      #{String(detail.dexNumber).padStart(3, "0")} ·{" "}
      {detail.status === "published" ? (
        <Link href={`/v/${detail.slug}`} className="hover:text-dex-ink">
          /v/{detail.slug}
        </Link>
      ) : (
        <span>/v/{detail.slug}</span>
      )}
    </p>
  );
}

function NavDePasos({
  items,
  index,
  bloqueados,
  onSelect,
}: Readonly<{
  items: CheckItem[];
  index: number;
  /** Sin borrador creado solo se puede estar en el paso 1. */
  bloqueados: boolean;
  onSelect: (i: number) => void;
}>) {
  return (
    <nav aria-label="Pasos de la carta">
      <ol className="flex flex-wrap gap-1.5">
        {STEPS.map((item, i) => {
          const complete = stepComplete(items, item.id);
          const locked = bloqueados && i > 0;
          const actual = i === index;
          return (
            <li key={item.id}>
              <button
                type="button"
                disabled={locked}
                title={
                  locked ? "Primero crea el borrador en el paso 1" : item.help
                }
                aria-current={actual ? "step" : undefined}
                onClick={() => onSelect(i)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${
                  actual
                    ? "border-dex-accent bg-dex-accent/15 text-dex-ink"
                    : "border-dex-line text-dex-muted hover:text-dex-ink"
                }`}
              >
                <span aria-hidden className={claseDeCompletitud(complete)}>
                  {complete ? "✓" : i + 1}
                </span>
                {item.label}
                {complete && <span className="sr-only"> (completo)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function CabeceraDelAsistente({
  mode,
  detail,
  formName,
  total,
  index,
  items,
  onSelect,
}: Readonly<{
  mode: WizardMode;
  detail: VtuberDetail | null;
  formName: string;
  total: number;
  index: number;
  items: CheckItem[];
  onSelect: (i: number) => void;
}>) {
  return (
    <header className="space-y-3 p-5 pb-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-extrabold text-dex-ink">
            <TituloDelAsistente
              mode={mode}
              detail={detail}
              formName={formName}
            />
          </h2>
          {detail && <DireccionDeLaFicha detail={detail} />}
        </div>
        <p
          className="font-mono text-xs text-dex-muted"
          data-testid="wizard-percent"
        >
          {total}% completa
        </p>
      </div>
      {/*
        `<progress>` nativo en vez de un div con role="progressbar": el lector de pantalla lo anuncia igual
        y no hay que mantener a mano aria-valuenow/min/max. Las pseudo-clases pintan la misma barra fina.
      */}
      <progress
        aria-label="Progreso del asistente"
        max={STEPS.length}
        value={index + 1}
        className="block h-1.5 w-full appearance-none overflow-hidden rounded-full border-0 bg-white/10 [&::-moz-progress-bar]:bg-dex-accent [&::-webkit-progress-bar]:bg-white/10 [&::-webkit-progress-value]:bg-dex-accent [&::-webkit-progress-value]:transition-all"
      />
      <NavDePasos
        items={items}
        index={index}
        bloqueados={!detail}
        onSelect={onSelect}
      />
    </header>
  );
}

export function AvisoDeBorrador({
  status,
  onContinue,
}: Readonly<{ status: EditorForm["status"]; onContinue: () => void }>) {
  return (
    <p
      data-testid="admin-draft-notice"
      className="mx-5 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-amber-100"
    >
      <span>
        Esta carta está en{" "}
        <strong>{status === "draft" ? "borrador" : "oculta"}</strong>: no se ve
        en el catálogo hasta que la publiques (último paso).
      </span>
      <button type="button" className={ghostButton} onClick={onContinue}>
        Continuar asistente
      </button>
    </p>
  );
}

/** Todo lo que puede necesitar cualquiera de los pasos; cada uno toma lo suyo. */
export interface PropsDePaso {
  stepId: StepId;
  form: EditorForm;
  set: StepProps["set"];
  setForm: Dispatch<SetStateAction<EditorForm>>;
  mode: WizardMode;
  token: string;
  detail: VtuberDetail | null;
  setDetail: (detail: VtuberDetail) => void;
  nextDex: number | null;
  origin: string;
  countryOptions: ChipOption[];
  languageOptions: ChipOption[];
  onNameChange: (name: string) => void;
  email: string;
  onEmailChange: (email: string) => void;
  emailDirty: boolean;
  savingEmail: boolean;
  onSaveEmail: () => void;
  factions: FactionRow[];
  onCreateFaction: () => void;
  items: CheckItem[];
  normalizedSlug: string;
  onJump: (step: StepId) => void;
}

/**
 * Un pintor por paso en una tabla en vez de ocho `step.id === … &&` seguidos: elegir el paso es una
 * búsqueda y cada pintor solo lee las props que su paso usa.
 */
const PINTOR_DE_PASO: Record<StepId, (p: PropsDePaso) => ReactNode> = {
  identidad: (p) => (
    <IdentityStep
      form={p.form}
      set={p.set}
      setForm={p.setForm}
      mode={p.mode}
      nextDex={p.nextDex}
      currentDex={p.detail?.dexNumber ?? null}
      currentSlug={p.detail?.slug ?? null}
      origin={p.origin}
      countryOptions={p.countryOptions}
      languageOptions={p.languageOptions}
      onNameChange={p.onNameChange}
      email={p.email}
      onEmailChange={p.onEmailChange}
      emailDirty={p.emailDirty}
      savingEmail={p.savingEmail}
      onSaveEmail={p.onSaveEmail}
    />
  ),
  imagenes: (p) =>
    p.detail ? (
      <ImagesStep token={p.token} detail={p.detail} onUpdated={p.setDetail} />
    ) : null,
  colores: (p) => (
    <ColorsStep
      form={p.form}
      set={p.set}
      factions={p.factions}
      onCreateFaction={p.onCreateFaction}
    />
  ),
  historia: (p) => <StoryStep form={p.form} set={p.set} />,
  atributos: (p) => <AttributesStep form={p.form} set={p.set} />,
  habilidades: (p) => (
    <SkillsStep form={p.form} set={p.set} factions={p.factions} />
  ),
  redes: (p) => <SocialsStep form={p.form} set={p.set} />,
  revision: (p) => (
    <ReviewStep
      form={p.form}
      set={p.set}
      items={p.items}
      slug={p.detail?.slug ?? p.normalizedSlug}
      onJump={p.onJump}
      stepLabel={stepLabel}
    />
  ),
};

export function PasoDelAsistente(props: Readonly<PropsDePaso>) {
  return <>{PINTOR_DE_PASO[props.stepId](props)}</>;
}

/** La lista de errores de validación sale con la ficha cargada o tras intentar crear sin nombre. */
function hayInvalidos(
  detail: VtuberDetail | null,
  errors: string[],
  attempted: boolean,
  nameMissing: boolean,
): boolean {
  if (detail) {
    return errors.length > 0;
  }
  return attempted && nameMissing;
}

export function AvisosDelGuardado({
  detail,
  errors,
  attempted,
  nameMissing,
  error,
  conflict,
  normalizedSlug,
  savedAt,
}: Readonly<{
  detail: VtuberDetail | null;
  errors: string[];
  attempted: boolean;
  nameMissing: boolean;
  error: SaveFailure | null;
  conflict: "dex" | "slug" | null;
  normalizedSlug: string;
  savedAt: string | null;
}>) {
  const mensajes = detail ? errors : ["Escribe un nombre para continuar."];
  return (
    <>
      {hayInvalidos(detail, errors, attempted, nameMissing) && (
        <ul
          role="alert"
          data-testid="admin-editor-invalid"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          {mensajes.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
      {error && (
        <div
          role="alert"
          data-testid="admin-editor-error"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          <p>{error.message}</p>
          {conflict === "dex" && (
            <p
              className="mt-1 text-xs text-red-100/80"
              data-testid="admin-dex-hint"
            >
              Ese número ya está en uso. Para quedarte con él, abre primero a la
              ficha que lo tiene y muévela a un número libre (por ejemplo,
              «Mandar al final»); después vuelve a guardar esta.
            </p>
          )}
          {conflict === "slug" && (
            <p
              className="mt-1 text-xs text-red-100/80"
              data-testid="admin-slug-hint"
            >
              Esa dirección de página ya la usa otra carta. Prueba con «
              {normalizedSlug || "nombre"}-2» u otra variante.
            </p>
          )}
        </div>
      )}
      {savedAt && !error && (
        <output
          data-testid="admin-editor-saved"
          className="block rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200"
        >
          Guardado a las {new Date(savedAt).toLocaleTimeString("es-CL")}
        </output>
      )}
    </>
  );
}

/** Sin cambios o con errores de validación no hay nada que guardar. */
function nadaQueGuardar(
  changes: number,
  detail: VtuberDetail | null,
  errors: string[],
): boolean {
  return changes === 0 || (detail !== null && errors.length > 0);
}

/** «Guardar» a mano: siempre al editar; al crear, solo cuando el borrador ya existe. */
function BotonGuardar({
  mode,
  detail,
  saving,
  changes,
  errors,
  onSave,
}: Readonly<{
  mode: WizardMode;
  detail: VtuberDetail | null;
  saving: boolean;
  changes: number;
  errors: string[];
  onSave: () => void;
}>) {
  const editando = mode === "edit";
  if (!editando && !detail) {
    return null;
  }
  return (
    <button
      type={editando ? "submit" : "button"}
      className={ghostButton}
      disabled={saving || nadaQueGuardar(changes, detail, errors)}
      onClick={editando ? undefined : onSave}
    >
      {etiquetaDeGuardar(mode, saving)}
    </button>
  );
}

export function BotoneraDelAsistente({
  mode,
  detail,
  index,
  lastIndex,
  saving,
  nameMissing,
  changes,
  errors,
  submitLabel,
  onBack,
  onSaveAndExit,
  onSave,
  onNext,
}: Readonly<{
  mode: WizardMode;
  detail: VtuberDetail | null;
  index: number;
  lastIndex: number;
  saving: boolean;
  nameMissing: boolean;
  changes: number;
  errors: string[];
  submitLabel: string;
  onBack: () => void;
  onSaveAndExit: () => void;
  onSave: () => void;
  onNext: () => void;
}>) {
  const creando = mode === "create";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        className={ghostButton}
        disabled={index === 0 || saving}
        onClick={onBack}
      >
        ← Atrás
      </button>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {creando && (
          <button
            type="button"
            className={ghostButton}
            disabled={saving || nameMissing}
            onClick={onSaveAndExit}
          >
            Guardar y salir
          </button>
        )}
        <BotonGuardar
          mode={mode}
          detail={detail}
          saving={saving}
          changes={changes}
          errors={errors}
          onSave={onSave}
        />
        {!creando && index < lastIndex && (
          <button
            type="button"
            className={ghostButton}
            disabled={saving}
            onClick={onNext}
          >
            Siguiente →
          </button>
        )}
        {creando && (
          <button
            type="submit"
            className={primaryButton}
            disabled={saving || (!detail && nameMissing)}
          >
            {saving ? GUARDANDO : submitLabel}
          </button>
        )}
      </div>
    </div>
  );
}

function AvisoDeCambios({ changes }: Readonly<{ changes: number }>) {
  if (changes === 0) {
    return (
      <p className="text-[11px] text-dex-muted">
        Sin cambios pendientes: no hay nada que guardar.
      </p>
    );
  }
  return (
    <p className="text-[11px] text-dex-muted">
      {changes} {changes === 1 ? "campo modificado" : "campos modificados"} sin
      guardar.
    </p>
  );
}

export function PistasDelAsistente({
  mode,
  detail,
  nameMissing,
  changes,
  errors,
}: Readonly<{
  mode: WizardMode;
  detail: VtuberDetail | null;
  nameMissing: boolean;
  changes: number;
  errors: string[];
}>) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      {mode === "create" && !detail && nameMissing && (
        <Reason>Escribe un nombre para continuar.</Reason>
      )}
      {mode === "edit" && <AvisoDeCambios changes={changes} />}
      {detail && errors.length > 0 && (
        <Reason>Corrige los errores marcados para poder guardar.</Reason>
      )}
    </div>
  );
}
