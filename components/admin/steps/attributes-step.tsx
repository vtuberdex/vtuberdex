'use client';
/**
 * Paso 5: atributos. UNA línea por atributo (nombre · valor / máximo · barra) en vez de una tarjeta
 * alta por cada uno: con los 7 estándar la versión anterior ocupaba varias pantallas y no se veía de
 * un vistazo cómo quedaba la ficha. La barra es la misma proporción que dibuja `StatBars`.
 * El «texto del valor» (p. ej. «S+») es raro: va escondido tras «Texto» de cada fila.
 */
import { useState } from 'react';

import { emptyStat, type StatForm } from '@/components/admin/form-model';
import { STANDARD_STATS } from '@/components/admin/suggestions';
import type { StepProps } from '@/components/admin/steps/types';
import { ghostButton, inputClass } from '@/components/admin/ui';

const celda = `${inputClass} !mt-0 !px-2 !py-1.5`;

function Barra({ stat }: { stat: StatForm }) {
  const valor = Number(stat.value);
  const max = Number(stat.max) || 100;
  const pct = Number.isFinite(valor) && stat.value.trim() ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  return (
    <span className="block h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden>
      <span className="block h-full rounded-full bg-dex-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function AttributesStep({ form, set }: StepProps) {
  const [conTexto, setConTexto] = useState<number | null>(null);
  const stats = form.stats;
  const have = new Set(stats.map((stat) => stat.label.trim().toLowerCase()));
  const cambiar = (next: StatForm[]) => set('stats', next);
  const actualizar = (i: number, parche: Partial<StatForm>) => cambiar(stats.map((s, j) => (j === i ? { ...s, ...parche } : s)));
  const mover = (i: number, a: number) => {
    if (a < 0 || a >= stats.length) return;
    const next = stats.slice();
    const [m] = next.splice(i, 1);
    next.splice(a, 0, m);
    cambiar(next);
  };
  const addStandard = () =>
    cambiar([...stats, ...STANDARD_STATS.filter((label) => !have.has(label.toLowerCase())).map((label) => ({ ...emptyStat(), label }))]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={ghostButton} onClick={addStandard} disabled={STANDARD_STATS.every((label) => have.has(label.toLowerCase()))}>
          Añadir atributos estándar
        </button>
        <button type="button" className={ghostButton} disabled={stats.length >= 30} onClick={() => cambiar([...stats, emptyStat()])}>
          + Agregar atributo
        </button>
      </div>

      {stats.length === 0 ? (
        <p className="rounded-xl border border-dashed border-dex-line px-4 py-6 text-center text-sm text-dex-muted">
          Sin atributos todavía. «Añadir atributos estándar» pone HP, MP, Ataque, Defensa…
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-dex-line" role="table" aria-label="Atributos">
          <div role="row" className="hidden grid-cols-[minmax(0,1.4fr)_5rem_5rem_minmax(0,1fr)_auto] gap-2 border-b border-dex-line bg-black/20 px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-dex-muted sm:grid">
            <span role="columnheader">Atributo</span>
            <span role="columnheader">Valor</span>
            <span role="columnheader">Máximo</span>
            <span role="columnheader">Cómo se ve</span>
            <span role="columnheader" className="sr-only">Acciones</span>
          </div>
          {stats.map((stat, i) => {
            const nombre = stat.label.trim() || `atributo ${i + 1}`;
            return (
              <div key={i} role="row" data-testid="stat-row" className="border-b border-dex-line/60 px-3 py-2 last:border-b-0">
                <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center gap-2 sm:grid-cols-[minmax(0,1.4fr)_5rem_5rem_minmax(0,1fr)_auto]">
                  <input aria-label={`Nombre del atributo ${i + 1}`} value={stat.label} onChange={(e) => actualizar(i, { label: e.target.value })} className={celda} placeholder="Ataque" />
                  <input aria-label={`Valor de ${nombre}`} inputMode="numeric" value={stat.value} onChange={(e) => actualizar(i, { value: e.target.value })} className={celda} />
                  <input aria-label={`Máximo de ${nombre}`} inputMode="numeric" value={stat.max} onChange={(e) => actualizar(i, { max: e.target.value })} className={celda} placeholder="100" />
                  <span className="col-span-3 flex items-center gap-2 sm:col-span-1">
                    <Barra stat={stat} />
                    {stat.valueText && <span className="font-mono text-[11px] text-dex-ink">{stat.valueText}</span>}
                  </span>
                  <span className="col-span-3 flex justify-end gap-1 sm:col-span-1">
                    <button type="button" className={ghostButton} aria-pressed={conTexto === i} onClick={() => setConTexto(conTexto === i ? null : i)} title="Texto del valor, p. ej. «S+»">
                      Texto
                    </button>
                    <button type="button" className={ghostButton} aria-label={`Subir ${nombre}`} disabled={i === 0} onClick={() => mover(i, i - 1)}>
                      ↑
                    </button>
                    <button type="button" className={ghostButton} aria-label={`Bajar ${nombre}`} disabled={i === stats.length - 1} onClick={() => mover(i, i + 1)}>
                      ↓
                    </button>
                    <button type="button" className={`${ghostButton} hover:!text-red-300`} aria-label={`Quitar ${nombre}`} onClick={() => cambiar(stats.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                  </span>
                </div>
                {conTexto === i && (
                  <label className="mt-2 flex items-center gap-2 text-xs text-dex-muted">
                    Texto en vez del número (opcional)
                    <input value={stat.valueText} onChange={(e) => actualizar(i, { valueText: e.target.value })} className={`${celda} max-w-32`} placeholder="S+" />
                  </label>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
