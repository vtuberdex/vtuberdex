// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Mantenedor de emblemas y facciones: una rejilla de tarjetas, cada una con el emblema
 * sobre el mismo engarce oscuro de la carta.
 *
 * Renombrar y cambiar el emblema son inmediatos; eliminar y FUSIONAR destruyen o mueven
 * datos de muchas fichas, así que piden confirmación en la propia tarjeta diciendo
 * cuántas fichas afectan (`total` incluye borradores y ocultos, los que más fácil se
 * olvidan). Fusionar es la forma correcta de limpiar un duplicado: las fichas pasan a la
 * facción buena en vez de perderla.
 *
 * El emblema se convierte a PNG ≤512 px aquí, en el navegador (ver `lib/imagen-cliente`):
 * en producción no hay `sharp` y el servidor solo valida y limita el peso.
 */
import { useCallback, useState, type FormEvent } from "react";

import { api } from "@/lib/api";
import { aPngCuadrado } from "@/lib/imagen-cliente";
import type { FactionRow } from "@/lib/types";
import { EmblemDropzone } from "@/components/admin/emblem-dropzone";
import { FactionWizard } from "@/components/admin/faction-wizard";
import {
  Dialog,
  EmblemSocket,
  ghostButton,
  inputClass,
  primaryButton,
} from "@/components/admin/ui";

type Pending = { kind: "merge"; target: string } | { kind: "delete" };
type Notify = (kind: "ok" | "error", text: string) => void;

/**
 * ¿Es una SUBFACCIÓN HUÉRFANA? El nombre se escribió como «Madre (Propia)» —la convención del
 * catálogo— pero no tiene madre guardada en `parentId`.
 *
 * POR QUÉ IMPORTA: la herencia de estados no se adivina del nombre, se lee de `faction.parent_id`
 * (ver `tieneFaccion`). Una hija huérfana se ve como subfacción en la carta y, en cambio, sus estados
 * exclusivos siguen bloqueados: es el fallo que se reportó desde el mantenedor.
 */
export function esSubfaccionHuerfana(faction: FactionRow): boolean {
  if (faction.parentId) {
    return false;
  }
  return terminaEnParentesis(faction.label.trim());
}

/**
 * ¿Termina en «(…)» sin otro «)» dentro? Es lo que decía `/\([^)]*\)\s*$/` sobre el nombre ya recortado,
 * pero sin su backtracking: la regex reintentaba desde cada «(» (coste cuadrático con muchos).
 */
export function terminaEnParentesis(texto: string): boolean {
  if (!texto.endsWith(")")) {
    return false;
  }
  const dentro = texto.slice(0, -1);
  return dentro.lastIndexOf("(") > dentro.lastIndexOf(")");
}

export function FactionManager({
  token,
  factions,
  onItems,
  onStructureChanged,
  onAssign,
  notify,
}: Readonly<{
  token: string;
  factions: FactionRow[];
  /** Recibe el catálogo ACTUALIZADO que devuelve cada operación. */
  onItems: (items: FactionRow[]) => void;
  /** Fusionar o eliminar cambia las facciones de muchas fichas: el padre recarga la que esté abierta. */
  onStructureChanged?: () => void;
  onAssign?: () => void;
  notify?: Notify;
}>) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [wizard, setWizard] = useState(false);
  /*
   * `say` y `run` bajan a CADA tarjeta de la rejilla: en `useCallback` para que sean la misma función
   * entre renders y no una nueva por tarjeta y por tecla.
   */
  const say = useCallback<Notify>(
    (kind, text) => notify?.(kind, text),
    [notify],
  );

  const run = useCallback<Run>(
    async (id, action, okText, structural = false) => {
      setBusyId(id);
      setError(null);
      try {
        onItems((await action()).items);
        say("ok", okText);
        if (structural) {
          onStructureChanged?.();
        }
        return true;
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "error";
        setError(message);
        say("error", message);
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [onItems, say, onStructureChanged],
  );

  const abrirAsistente = useCallback(() => setWizard(true), []);
  const cerrarAsistente = useCallback(() => setWizard(false), []);
  const asignar = useCallback(() => {
    setWizard(false);
    onAssign?.();
  }, [onAssign]);

  const withoutEmblem = factions.filter((faction) => !faction.icon);
  /** Subfacciones a las que les falta la madre: sus estados exclusivos siguen bloqueados. */
  const huerfanas = factions.filter(esSubfaccionHuerfana);

  return (
    <div className="space-y-4" data-testid="faction-manager">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-dex-muted">
          {factions.length} facciones. Cada ficha puede tener hasta 2. Para
          quitar un duplicado usa «Fusionar con otra»: las fichas pasan a la
          facción que elijas. «Eliminar» deja a esas fichas sin esa facción.
        </p>
        <button
          type="button"
          onClick={abrirAsistente}
          className={`${primaryButton} px-6 py-3 text-base`}
        >
          Nueva facción
        </button>
      </div>

      {withoutEmblem.length > 0 && (
        <ul className="space-y-1" data-testid="faction-warnings">
          {withoutEmblem.map((faction) => (
            <li key={faction.id} className="text-xs text-amber-200">
              ⚠ {faction.label} no tiene emblema aún.
            </li>
          ))}
        </ul>
      )}

      {huerfanas.length > 0 && (
        <ul className="space-y-1" data-testid="faction-huerfanas">
          {huerfanas.map((faction) => (
            <li key={faction.id} className="text-xs text-red-300">
              ⚠ {faction.label} parece una subfacción pero no tiene facción
              madre: elige su madre en su tarjeta o sus estados exclusivos
              seguirán bloqueados.
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p
          role="alert"
          data-testid="faction-error"
          className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          {error}
        </p>
      )}

      {factions.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-dex-line px-6 py-12 text-center"
          data-testid="faction-empty"
        >
          <p className="text-sm text-dex-muted">
            Aún no hay facciones. Crea la primera para poder asignarla a las
            fichas.
          </p>
          <button
            type="button"
            onClick={abrirAsistente}
            className={`${primaryButton} mt-4`}
          >
            Crear la primera facción
          </button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {factions.map((faction) => (
            <FactionCard
              key={faction.id}
              faction={faction}
              all={factions}
              busy={busyId === faction.id}
              token={token}
              run={run}
              notify={say}
            />
          ))}
        </ul>
      )}

      {wizard && (
        <Dialog title="Nueva facción" onClose={cerrarAsistente}>
          <FactionWizard
            token={token}
            factions={factions}
            onItems={onItems}
            onClose={cerrarAsistente}
            onAssign={onAssign ? asignar : undefined}
          />
        </Dialog>
      )}
    </div>
  );
}

type Run = (
  id: number,
  action: () => Promise<{ items: FactionRow[] }>,
  okText: string,
  structural?: boolean,
) => Promise<boolean>;

/** Emblema, nombre (o el formulario para renombrar) y cuántas fichas la usan. */
function CabeceraDeFaccion({
  faction,
  all,
  busy,
  token,
  run,
  renaming,
  setRenaming,
}: Readonly<{
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: Run;
  renaming: string | null;
  setRenaming: (valor: string | null) => void;
}>) {
  return (
    <div className="flex items-center gap-4">
      <EmblemSocket icon={faction.icon} size={88} />
      <div className="min-w-0 flex-1">
        {renaming === null ? (
          <h3 className="truncate text-base font-extrabold text-dex-ink">
            {faction.label}
          </h3>
        ) : (
          <FormularioDeNombre
            faction={faction}
            all={all}
            busy={busy}
            token={token}
            run={run}
            renaming={renaming}
            setRenaming={setRenaming}
          />
        )}
        <p className="mt-1 font-mono text-[11px] text-dex-muted">
          {faction.total} {faction.total === 1 ? "ficha" : "fichas"} (
          {faction.publicadas} publicadas)
        </p>
      </div>
    </div>
  );
}

function FormularioDeNombre({
  faction,
  all,
  busy,
  token,
  run,
  renaming,
  setRenaming,
}: Readonly<{
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: Run;
  renaming: string;
  setRenaming: (valor: string | null) => void;
}>) {
  const nuevo = renaming.trim();
  const clash = all.find(
    (other) =>
      other.id !== faction.id &&
      other.label.toLowerCase() === nuevo.toLowerCase(),
  );
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!nuevo || clash) {
      return;
    }
    void run(
      faction.id,
      () => api.updateFaction(token, faction.id, { label: nuevo }),
      `Facción renombrada a «${nuevo}».`,
    ).then((ok) => ok && setRenaming(null));
  };
  return (
    <form className="space-y-1" onSubmit={onSubmit}>
      <input
        aria-label={`Nuevo nombre de ${faction.label}`}
        autoFocus
        value={renaming}
        onChange={(event) => setRenaming(event.target.value)}
        className={`${inputClass} !mt-0`}
      />
      {clash && (
        <p className="text-[11px] text-red-300">Ya existe «{clash.label}».</p>
      )}
      <span className="flex gap-1">
        <button
          type="submit"
          className={ghostButton}
          disabled={busy || !nuevo || Boolean(clash)}
        >
          Guardar nombre
        </button>
        <button
          type="button"
          className={ghostButton}
          onClick={() => setRenaming(null)}
        >
          Cancelar
        </button>
      </span>
    </form>
  );
}

function SelectorDeMadre({
  faction,
  all,
  busy,
  token,
  run,
}: Readonly<{
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: Run;
}>) {
  /**
   * Madres ofrecidas: solo facciones raíz, más la que ya tiene (aunque ella misma sea
   * subfacción) para que el desplegable no pierda el valor guardado. El servidor rechaza
   * cualquier relación circular, así que esto es comodidad, no la única defensa.
   */
  const raices = all.filter(
    (other) =>
      other.id !== faction.id &&
      (!other.parentId || other.id === faction.parentId),
  );
  const cambiar = (valor: string) => {
    const etiqueta = all.find((other) => String(other.id) === valor)?.label;
    void run(
      faction.id,
      () =>
        api.updateFaction(token, faction.id, {
          parent: valor ? Number(valor) : null,
        }),
      valor
        ? `«${faction.label}» ahora es subfacción de «${etiqueta ?? valor}».`
        : `«${faction.label}» quedó como facción raíz.`,
    );
  };
  return (
    <>
      <label className="block text-xs text-dex-muted">
        Facción madre{" "}
        <select
          aria-label={`Facción madre de ${faction.label}`}
          value={faction.parentId ? String(faction.parentId) : ""}
          disabled={busy}
          onChange={(event) => cambiar(event.target.value)}
          className={inputClass}
        >
          <option value="">Ninguna (facción raíz)</option>
          {raices.map((other) => (
            <option key={other.id} value={other.id}>
              {other.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-[11px] text-dex-muted">
        {faction.parentLabel
          ? `Subfacción de «${faction.parentLabel}»: acredita sus estados exclusivos.`
          : "Se elige en la ficha como cualquier otra y ocupa uno de sus 2 cupos."}
      </p>
    </>
  );
}

function EmblemaDeFaccion({
  faction,
  busy,
  token,
  run,
  notify,
}: Readonly<{
  faction: FactionRow;
  busy: boolean;
  token: string;
  run: Run;
  notify: Notify;
}>) {
  const [uploading, setUploading] = useState(false);
  const conEmblema = Boolean(faction.icon);

  const upload = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const blob = await aPngCuadrado(file);
        await run(
          faction.id,
          () => api.uploadFactionEmblem(token, faction.id, blob),
          `Emblema de «${faction.label}» actualizado.`,
        );
      } catch (cause) {
        notify(
          "error",
          cause instanceof Error
            ? cause.message
            : "No se pudo preparar la imagen.",
        );
      } finally {
        setUploading(false);
      }
    },
    [faction.id, faction.label, token, run, notify],
  );

  return (
    <>
      {!conEmblema && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {faction.label} no tiene emblema aún. Súbelo para que la carta lo
          muestre.
        </p>
      )}

      <EmblemDropzone
        onFile={upload}
        busy={uploading || busy}
        label={
          conEmblema
            ? "Arrastra un archivo para cambiar el emblema"
            : "Arrastra aquí el emblema"
        }
        buttonLabel={conEmblema ? "Cambiar emblema" : "Subir emblema"}
        inputLabel={`Archivo del emblema de ${faction.label}`}
      />
    </>
  );
}

/** Lo que pasará al confirmar: cuántas fichas cambian de facción o la pierden. */
function ConsecuenciaDelCambio({
  faction,
  pending,
  target,
}: Readonly<{
  faction: FactionRow;
  pending: Pending;
  target: FactionRow | undefined;
}>) {
  if (pending.kind === "delete") {
    return (
      <p>
        {faction.total}{" "}
        {faction.total === 1 ? "ficha perderá" : "fichas perderán"} la facción «
        {faction.label}». Esto no se puede deshacer.
      </p>
    );
  }
  if (!target) {
    return null;
  }
  return (
    <p>
      {faction.total} {faction.total === 1 ? "ficha pasará" : "fichas pasarán"}{" "}
      de «{faction.label}» a «{target.label}», y «{faction.label}» se eliminará.
    </p>
  );
}

/** Fusionar o eliminar mueven datos de muchas fichas: se confirman en la propia tarjeta. */
function ConfirmarCambio({
  faction,
  all,
  busy,
  token,
  run,
  pending,
  setPending,
}: Readonly<{
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: Run;
  pending: Pending;
  setPending: (pending: Pending | null) => void;
}>) {
  const fusion = pending.kind === "merge";
  const target = fusion
    ? all.find((other) => String(other.id) === pending.target)
    : undefined;
  const confirmar = async () => {
    const ok = await run(
      faction.id,
      () => api.deleteFaction(token, faction.id, target?.id),
      fusion
        ? `«${faction.label}» se fusionó con «${target?.label}».`
        : `«${faction.label}» se eliminó.`,
      true,
    );
    if (ok) {
      setPending(null);
    }
  };
  return (
    <div
      role="alertdialog"
      aria-label={`Confirmar cambio en ${faction.label}`}
      className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100"
    >
      {fusion && (
        <label className="block text-xs">
          Fusionar «{faction.label}» con{" "}
          <select
            aria-label="Facción de destino"
            value={pending.target}
            onChange={(event) =>
              setPending({ kind: "merge", target: event.target.value })
            }
            className={inputClass}
          >
            <option value="">Elige el destino…</option>
            {all
              .filter((other) => other.id !== faction.id)
              .map((other) => (
                <option key={other.id} value={other.id}>
                  {other.label}
                </option>
              ))}
          </select>
        </label>
      )}
      <ConsecuenciaDelCambio
        faction={faction}
        pending={pending}
        target={target}
      />
      <span className="flex gap-2">
        <button
          type="button"
          className={primaryButton}
          disabled={busy || (fusion && !target)}
          onClick={confirmar}
        >
          {fusion ? "Confirmar fusión" : "Confirmar eliminación"}
        </button>
        <button
          type="button"
          className={ghostButton}
          onClick={() => setPending(null)}
        >
          Cancelar
        </button>
        {fusion && !target && (
          <span className="self-center text-[11px]">
            Elige el destino para continuar.
          </span>
        )}
      </span>
    </div>
  );
}

function FactionCard({
  faction,
  all,
  busy,
  token,
  run,
  notify,
}: Readonly<{
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: Run;
  notify: Notify;
}>) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const sinOtra = all.length < 2;

  return (
    <li
      className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-4"
      data-testid="faction-row"
    >
      <CabeceraDeFaccion
        faction={faction}
        all={all}
        busy={busy}
        token={token}
        run={run}
        renaming={renaming}
        setRenaming={setRenaming}
      />

      <SelectorDeMadre
        faction={faction}
        all={all}
        busy={busy}
        token={token}
        run={run}
      />

      <EmblemaDeFaccion
        faction={faction}
        busy={busy}
        token={token}
        run={run}
        notify={notify}
      />

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={ghostButton}
          disabled={busy}
          onClick={() => setRenaming(faction.label)}
        >
          Renombrar
        </button>
        <button
          type="button"
          className={ghostButton}
          disabled={busy || sinOtra}
          title={sinOtra ? "Necesitas otra facción para fusionar" : undefined}
          onClick={() => setPending({ kind: "merge", target: "" })}
        >
          Fusionar con otra
        </button>
        <button
          type="button"
          className={`${ghostButton} hover:!text-red-300`}
          disabled={busy}
          onClick={() => setPending({ kind: "delete" })}
        >
          Eliminar
        </button>
      </div>

      {pending && (
        <ConfirmarCambio
          faction={faction}
          all={all}
          busy={busy}
          token={token}
          run={run}
          pending={pending}
          setPending={setPending}
        />
      )}
    </li>
  );
}
