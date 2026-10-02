'use client';
/**
 * Administración del catálogo CERRADO de facciones.
 *
 * Existe para dejar solo las ~22 facciones reales: el scrape dejó duplicados con
 * erratas en el nombre. Renombrar y cambiar el emblema es inmediato; eliminar y
 * FUSIONAR destruyen o mueven datos de muchas fichas, así que piden confirmación
 * en la propia fila mostrando cuántas fichas afectan (`total` incluye borradores y
 * ocultos, que son los que más fácil se olvidan). Fusionar es la forma correcta de
 * limpiar un duplicado: las fichas pasan a la facción buena en vez de perderla.
 */
import { useState } from 'react';

import { api } from '@/lib/api';
import type { FactionRow } from '@/lib/types';
import { Emblem, ghostButton, inputClass, primaryButton } from '@/components/admin/ui';

type Pending = { kind: 'merge'; target: string } | { kind: 'delete' };

export function FactionManager({
  token,
  factions,
  onItems,
}: {
  token: string;
  factions: FactionRow[];
  /** Recibe el catálogo ACTUALIZADO que devuelve cada operación. */
  onItems: (items: FactionRow[]) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newIcon, setNewIcon] = useState('');

  const run = async (action: () => Promise<{ items: FactionRow[] }>) => {
    setBusy(true);
    setError(null);
    try {
      onItems((await action()).items);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="faction-manager">
      <p className="text-xs text-dex-muted">
        {factions.length} facciones. Para quitar un duplicado usa «Fusionar»: las fichas pasan a la facción que elijas. «Eliminar» deja a esas fichas sin facción.
      </p>
      {error && (
        <p role="alert" data-testid="faction-error" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {factions.map((faction) => (
          <FactionItem key={faction.id} faction={faction} all={factions} busy={busy} token={token} run={run} />
        ))}
      </ul>

      <form
        className="grid gap-2 rounded-xl border border-dashed border-dex-line p-3 sm:grid-cols-[1fr_1fr_auto]"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!newLabel.trim()) return;
          const ok = await run(() => api.createFaction(token, { label: newLabel.trim(), icon: newIcon.trim() || null }));
          if (ok) {
            setNewLabel('');
            setNewIcon('');
          }
        }}
      >
        <input
          aria-label="Nombre de la nueva facción"
          placeholder="Nueva facción"
          value={newLabel}
          onChange={(event) => setNewLabel(event.target.value)}
          className={`${inputClass} !mt-0`}
        />
        <input
          aria-label="Emblema de la nueva facción"
          placeholder="images/faction/nombre.png"
          value={newIcon}
          onChange={(event) => setNewIcon(event.target.value)}
          className={`${inputClass} !mt-0 font-mono text-xs`}
        />
        <button type="submit" className={primaryButton} disabled={busy || !newLabel.trim()}>
          Crear facción
        </button>
      </form>
    </div>
  );
}

function FactionItem({
  faction,
  all,
  busy,
  token,
  run,
}: {
  faction: FactionRow;
  all: FactionRow[];
  busy: boolean;
  token: string;
  run: (action: () => Promise<{ items: FactionRow[] }>) => Promise<boolean>;
}) {
  const [label, setLabel] = useState(faction.label);
  const [icon, setIcon] = useState(faction.icon ?? '');
  const [pending, setPending] = useState<Pending | null>(null);
  const dirty = label.trim() !== faction.label || (icon.trim() || null) !== faction.icon;
  const target = pending?.kind === 'merge' ? all.find((other) => String(other.id) === pending.target) : undefined;

  return (
    <li className="rounded-xl border border-dex-line bg-dex-void/40 p-3" data-testid="faction-row">
      <div className="grid items-center gap-2 sm:grid-cols-[auto_1fr_1.2fr_auto]">
        <Emblem icon={icon || faction.icon} className="h-8 w-8" />
        <input
          aria-label={`Nombre de ${faction.label}`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className={`${inputClass} !mt-0`}
        />
        <input
          aria-label={`Emblema de ${faction.label}`}
          value={icon}
          onChange={(event) => setIcon(event.target.value)}
          placeholder="images/faction/x.png"
          className={`${inputClass} !mt-0 font-mono text-xs`}
        />
        <button
          type="button"
          className={ghostButton}
          disabled={busy || !dirty || !label.trim()}
          onClick={() => run(() => api.updateFaction(token, faction.id, { label: label.trim(), icon: icon.trim() || null }))}
        >
          Guardar
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-dex-muted">
          {faction.slug} · {faction.total} fichas ({faction.publicadas} publicadas)
        </p>
        <span className="flex gap-1">
          <button type="button" className={ghostButton} disabled={busy || all.length < 2} onClick={() => setPending({ kind: 'merge', target: '' })}>
            Fusionar
          </button>
          <button type="button" className={`${ghostButton} hover:!text-red-300`} disabled={busy} onClick={() => setPending({ kind: 'delete' })}>
            Eliminar
          </button>
        </span>
      </div>

      {pending && (
        <div role="alertdialog" aria-label={`Confirmar cambio en ${faction.label}`} className="mt-3 space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          {pending.kind === 'merge' ? (
            <>
              <label className="block text-xs">
                Fusionar «{faction.label}» en
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
                const ok = await run(() => api.deleteFaction(token, faction.id, target?.id));
                if (ok) setPending(null);
              }}
            >
              {pending.kind === 'merge' ? 'Confirmar fusión' : 'Confirmar eliminación'}
            </button>
            <button type="button" className={ghostButton} onClick={() => setPending(null)}>
              Cancelar
            </button>
          </span>
        </div>
      )}
    </li>
  );
}
