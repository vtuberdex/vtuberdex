'use client';
/**
 * Asistente de 3 pasos para crear una facción: nombre -> emblema -> confirmar.
 *
 * Por qué un asistente y no un formulario: crear una facción es dos operaciones del
 * servidor (alta y subida del PNG), y una persona que llega por primera vez no sabe que
 * el emblema importa tanto (la carta lo dibuja como holograma en la cabecera). Ir paso a
 * paso permite explicar qué imagen sirve ANTES de elegirla, mostrarla sobre el mismo
 * engarce oscuro de la carta y, si se omite, avisar de lo que se pierde.
 *
 * Si la subida falla DESPUÉS de crear, la facción ya existe: no se vuelve a crear (daría
 * un duplicado), se avisa y se deja subir el emblema desde su tarjeta.
 */
import { useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { aPngCuadrado } from '@/lib/imagen-cliente';
import type { FactionRow } from '@/lib/types';
import { EmblemDropzone, useObjectUrl } from '@/components/admin/emblem-dropzone';
import { slugifyUrl } from '@/components/admin/form-model';
import { EmblemSocket, Field, ghostButton, inputClass, primaryButton, Reason } from '@/components/admin/ui';

const STEPS = ['Nombre', 'Emblema', 'Confirmar'] as const;

/** ¿Ya existe una facción con este nombre (ignorando mayúsculas, tildes y espacios)? */
export function buscarFaccionDuplicada(label: string, factions: FactionRow[]): FactionRow | undefined {
  const slug = slugifyUrl(label);
  if (!slug) return undefined;
  return factions.find((faction) => faction.slug === slug || slugifyUrl(faction.label) === slug);
}

export function FactionWizard({
  token,
  factions,
  onItems,
  onAssign,
  onDone,
  onClose,
}: {
  token: string;
  factions: FactionRow[];
  onItems: (items: FactionRow[]) => void;
  /** «Asignarla a una ficha»: lleva a la sección de fichas. Ausente al abrirlo desde una ficha. */
  onAssign?: () => void;
  /** Al abrirlo desde el asistente de una carta: vuelve con la facción creada. */
  onDone?: (faction: FactionRow) => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ faction: FactionRow; emblemFailed: string | null } | null>(null);
  const preview = useObjectUrl(file);

  const trimmed = name.trim();
  const duplicate = useMemo(() => buscarFaccionDuplicada(trimmed, factions), [trimmed, factions]);
  const nameProblem = !trimmed ? 'Escribe el nombre de la facción para continuar.' : duplicate ? `Ya existe «${duplicate.label}». Elige otro nombre o usa la que ya existe.` : null;

  const reset = () => {
    setStep(0);
    setName('');
    setFile(null);
    setSkipped(false);
    setError(null);
    setCreated(null);
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const { faction, items } = await api.createFaction(token, { label: trimmed });
      onItems(items);
      let emblemFailed: string | null = null;
      let finalFaction = faction;
      if (file) {
        try {
          const uploaded = await api.uploadFactionEmblem(token, faction.id, await aPngCuadrado(file));
          onItems(uploaded.items);
          finalFaction = uploaded.faction ?? faction;
        } catch (cause) {
          emblemFailed = cause instanceof Error ? cause.message : 'error al subir el emblema';
        }
      }
      setCreated({ faction: finalFaction, emblemFailed });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear la facción.');
    } finally {
      setBusy(false);
    }
  };

  if (created) {
    return (
      <div className="space-y-4" data-testid="faction-wizard-done">
        <h2 className="text-lg font-extrabold text-dex-ink">¡Facción «{created.faction.label}» creada!</h2>
        <EmblemSocket icon={created.faction.icon} previewUrl={created.faction.icon ? undefined : preview} />
        {created.emblemFailed && (
          <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            La facción se creó, pero el emblema no se pudo subir ({created.emblemFailed}). Súbelo desde su tarjeta con «Cambiar emblema».
          </p>
        )}
        {!created.faction.icon && !created.emblemFailed && (
          <p className="text-sm text-amber-100">Quedó sin emblema: la carta mostrará solo el nombre hasta que subas uno.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {onDone ? (
            <button type="button" className={primaryButton} onClick={() => onDone(created.faction)}>
              Volver a la ficha
            </button>
          ) : (
            <>
              <button type="button" className={primaryButton} onClick={reset}>
                Crear otra
              </button>
              {onAssign && (
                <button type="button" className={ghostButton} onClick={onAssign}>
                  Asignarla a una ficha
                </button>
              )}
              <button type="button" className={ghostButton} onClick={onClose}>
                Cerrar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      data-testid="faction-wizard"
      onSubmit={(event) => {
        event.preventDefault();
        if (step === 0 && !nameProblem) setStep(1);
        else if (step === 1 && (file || skipped)) setStep(2);
        else if (step === 2 && !busy) void create();
      }}
    >
      <header>
        <h2 className="text-lg font-extrabold text-dex-ink">Nueva facción</h2>
        <ol className="mt-2 flex gap-2" aria-label="Pasos">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`rounded-full border px-3 py-0.5 text-xs ${
                index === step ? 'border-dex-accent text-dex-ink' : index < step ? 'border-emerald-500/50 text-emerald-200' : 'border-dex-line text-dex-muted'
              }`}
            >
              {index < step ? '✓ ' : `${index + 1}. `}
              {label}
            </li>
          ))}
        </ol>
      </header>

      {step === 0 && (
        <div className="space-y-2">
          <p className="text-sm text-dex-muted">Un nombre corto, tal como lo verá la gente. Ejemplo: «Mythical Legacy».</p>
          <Field label="Nombre de la facción">
            <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className={inputClass} aria-invalid={Boolean(duplicate)} />
          </Field>
          {trimmed && nameProblem && (
            <p role="alert" data-testid="faction-name-problem" className="text-xs text-red-300">
              {nameProblem}
            </p>
          )}
          {trimmed && !nameProblem && <p className="text-xs text-emerald-300">✓ Nombre disponible.</p>}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <p className="text-sm text-dex-muted">
            El emblema aparece en la cabecera de la carta, pequeño y como holograma. Consejos para que se vea bien:
          </p>
          <ul className="list-disc space-y-1 pl-5 text-xs text-dex-muted">
            <li>Cuadrado (si no lo es, se centra solo).</li>
            <li>Trazo CLARO: el holograma brilla donde la imagen es clara.</li>
            <li>Fondo transparente u oscuro, nunca blanco.</li>
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <EmblemSocket previewUrl={preview} size={112} />
            <div className="min-w-0 flex-1">
              <EmblemDropzone
                onFile={(next) => {
                  setFile(next);
                  setSkipped(false);
                }}
                buttonLabel={file ? 'Elegir otro archivo' : 'Elegir archivo'}
              />
            </div>
          </div>
          {file && <p className="text-xs text-emerald-300">✓ {file.name}</p>}
          {!file && !skipped && (
            <button type="button" className={ghostButton} onClick={() => setSkipped(true)}>
              Omitir por ahora
            </button>
          )}
          {skipped && !file && (
            <p role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Sin emblema la carta no mostrará el holograma de esta facción. Podrás subirlo después desde su tarjeta.
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-dex-muted">Revisa y confirma. Se creará la facción y, si elegiste uno, se subirá su emblema.</p>
          <div className="flex items-center gap-4 rounded-xl border border-dex-line p-3">
            <EmblemSocket previewUrl={preview} />
            <div>
              <p className="font-bold text-dex-ink">{trimmed}</p>
              <p className="text-xs text-dex-muted">{file ? `Emblema: ${file.name}` : 'Sin emblema por ahora'}</p>
            </div>
          </div>
          {error && (
            <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className={ghostButton} onClick={step === 0 ? onClose : () => setStep(step - 1)} disabled={busy}>
          {step === 0 ? 'Cancelar' : 'Atrás'}
        </button>
        <div className="flex flex-col items-end gap-1">
          {step === 0 && !trimmed ? <Reason>Escribe un nombre para continuar.</Reason> : step === 1 && !file && !skipped ? <Reason>Elige un archivo u omite este paso.</Reason> : null}
          {step < 2 ? (
            <button type="submit" className={primaryButton} disabled={step === 0 ? Boolean(nameProblem) : !file && !skipped}>
              Siguiente
            </button>
          ) : (
            <button type="submit" className={primaryButton} disabled={busy}>
              {busy ? 'Creando…' : 'Crear facción'}
            </button>
          )}
        </div>
      </footer>
    </form>
  );
}
