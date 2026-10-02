'use client';
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
import { useState } from 'react';

import { api } from '@/lib/api';
import { aPngCuadrado } from '@/lib/imagen-cliente';
import type { FactionRow } from '@/lib/types';
import { EmblemDropzone } from '@/components/admin/emblem-dropzone';
import { FactionWizard } from '@/components/admin/faction-wizard';
import { Dialog, EmblemSocket, ghostButton, inputClass, primaryButton } from '@/components/admin/ui';

type Pending = { kind: 'merge'; target: string } | { kind: 'delete' };
type Notify = (kind: 'ok' | 'error', text: string) => void;

export function FactionManager({
  token,
  factions,
  onItems,
  onStructureChanged,
  onAssign,
  notify,
}: {
  token: string;
  factions: FactionRow[];
  /** Recibe el catálogo ACTUALIZADO que devuelve cada operación. */
  onItems: (items: FactionRow[]) => void;
  /** Fusionar o eliminar cambia las facciones de muchas fichas: el padre recarga la que esté abierta. */
  onStructureChanged?: () => void;
  onAssign?: () => void;
  notify?: Notify;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [wizard, setWizard] = useState(false);
  const say: Notify = (kind, text) => notify?.(kind, text);

  const run = async (id: number, action: () => Promise<{ items: FactionRow[] }>, okText: string, structural = false) => {
    setBusyId(id);
    setError(null);
    try {
      onItems((await action()).items);
      say('ok', okText);
      if (structural) onStructureChanged?.();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'error';
      setError(message);
      say('error', message);
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const withoutEmblem = factions.filter((faction) => !faction.icon);

  return (
    <div className="space-y-4" data-testid="faction-manager">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-dex-muted">
          {factions.length} facciones. Cada ficha puede tener hasta 2. Para quitar un duplicado usa «Fusionar con otra»: las fichas pasan a la facción que elijas. «Eliminar» deja a esas fichas sin esa facción.
        </p>
        <button type="button" onClick={() => setWizard(true)} className={`${primaryButton} px-6 py-3 text-base`}>
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

      {error && (
        <p role="alert" data-testid="faction-error" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      )}

      {factions.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-dex-line px-6 py-12 text-center" data-testid="faction-empty">
          <p className="text-sm text-dex-muted">Aún no hay facciones. Crea la primera para poder asignarla a las fichas.</p>
          <button type="button" onClick={() => setWizard(true)} className={`${primaryButton} mt-4`}>
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
        <Dialog title="Nueva facción" onClose={() => setWizard(false)}>
          <FactionWizard
            token={token}
            factions={factions}
            onItems={onItems}
            onClose={() => setWizard(false)}
            onAssign={
              onAssign
                ? () => {
                    setWizard(false);
                    onAssign();
                  }
                : undefined
            }
          />
        </Dialog>
      )}
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
}: {
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: (id: number, action: () => Promise<{ items: FactionRow[] }>, okText: string, structural?: boolean) => Promise<boolean>;
  notify: Notify;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [uploading, setUploading] = useState(false);
  const target = pending?.kind === 'merge' ? all.find((other) => String(other.id) === pending.target) : undefined;
  const clash = renaming !== null ? all.find((other) => other.id !== faction.id && other.label.toLowerCase() === renaming.trim().toLowerCase()) : undefined;

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const blob = await aPngCuadrado(file);
      await run(faction.id, () => api.uploadFactionEmblem(token, faction.id, blob), `Emblema de «${faction.label}» actualizado.`);
    } catch (cause) {
      notify('error', cause instanceof Error ? cause.message : 'No se pudo preparar la imagen.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <li className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-4" data-testid="faction-row">
      <div className="flex items-center gap-4">
        <EmblemSocket icon={faction.icon} size={88} />
        <div className="min-w-0 flex-1">
          {renaming === null ? (
            <h3 className="truncate text-base font-extrabold text-dex-ink">{faction.label}</h3>
          ) : (
            <form
              className="space-y-1"
              onSubmit={(event) => {
                event.preventDefault();
                if (!renaming.trim() || clash) return;
                void run(faction.id, () => api.updateFaction(token, faction.id, { label: renaming.trim() }), `Facción renombrada a «${renaming.trim()}».`).then((ok) => ok && setRenaming(null));
              }}
            >
              <input
                aria-label={`Nuevo nombre de ${faction.label}`}
                autoFocus
                value={renaming}
                onChange={(event) => setRenaming(event.target.value)}
                className={`${inputClass} !mt-0`}
              />
              {clash && <p className="text-[11px] text-red-300">Ya existe «{clash.label}».</p>}
              <span className="flex gap-1">
                <button type="submit" className={ghostButton} disabled={busy || !renaming.trim() || Boolean(clash)}>
                  Guardar nombre
                </button>
                <button type="button" className={ghostButton} onClick={() => setRenaming(null)}>
                  Cancelar
                </button>
              </span>
            </form>
          )}
          <p className="mt-1 font-mono text-[11px] text-dex-muted">
            {faction.total} {faction.total === 1 ? 'ficha' : 'fichas'} ({faction.publicadas} publicadas)
          </p>
        </div>
      </div>

      {!faction.icon && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {faction.label} no tiene emblema aún. Súbelo para que la carta lo muestre.
        </p>
      )}

      <EmblemDropzone
        onFile={(file) => void upload(file)}
        busy={uploading || busy}
        label={faction.icon ? 'Arrastra un archivo para cambiar el emblema' : 'Arrastra aquí el emblema'}
        buttonLabel={faction.icon ? 'Cambiar emblema' : 'Subir emblema'}
        inputLabel={`Archivo del emblema de ${faction.label}`}
      />

      <div className="flex flex-wrap gap-1">
        <button type="button" className={ghostButton} disabled={busy} onClick={() => setRenaming(faction.label)}>
          Renombrar
        </button>
        <button type="button" className={ghostButton} disabled={busy || all.length < 2} title={all.length < 2 ? 'Necesitas otra facción para fusionar' : undefined} onClick={() => setPending({ kind: 'merge', target: '' })}>
          Fusionar con otra
        </button>
        <button type="button" className={`${ghostButton} hover:!text-red-300`} disabled={busy} onClick={() => setPending({ kind: 'delete' })}>
          Eliminar
        </button>
      </div>

      {pending && (
        <div role="alertdialog" aria-label={`Confirmar cambio en ${faction.label}`} className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          {pending.kind === 'merge' ? (
            <>
              <label className="block text-xs">
                Fusionar «{faction.label}» con
                <select
                  aria-label="Facción de destino"
                  value={pending.target}
                  onChange={(event) => setPending({ kind: 'merge', target: event.target.value })}
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
              {target && (
                <p>
                  {faction.total} {faction.total === 1 ? 'ficha pasará' : 'fichas pasarán'} de «{faction.label}» a «{target.label}», y «{faction.label}» se eliminará.
                </p>
              )}
            </>
          ) : (
            <p>
              {faction.total} {faction.total === 1 ? 'ficha perderá' : 'fichas perderán'} la facción «{faction.label}». Esto no se puede deshacer.
            </p>
          )}
          <span className="flex gap-2">
            <button
              type="button"
              className={primaryButton}
              disabled={busy || (pending.kind === 'merge' && !target)}
              onClick={async () => {
                const ok = await run(
                  faction.id,
                  () => api.deleteFaction(token, faction.id, target?.id),
                  pending.kind === 'merge' ? `«${faction.label}» se fusionó con «${target?.label}».` : `«${faction.label}» se eliminó.`,
                  true,
                );
                if (ok) setPending(null);
              }}
            >
              {pending.kind === 'merge' ? 'Confirmar fusión' : 'Confirmar eliminación'}
            </button>
            <button type="button" className={ghostButton} onClick={() => setPending(null)}>
              Cancelar
            </button>
            {pending.kind === 'merge' && !target && <span className="self-center text-[11px]">Elige el destino para continuar.</span>}
          </span>
        </div>
      )}
    </li>
  );
}
