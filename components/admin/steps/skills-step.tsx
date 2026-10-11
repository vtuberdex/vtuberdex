'use client';
/**
 * Paso 6: habilidades.
 *
 * Una LÍNEA por habilidad (nombre, tipo, MP y si cumple las reglas), agrupadas como en la ficha
 * pública. Al pulsarla se despliega cómo se ve y, debajo, la edición a mano. Antes cada habilidad era
 * una tarjeta con cinco campos abiertos (categoría, nombre, sección, tipo, efecto) y el asistente iba
 * encima con las cinco piezas a la vez: una sábana. Ahora lo normal es leer el kit de un vistazo y
 * entrar solo a la pieza que hay que tocar; el asistente (`KitBuilder`) va pieza por pieza y sustituye
 * a la lista mientras está abierto.
 */
import { useMemo, useState } from 'react';

import { emptySkill, type SkillForm } from '@/components/admin/form-model';
import { KitBuilder, ListaDeProblemas, type Problema } from '@/components/admin/kit-builder';
import { MP_ACTIVA, MP_ULTIMATE } from '@/components/admin/kit-habilidades';
import type { StepProps } from '@/components/admin/steps/types';
import { ghostButton, inputClass, labelClass, primaryButton } from '@/components/admin/ui';
import { validarKit } from '@/server/src/habilidades.mjs';

const compact = `${inputClass} !mt-1`;

const GRUPOS: Array<{ category: SkillForm['category']; titulo: string }> = [
  { category: 'active', titulo: 'Activas' },
  { category: 'passive', titulo: 'Pasivas' },
  { category: 'ultimate', titulo: 'Ultimate' },
  { category: 'other', titulo: 'Otras' },
];

/** El nombre de la pieza tal como lo usa `validarKit` («Activa 2», «Ultimate»). */
function piezaDe(category: SkillForm['category'], posicion: number): string {
  if (category === 'ultimate') return 'Ultimate';
  if (category === 'active') return `Activa ${posicion + 1}`;
  if (category === 'passive') return `Pasiva ${posicion + 1}`;
  return '';
}

function mpDe(category: SkillForm['category'], posicion: number): number | null {
  if (category === 'active') return MP_ACTIVA[posicion] ?? null;
  if (category === 'ultimate') return MP_ULTIMATE;
  return null;
}

export function SkillsStep({ form, set }: StepProps) {
  const [asistente, setAsistente] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const skills = form.skills;
  const cambiar = (next: SkillForm[]) => set('skills', next);

  const problemas: Problema[] = useMemo(() => {
    const kit = skills.filter((s) => s.category !== 'other');
    if (!kit.length) return [];
    return validarKit({
      habilidades: kit.map((s) => ({ category: s.category as 'active' | 'passive' | 'ultimate', name: s.name, effectHtml: s.effectHtml ?? s.effect })),
      // Sin facciones no se sabe nada de la exclusividad: no se acusa a ciegas (igual que el informe).
      facciones: form.factions.length ? form.factions : null,
    });
  }, [skills, form.factions]);
  const errores = problemas.filter((p) => p.gravedad === 'error').length;
  const avisos = problemas.length - errores;
  const delKit = problemas.filter((p) => p.pieza === 'Kit');

  if (asistente) {
    return (
      <KitBuilder
        skills={skills}
        facciones={form.factions}
        onCancel={() => setAsistente(false)}
        onApply={(next) => {
          cambiar(next);
          setAsistente(false);
          setAbierta(null);
          setAviso('Kit puesto en la ficha. Guarda los cambios para publicarlo.');
        }}
      />
    );
  }

  const actualizar = (i: number, parche: Partial<SkillForm>) => cambiar(skills.map((s, j) => (j === i ? { ...s, ...parche } : s)));
  /** Posición de cada habilidad dentro de su categoría: «Activa 2» es la segunda activa, esté donde esté en la lista. */
  const posiciones = skills.map((s, i) => skills.slice(0, i).filter((x) => x.category === s.category).length);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dex-line bg-black/20 px-4 py-3">
        <div className="text-sm" data-testid="kit-resumen">
          {skills.length === 0 ? (
            <span className="text-dex-muted">Esta ficha aún no tiene habilidades.</span>
          ) : errores === 0 && avisos === 0 ? (
            <span className="text-emerald-300">✓ El kit cumple todas las reglas que se pueden comprobar.</span>
          ) : (
            <span>
              {errores > 0 && <span className="text-red-300">{errores === 1 ? '1 error' : `${errores} errores`}</span>}
              {errores > 0 && avisos > 0 && <span className="text-dex-muted"> · </span>}
              {avisos > 0 && <span className="text-amber-200">{avisos === 1 ? '1 aviso' : `${avisos} avisos`}</span>}
              <span className="text-dex-muted"> — abre cada habilidad para ver el detalle.</span>
            </span>
          )}
        </div>
        <button type="button" className={primaryButton} onClick={() => { setAviso(null); setAsistente(true); }}>
          {skills.some((s) => s.category !== 'other') ? 'Rehacer el kit con el asistente' : 'Armar el kit con el asistente'}
        </button>
      </div>
      {aviso && <p className="text-xs text-emerald-300">{aviso}</p>}
      {delKit.length > 0 && <ListaDeProblemas problemas={delKit} />}

      {GRUPOS.map((g) => {
        const filas = skills.map((s, i) => ({ s, i })).filter(({ s }) => s.category === g.category);
        if (!filas.length) return null;
        return (
          <section key={g.category} className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">{g.titulo}</h4>
            <ul className="space-y-1.5">
              {filas.map(({ s, i }) => {
                const posicion = posiciones[i];
                const pieza = piezaDe(s.category, posicion);
                const suyos = pieza ? problemas.filter((p) => p.pieza.split(', ').includes(pieza)) : [];
                const suyosErrores = suyos.filter((p) => p.gravedad === 'error').length;
                const mp = mpDe(s.category, posicion);
                const abiertaEsta = abierta === i;
                return (
                  <li key={i} className="rounded-xl border border-dex-line bg-dex-void/40" data-testid="skill-row">
                    <button
                      type="button"
                      aria-expanded={abiertaEsta}
                      onClick={() => setAbierta(abiertaEsta ? null : i)}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                    >
                      <span
                        aria-label={suyosErrores ? 'con errores' : suyos.length ? 'con avisos' : 'correcta'}
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${suyosErrores ? 'bg-red-400' : suyos.length ? 'bg-amber-300' : 'bg-emerald-400'}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-dex-ink">{s.name || 'Sin nombre'}</span>
                        <span className="block truncate text-[11px] text-dex-muted">{[pieza || null, s.type || null].filter(Boolean).join(' · ')}</span>
                      </span>
                      {mp && <span className="shrink-0 font-mono text-[11px] text-dex-muted">MP {mp}</span>}
                      <span aria-hidden className={`text-dex-muted transition-transform ${abiertaEsta ? 'rotate-180' : ''}`}>▾</span>
                    </button>
                    {abiertaEsta && (
                      <div className="space-y-3 border-t border-dex-line/70 px-3 py-3">
                        {/* El HTML viene del asistente (escapado) o del scrape, y el servidor solo acepta su lista blanca. */}
                        <div className="text-sm leading-relaxed text-dex-ink/85" dangerouslySetInnerHTML={{ __html: s.effectHtml ?? s.effect }} />
                        {suyos.length > 0 && <ListaDeProblemas problemas={suyos} />}
                        <details className="rounded-lg border border-dex-line/70 p-2">
                          <summary className="cursor-pointer text-xs text-dex-muted">Editar a mano</summary>
                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <label className={`${labelClass} sm:col-span-2`}>
                              Nombre
                              <input value={s.name} onChange={(e) => actualizar(i, { name: e.target.value })} className={compact} />
                            </label>
                            <label className={labelClass}>
                              Categoría
                              <select value={s.category} onChange={(e) => actualizar(i, { category: e.target.value as SkillForm['category'] })} className={compact}>
                                <option value="active">Activa</option>
                                <option value="passive">Pasiva</option>
                                <option value="ultimate">Ultimate</option>
                                <option value="other">Otra</option>
                              </select>
                            </label>
                            <label className={labelClass}>
                              Tipo
                              <input value={s.type} onChange={(e) => actualizar(i, { type: e.target.value })} className={compact} />
                            </label>
                            <label className={`${labelClass} sm:col-span-2`}>
                              Sección
                              <input value={s.section} onChange={(e) => actualizar(i, { section: e.target.value })} className={compact} />
                            </label>
                            <label className={`${labelClass} sm:col-span-3`}>
                              Efecto
                              {/* Reescribir el texto suelta el HTML de ESTA habilidad: el HTML ya no lo describiría. */}
                              <textarea rows={4} value={s.effect} onChange={(e) => actualizar(i, { effect: e.target.value, effectHtml: null })} className={compact} />
                              {s.effectHtml && (
                                <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
                                  Si editas este texto, esta habilidad pierde los colores de los estados. Para cambiarla sin perderlos, rehaz el kit con el asistente.
                                </span>
                              )}
                            </label>
                          </div>
                        </details>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            className={`${ghostButton} hover:!text-red-300`}
                            onClick={() => {
                              cambiar(skills.filter((_, j) => j !== i));
                              setAbierta(null);
                            }}
                          >
                            Quitar habilidad
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <button
        type="button"
        className={ghostButton}
        disabled={skills.length >= 30}
        onClick={() => {
          cambiar([...skills, { ...emptySkill(), category: 'other' }]);
          setAbierta(skills.length);
        }}
      >
        + Agregar una habilidad a mano
      </button>
    </div>
  );
}
