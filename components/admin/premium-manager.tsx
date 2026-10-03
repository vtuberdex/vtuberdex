'use client';
/**
 * Mantenedor de las cartas PREMIUM: quién la tiene, en qué grado y cuándo subió por última vez.
 *
 * El flujo es el del negocio. Un VTuber que dona recibe su carta gradeada partiendo del 8; cada
 * mes que sigue donando se le sube medio punto (8 → 8,5 → 9 → 9,5 → 10) y, después del 10, pasa a
 * la Black Label. El mantenedor NO calcula los meses solo: la donación es un dato que sabe una
 * persona, así que el botón «Subir a …» es el gesto mensual y la fecha del último cambio
 * (`gradedAt`) avisa si ya se subió este mes. Un grado también se puede fijar a mano (el selector):
 * sirve para corregir un error o para registrar a quien ya donaba antes de que esto existiera.
 *
 * La escala y sus reglas viven en `server/src/premium.mjs`; esto solo las presenta.
 */
import { useCallback, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { idDeCodigo } from '@/lib/donar';
import { GRADOS, GRADO_INICIAL, gradoSiguiente, leyendaDePremium, mesesEntre, mismoMes } from '@/lib/premium';
import type { PremiumGrade, VtuberCard } from '@/lib/types';
import { PremiumBadge } from '@/components/premium-badge';
import { Reason, ghostButton, inputClass, labelClass, primaryButton } from '@/components/admin/ui';

type Notify = (kind: 'ok' | 'error', text: string) => void;

const PER_PAGE = 100;

export function PremiumManager({
  token,
  notify,
  onChanged,
}: {
  token: string;
  notify?: Notify;
  /** Cambiar el premium cambia lo que se ve de la ficha: el padre refresca lista y métricas. */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<VtuberCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<VtuberCard[]>([]);
  const [grade, setGrade] = useState<PremiumGrade>(GRADO_INICIAL);
  const say: Notify = (kind, text) => notify?.(kind, text);

  useEffect(() => {
    const controller = new AbortController();
    api
      .adminList(token, { premium: true, perPage: PER_PAGE }, controller.signal)
      .then((response) => {
        setRows(response.items);
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, version]);

  // Candidatas al alta: las que coinciden con la búsqueda y todavía no son premium.
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    /**
     * Un código `VTD-000017` es lo que el donante escribe en la nota de PayPal (ver `lib/donar.ts`):
     * se busca la ficha por su id, no por texto, porque el número de certificado no está en el nombre.
     */
    const idPorCodigo = idDeCodigo(term);
    if (idPorCodigo !== null) {
      api
        .adminDetail(token, idPorCodigo)
        .then((detalle) => setCandidates(detalle.premium ? [] : [detalle]))
        .catch(() => setCandidates([]));
      return () => controller.abort();
    }
    api
      .adminList(token, { q: term, perPage: 8 }, controller.signal)
      .then((response) => setCandidates(response.items.filter((item) => !item.premium)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, query, version]);

  const save = useCallback(
    async (row: VtuberCard, premium: { grade: PremiumGrade } | null, okText: string) => {
      setBusyId(row.id);
      try {
        await api.updateVtuber(token, row.id, { premium });
        say('ok', okText);
        setVersion((current) => current + 1);
        onChanged?.();
      } catch (cause) {
        say('error', cause instanceof Error ? cause.message : 'No se pudo guardar el premium.');
      } finally {
        setBusyId(null);
        setConfirmingId(null);
      }
    },
    // `say` cierra sobre `notify`; basta con él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, notify, onChanged],
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]" data-testid="premium-manager">
      <section className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">Nueva carta premium</h2>
        <p className="text-xs text-dex-muted">
          Busca la ficha del VTuber que dona y elige con qué grado entra. Lo normal es el {GRADO_INICIAL}; sube medio punto
          por mes. El donante escribe en la nota de PayPal el código de su carta (<span className="font-mono">VTD-000017</span>):
          pégalo aquí y aparece su ficha.
        </p>
        <label className={labelClass}>
          Buscar ficha
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={inputClass}
            placeholder="nombre, número o código VTD-…"
            aria-label="Buscar ficha para hacerla premium"
          />
        </label>
        <label className={labelClass}>
          Grado inicial
          <select
            aria-label="Grado inicial"
            value={grade}
            onChange={(event) => setGrade(event.target.value as PremiumGrade)}
            className={inputClass}
          >
            {GRADOS.map((item) => (
              <option key={item} value={item}>
                {item === 'BL' ? 'BL · Black Label' : item}
              </option>
            ))}
          </select>
        </label>
        <ul className="dex-scroll max-h-72 space-y-1 overflow-y-auto" data-testid="premium-candidates">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-dex-muted hover:bg-white/5">
              <span className="font-mono text-[11px]">#{String(candidate.dexNumber).padStart(3, '0')}</span>
              <span className="min-w-0 flex-1 truncate text-dex-ink">{candidate.name}</span>
              <button
                type="button"
                className={primaryButton}
                disabled={busyId === candidate.id}
                onClick={() => save(candidate, { grade }, `${candidate.name} ya es premium (${grade}).`)}
              >
                Hacer premium
              </button>
            </li>
          ))}
          {query.trim().length >= 2 && candidates.length === 0 && (
            <li className="px-2 py-2 text-xs text-dex-muted">Ninguna ficha sin premium coincide.</li>
          )}
        </ul>
      </section>

      <section className="min-w-0 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
          Cartas premium <span className="font-mono text-dex-ink">{rows.length}</span>
        </h2>
        {loaded && rows.length === 0 && (
          <p className="rounded-2xl border border-dashed border-dex-line px-6 py-10 text-center text-sm text-dex-muted">
            Aún no hay cartas premium. Busca una ficha a la izquierda para hacer la primera.
          </p>
        )}
        <ul className="space-y-3">
          {rows.map((row) => {
            const premium = row.premium;
            if (!premium) return null;
            const siguiente = gradoSiguiente(premium.grade);
            const subioEsteMes = mismoMes(premium.gradedAt);
            const busy = busyId === row.id;
            return (
              <li key={row.id} data-testid="premium-row" className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-[11px] text-dex-muted">#{String(row.dexNumber).padStart(3, '0')}</span>
                  <span className="min-w-0 flex-1 truncate text-base font-bold text-dex-ink">{row.name}</span>
                  {row.status !== 'published' && (
                    <span className="rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200" title="No se ve en el catálogo público">
                      {row.status === 'draft' ? 'borrador' : 'oculto'}
                    </span>
                  )}
                  <PremiumBadge premium={premium} />
                </div>
                <p className="mt-2 text-xs text-dex-muted">
                  {premium.cert} · premium desde {premium.since} ({mesesEntre(premium.since)} meses) · último cambio de grado{' '}
                  {premium.gradedAt}
                </p>
                <div className="mt-3 flex flex-wrap items-end gap-3">
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={busy || siguiente === null}
                    onClick={() =>
                      siguiente && save(row, { grade: siguiente }, `${row.name} sube a ${leyendaDePremium({ grade: siguiente })}.`)
                    }
                  >
                    {siguiente ? `Subir a ${siguiente === 'BL' ? 'Black Label' : siguiente}` : 'Grado máximo'}
                  </button>
                  <label className={labelClass}>
                    Fijar grado
                    <select
                      aria-label={`Grado de ${row.name}`}
                      value={premium.grade}
                      disabled={busy}
                      onChange={(event) =>
                        save(row, { grade: event.target.value as PremiumGrade }, `${row.name}: grado ${event.target.value}.`)
                      }
                      className={`${inputClass} mt-1 w-28`}
                    >
                      {GRADOS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                  {confirmingId === row.id ? (
                    <span className="flex items-center gap-2 text-xs text-dex-muted">
                      ¿Quitar el premium a {row.name}?
                      <button type="button" className={ghostButton} disabled={busy} onClick={() => save(row, null, `${row.name} vuelve a carta normal.`)}>
                        Sí, quitar
                      </button>
                      <button type="button" className={ghostButton} onClick={() => setConfirmingId(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button type="button" className={ghostButton} onClick={() => setConfirmingId(row.id)}>
                      Quitar premium
                    </button>
                  )}
                </div>
                {siguiente && subioEsteMes && (
                  <div className="mt-2">
                    <Reason>Ya cambió de grado este mes ({premium.gradedAt}): sube otra vez solo si de verdad corresponde.</Reason>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

export default PremiumManager;
