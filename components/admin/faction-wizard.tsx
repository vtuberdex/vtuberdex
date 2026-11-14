// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
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
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type SubmitEvent,
  type SetStateAction,
} from "react";

import { api } from "@/lib/api";
import { aPngCuadrado } from "@/lib/imagen-cliente";
import type { FactionRow } from "@/lib/types";
import {
  EmblemDropzone,
  useObjectUrl,
} from "@/components/admin/emblem-dropzone";
import { slugifyUrl } from "@/components/admin/form-model";
import {
  EmblemSocket,
  Field,
  ghostButton,
  inputClass,
  primaryButton,
  Reason,
} from "@/components/admin/ui";

const STEPS = ["Nombre", "Emblema", "Confirmar"] as const;

/** ¿Ya existe una facción con este nombre (ignorando mayúsculas, tildes y espacios)? */
export function buscarFaccionDuplicada(
  label: string,
  factions: FactionRow[],
): FactionRow | undefined {
  const slug = slugifyUrl(label);
  if (!slug) {
    return undefined;
  }
  return factions.find(
    (faction) => faction.slug === slug || slugifyUrl(faction.label) === slug,
  );
}

/**
 * Quita los `)` del final (y el espacio que los siga), como hacía `/\)+\s*$/` pero sin su backtracking
 * cuadrático: si no hay ningún `)` al final, el texto queda tal cual (con su espacio).
 */
function sinParentesisFinal(texto: string): string {
  const recortado = texto.trimEnd();
  let fin = recortado.length;
  while (fin > 0 && recortado[fin - 1] === ")") {
    fin -= 1;
  }
  return fin === recortado.length ? texto : recortado.slice(0, fin);
}

/**
 * Nombre visible de una SUBFACCIÓN: «Madre (Propia)». Es una convención del catálogo, no una regla
 * del servidor: el paréntesis solo se muestra en la ficha y la relación real se guarda aparte
 * (`parentId`), así que renombrar la madre después no rompe la herencia de estados.
 */
export function nombreDeSubfaccion(madreLabel: string, propio: string): string {
  const madre = madreLabel.trim();
  const texto = propio.trim();
  if (!madre) {
    return texto;
  }
  if (!texto) {
    return `${madre} ()`;
  }
  const minuscula = texto.toLowerCase();
  const madreMinuscula = madre.toLowerCase();
  if (minuscula.startsWith(`${madreMinuscula} (`) && texto.endsWith(")")) {
    return texto;
  }
  const resto = minuscula.startsWith(madreMinuscula)
    ? sinParentesisFinal(texto.slice(madre.length).replace(/^[\s(]+/, ""))
    : texto;
  return resto ? `${madre} (${resto})` : `${madre} ()`;
}

/**
 * ¿Falta decir DE QUIÉN es la subfacción? Al marcar «sí, pertenece a otra facción» hay que elegir la
 * madre: una hija sin madre no acredita los estados exclusivos de nadie —el nombre «Madre (Propia)»
 * parece una subfacción, pero para el validador es una facción raíz con paréntesis—. Vive aparte de
 * la pantalla para poder probarlo sin montar el asistente.
 */
export function faltaMadre(
  conMadre: boolean,
  parentId: number | null,
): boolean {
  return conMadre && parentId === null;
}

/** Por qué el nombre no sirve todavía: vacío o repetido; `null` si sirve. */
function problemaDelNombre(
  trimmed: string,
  duplicate: FactionRow | undefined,
): string | null {
  if (!trimmed) {
    return "Escribe el nombre de la facción para continuar.";
  }
  if (duplicate) {
    return `Ya existe «${duplicate.label}». Elige otro nombre o usa la que ya existe.`;
  }
  return null;
}

/** Color de cada paso del encabezado: el actual, uno ya hecho o uno pendiente. */
function claseDePaso(index: number, step: number): string {
  if (index === step) {
    return "border-dex-accent text-dex-ink";
  }
  return index < step
    ? "border-emerald-500/50 text-emerald-200"
    : "border-dex-line text-dex-muted";
}

interface Creada {
  faction: FactionRow;
  emblemFailed: string | null;
}

function FaccionCreada({
  created,
  preview,
  onDone,
  onReset,
  onAssign,
  onClose,
}: Readonly<{
  created: Creada;
  preview: string | null;
  onDone?: (faction: FactionRow) => void;
  onReset: () => void;
  onAssign?: () => void;
  onClose: () => void;
}>) {
  return (
    <div className="space-y-4" data-testid="faction-wizard-done">
      <h2 className="text-lg font-extrabold text-dex-ink">
        ¡Facción «{created.faction.label}» creada!
      </h2>
      <EmblemSocket
        icon={created.faction.icon}
        previewUrl={created.faction.icon ? undefined : preview}
      />
      {created.emblemFailed && (
        <p
          role="alert"
          className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100"
        >
          La facción se creó, pero el emblema no se pudo subir (
          {created.emblemFailed}). Súbelo desde su tarjeta con «Cambiar
          emblema».
        </p>
      )}
      {!created.faction.icon && !created.emblemFailed && (
        <p className="text-sm text-amber-100">
          Quedó sin emblema: la carta mostrará solo el nombre hasta que subas
          uno.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {onDone ? (
          <button
            type="button"
            className={primaryButton}
            onClick={() => onDone(created.faction)}
          >
            Volver a la ficha
          </button>
        ) : (
          <>
            <button type="button" className={primaryButton} onClick={onReset}>
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

/** Tras escribir algo: por qué no sirve el nombre, o que está disponible. */
function EstadoDelNombre({
  trimmed,
  nameProblem,
}: Readonly<{ trimmed: string; nameProblem: string | null }>) {
  if (!trimmed) {
    return null;
  }
  if (nameProblem) {
    return (
      <p
        role="alert"
        data-testid="faction-name-problem"
        className="text-xs text-red-300"
      >
        {nameProblem}
      </p>
    );
  }
  return <p className="text-xs text-emerald-300">✓ Nombre disponible.</p>;
}

function PieDelAsistenteDeFaccion({
  step,
  busy,
  motivo,
  siguienteDeshabilitado,
  onClose,
  onAtras,
}: Readonly<{
  step: number;
  busy: boolean;
  motivo: string | null;
  siguienteDeshabilitado: boolean;
  onClose: () => void;
  onAtras: () => void;
}>) {
  const primero = step === 0;
  return (
    <footer className="flex flex-wrap items-center justify-between gap-2">
      <button
        type="button"
        className={ghostButton}
        onClick={primero ? onClose : onAtras}
        disabled={busy}
      >
        {primero ? "Cancelar" : "Atrás"}
      </button>
      <div className="flex flex-col items-end gap-1">
        {motivo && <Reason>{motivo}</Reason>}
        {step < 2 ? (
          <button
            type="submit"
            className={primaryButton}
            disabled={siguienteDeshabilitado}
          >
            Siguiente
          </button>
        ) : (
          <button type="submit" className={primaryButton} disabled={busy}>
            {busy ? "Creando…" : "Crear facción"}
          </button>
        )}
      </div>
    </footer>
  );
}

function PasoNombre({
  name,
  onName,
  trimmed,
  duplicate,
  nameProblem,
  conMadre,
  onConMadre,
  parentId,
  onParentId,
  madres,
  madre,
  factions,
  busy,
}: Readonly<{
  name: string;
  onName: Dispatch<SetStateAction<string>>;
  trimmed: string;
  duplicate: FactionRow | undefined;
  nameProblem: string | null;
  conMadre: boolean;
  onConMadre: (valor: boolean) => void;
  parentId: number | null;
  onParentId: (id: number | null) => void;
  madres: FactionRow[];
  madre: FactionRow | null;
  factions: FactionRow[];
  busy: boolean;
}>) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-dex-muted">
        Un nombre corto, tal como lo verá la gente. Ejemplo: «Mythical Legacy».
      </p>
      <Field label="Nombre de la facción">
        <input
          autoFocus
          value={name}
          onChange={(event) => onName(event.target.value)}
          className={inputClass}
          aria-invalid={Boolean(duplicate)}
        />
      </Field>
      <EstadoDelNombre trimmed={trimmed} nameProblem={nameProblem} />
      <fieldset className="space-y-1 rounded-xl border border-dex-line p-3">
        <legend className="px-1 text-xs uppercase tracking-[0.14em] text-dex-muted">
          ¿Pertenece a otra facción?
        </legend>
        <label className="flex items-center gap-2 text-sm text-dex-ink">
          <input
            type="radio"
            name="madre-eleccion"
            aria-label="No pertenece a ninguna: facción raíz"
            checked={!conMadre}
            onChange={() => {
              onConMadre(false);
              onParentId(null);
            }}
            disabled={busy}
          />{" "}
          No, es una facción raíz
        </label>
        <label className="flex items-center gap-2 text-sm text-dex-ink">
          <input
            type="radio"
            name="madre-eleccion"
            aria-label="Sí: pertenece a una facción madre"
            checked={conMadre}
            onChange={() => onConMadre(true)}
            disabled={busy || madres.length === 0}
          />{" "}
          Sí, es subfacción de otra facción
        </label>
        {madres.length === 0 && (
          <p className="text-[11px] text-dex-muted">
            No hay facciones raíz a las que colgarla: crea primero la madre.
          </p>
        )}
        {conMadre && (
          <Field
            label="Facción madre"
            hint="Se elige en la ficha como cualquier otra y ocupa uno de sus 2 cupos, pero acredita los estados exclusivos de su madre. El nombre se escribe «Madre (Propia)»."
          >
            <select
              aria-label="Facción madre"
              value={parentId === null ? "" : String(parentId)}
              onChange={(event) => {
                const siguiente = event.target.value
                  ? Number(event.target.value)
                  : null;
                onParentId(siguiente);
                const etiqueta = factions.find(
                  (faction) => faction.id === siguiente,
                )?.label;
                if (etiqueta) {
                  onName((actual) => nombreDeSubfaccion(etiqueta, actual));
                }
              }}
              className={inputClass}
            >
              <option value="">Elige la facción madre…</option>
              {madres.map((faction) => (
                <option key={faction.id} value={faction.id}>
                  {faction.label}
                </option>
              ))}
            </select>
          </Field>
        )}
      </fieldset>
      {madre && !trimmed.includes("(") && (
        <button
          type="button"
          className={ghostButton}
          onClick={() => onName(nombreDeSubfaccion(madre.label, trimmed))}
        >
          Escribirlo como «{nombreDeSubfaccion(madre.label, trimmed)}»
        </button>
      )}
    </div>
  );
}

function PasoEmblema({
  file,
  skipped,
  preview,
  onFile,
  onSkip,
}: Readonly<{
  file: File | null;
  skipped: boolean;
  preview: string | null;
  onFile: (file: File) => void;
  onSkip: () => void;
}>) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-dex-muted">
        El emblema aparece en la cabecera de la carta, pequeño y como holograma.
        Consejos para que se vea bien:
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
            onFile={onFile}
            buttonLabel={file ? "Elegir otro archivo" : "Elegir archivo"}
          />
        </div>
      </div>
      {file && <p className="text-xs text-emerald-300">✓ {file.name}</p>}
      {!file && !skipped && (
        <button type="button" className={ghostButton} onClick={onSkip}>
          Omitir por ahora
        </button>
      )}
      {skipped && !file && (
        <output className="block rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Sin emblema la carta no mostrará el holograma de esta facción. Podrás
          subirlo después desde su tarjeta.
        </output>
      )}
    </div>
  );
}

function PasoConfirmar({
  trimmed,
  file,
  preview,
  madre,
  error,
}: Readonly<{
  trimmed: string;
  file: File | null;
  preview: string | null;
  madre: FactionRow | null;
  error: string | null;
}>) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-dex-muted">
        Revisa y confirma. Se creará la facción y, si elegiste uno, se subirá su
        emblema.
      </p>
      <div className="flex items-center gap-4 rounded-xl border border-dex-line p-3">
        <EmblemSocket previewUrl={preview} />
        <div>
          <p className="font-bold text-dex-ink">{trimmed}</p>
          <p className="text-xs text-dex-muted">
            {file ? `Emblema: ${file.name}` : "Sin emblema por ahora"}
          </p>
          <p className="text-xs text-dex-muted">
            {madre
              ? `Subfacción de «${madre.label}»`
              : "Facción raíz (sin madre)"}
          </p>
        </div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Lo que impide avanzar en el paso actual, dicho en voz alta (el botón deshabilitado nunca va mudo). */
function motivoParaNoAvanzar(
  step: number,
  trimmed: string,
  sinMadre: boolean,
  sinEmblema: boolean,
): string | null {
  if (step === 0 && !trimmed) {
    return "Escribe un nombre para continuar.";
  }
  if (step === 0 && sinMadre) {
    return "Elige la facción madre, o marca que no pertenece a ninguna.";
  }
  if (step === 1 && sinEmblema) {
    return "Elige un archivo u omite este paso.";
  }
  return null;
}

/** «Siguiente» deshabilitado: en el paso 1 por el nombre o la madre; en el 2, sin emblema ni omitirlo. */
function pasoIncompleto(
  step: number,
  nameProblem: string | null,
  sinMadre: boolean,
  sinEmblema: boolean,
): boolean {
  if (step === 0) {
    return Boolean(nameProblem) || sinMadre;
  }
  return sinEmblema;
}

export function FactionWizard({
  token,
  factions,
  onItems,
  onAssign,
  onDone,
  onClose,
}: Readonly<{
  token: string;
  factions: FactionRow[];
  onItems: (items: FactionRow[]) => void;
  /** «Asignarla a una ficha»: lleva a la sección de fichas. Ausente al abrirlo desde una ficha. */
  onAssign?: () => void;
  /** Al abrirlo desde el asistente de una carta: vuelve con la facción creada. */
  onDone?: (faction: FactionRow) => void;
  onClose: () => void;
}>) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<number | null>(null);
  /** Elección explícita: ¿la facción nueva cuelga de otra (subfacción) o es raíz? */
  const [conMadre, setConMadre] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Creada | null>(null);
  const preview = useObjectUrl(file);

  const trimmed = name.trim();
  const duplicate = useMemo(
    () => buscarFaccionDuplicada(trimmed, factions),
    [trimmed, factions],
  );
  /** Madre elegida: solo las raíces, así la relación nunca puede cerrar un ciclo. */
  const madres = useMemo(
    () => factions.filter((faction) => !faction.parentId),
    [factions],
  );
  const madre = useMemo(
    () => factions.find((faction) => faction.id === parentId) ?? null,
    [parentId, factions],
  );
  const nameProblem = problemaDelNombre(trimmed, duplicate);
  const sinMadre = faltaMadre(conMadre, parentId);
  const sinEmblema = !file && !skipped;

  const reset = useCallback(() => {
    setStep(0);
    setName("");
    setParentId(null);
    setConMadre(false);
    setFile(null);
    setSkipped(false);
    setError(null);
    setCreated(null);
  }, []);

  /** Sube el emblema de una facción recién creada; devuelve el motivo si falla (la facción ya existe). */
  const subirEmblema = async (
    faction: FactionRow,
    archivo: File,
  ): Promise<{ faction: FactionRow; emblemFailed: string | null }> => {
    try {
      const uploaded = await api.uploadFactionEmblem(
        token,
        faction.id,
        await aPngCuadrado(archivo),
      );
      onItems(uploaded.items);
      return { faction: uploaded.faction ?? faction, emblemFailed: null };
    } catch (cause) {
      return {
        faction,
        emblemFailed:
          cause instanceof Error ? cause.message : "error al subir el emblema",
      };
    }
  };

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      // `parent` solo viaja cuando hay madre elegida: una facción raíz no necesita
      // declarar `null` y así el alta se queda igual que antes para lo de siempre.
      const { faction, items } = await api.createFaction(token, {
        label: trimmed,
        ...(parentId === null ? {} : { parent: parentId }),
      });
      onItems(items);
      setCreated(
        file
          ? await subirEmblema(faction, file)
          : { faction, emblemFailed: null },
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "No se pudo crear la facción.",
      );
    } finally {
      setBusy(false);
    }
  };

  const elegirArchivo = useCallback((next: File) => {
    setFile(next);
    setSkipped(false);
  }, []);
  const omitirEmblema = useCallback(() => setSkipped(true), []);
  const atras = useCallback(() => setStep((actual) => actual - 1), []);

  if (created) {
    return (
      <FaccionCreada
        created={created}
        preview={preview}
        onDone={onDone}
        onReset={reset}
        onAssign={onAssign}
        onClose={onClose}
      />
    );
  }

  /** «Siguiente» / «Crear facción»: cada paso avanza solo si lo suyo está completo. */
  const onSubmit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step === 0) {
      if (!nameProblem && !sinMadre) {
        setStep(1);
      }
      return;
    }
    if (step === 1) {
      if (!sinEmblema) {
        setStep(2);
      }
      return;
    }
    if (!busy) {
      void create();
    }
  };

  return (
    <form
      className="space-y-4"
      data-testid="faction-wizard"
      onSubmit={onSubmit}
    >
      <header>
        <h2 className="text-lg font-extrabold text-dex-ink">Nueva facción</h2>
        <ol className="mt-2 flex gap-2" aria-label="Pasos">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? "step" : undefined}
              className={`rounded-full border px-3 py-0.5 text-xs ${claseDePaso(index, step)}`}
            >
              {index < step ? "✓ " : `${index + 1}. `}
              {label}
            </li>
          ))}
        </ol>
      </header>

      {step === 0 && (
        <PasoNombre
          name={name}
          onName={setName}
          trimmed={trimmed}
          duplicate={duplicate}
          nameProblem={nameProblem}
          conMadre={conMadre}
          onConMadre={setConMadre}
          parentId={parentId}
          onParentId={setParentId}
          madres={madres}
          madre={madre}
          factions={factions}
          busy={busy}
        />
      )}

      {step === 1 && (
        <PasoEmblema
          file={file}
          skipped={skipped}
          preview={preview}
          onFile={elegirArchivo}
          onSkip={omitirEmblema}
        />
      )}

      {step === 2 && (
        <PasoConfirmar
          trimmed={trimmed}
          file={file}
          preview={preview}
          madre={madre}
          error={error}
        />
      )}

      <PieDelAsistenteDeFaccion
        step={step}
        busy={busy}
        motivo={motivoParaNoAvanzar(step, trimmed, sinMadre, sinEmblema)}
        siguienteDeshabilitado={pasoIncompleto(
          step,
          nameProblem,
          sinMadre,
          sinEmblema,
        )}
        onClose={onClose}
        onAtras={atras}
      />
    </form>
  );
}
