'use client';
/**
 * Alta de una carta nueva: formulario MÍNIMO (solo el nombre es obligatorio).
 *
 * Lo demás se completa en el editor completo, que se abre al crear. La carta nace en
 * BORRADOR a propósito: una ficha a medio llenar nunca debería verse en el catálogo
 * público, y publicarla es una decisión explícita en el editor.
 */
import { useState } from 'react';

import { api } from '@/lib/api';
import type { VtuberCreate, VtuberDetail } from '@/lib/types';
import type { ChipOption } from '@/components/admin/chip-picker';
import { slugifyUrl } from '@/components/admin/form-model';
import { Field, ghostButton, inputClass, primaryButton } from '@/components/admin/ui';

export function NewCardDialog({
  token,
  countryOptions,
  onCreated,
  onCancel,
}: {
  token: string;
  countryOptions: ChipOption[];
  onCreated: (detail: VtuberDetail) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [dex, setDex] = useState('');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dexInvalid = dex.trim() !== '' && !(Number.isInteger(Number(dex)) && Number(dex) >= 1);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || dexInvalid) return;
    const body: VtuberCreate = { name: name.trim() };
    if (slug.trim()) body.slug = slugifyUrl(slug);
    if (dex.trim()) body.dexNumber = Number(dex);
    if (country) body.countries = [country];
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createVtuber(token, body));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'error al crear la carta');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      data-testid="new-card-form"
      aria-label="Nueva carta"
      className="space-y-3 rounded-2xl border border-dex-accent/40 bg-dex-panel/80 p-4"
    >
      <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">Nueva carta</h2>
      <p className="text-xs text-dex-muted">Se crea como borrador, al final de la dex. Después la completas y la publicas desde el editor.</p>
      <Field label="Nombre (obligatorio)">
        <input value={name} onChange={(event) => setName(event.target.value)} className={inputClass} autoFocus />
      </Field>
      <Field label="URL de la página (opcional)" hint={`/v/${slugifyUrl(slug) || slugifyUrl(name) || '…'}`}>
        <input value={slug} onChange={(event) => setSlug(event.target.value)} className={inputClass} placeholder="se genera desde el nombre" />
      </Field>
      <Field label="Número de dex (opcional)" hint={dexInvalid ? 'Debe ser un entero positivo.' : 'Vacío = siguiente libre al final. Si está ocupado, el servidor lo rechaza.'}>
        <input inputMode="numeric" value={dex} onChange={(event) => setDex(event.target.value)} className={inputClass} />
      </Field>
      <Field label="País (opcional)">
        <select value={country} onChange={(event) => setCountry(event.target.value)} className={inputClass}>
          <option value="">Sin país</option>
          {countryOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </Field>
      {error && (
        <p role="alert" data-testid="new-card-error" className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primaryButton} disabled={busy || !name.trim() || dexInvalid}>
          {busy ? 'Creando…' : 'Crear carta'}
        </button>
        <button type="button" className={ghostButton} onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  );
}
