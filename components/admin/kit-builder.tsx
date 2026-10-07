'use client';
/**
 * Asistente del KIT de habilidades (2 activas, 2 pasivas, Ultimate y Habilidad Única opcional).
 *
 * Arriba, siempre: cómo está el kit ACTUAL frente a las reglas del sistema (`validarKit`), para que
 * una ficha heredada del scrape muestre qué rompe sin abrir nada. Abajo, al pulsar «Armar kit»: los
 * menús. La persona elige nombres, estados y fórmulas; el HTML (colores, verbos, evoluciones, `<br>`)
 * lo escribe `kit-habilidades.ts`. «Usar este kit» solo REEMPLAZA las habilidades en el formulario:
 * se publica con el «Guardar» de siempre, así que un kit a medias nunca llega a la base.
 */
import { useMemo, useState, type ReactNode } from 'react';

import type { SkillForm } from '@/components/admin/form-model';
import {
  MP_ACTIVA,
  MP_ULTIMATE,
  estadosDisponibles,
  kitDesdeHabilidades,
  reemplazarKit,
  revisarKit,
  type ActivaForm,
  type EstadoElegido,
  type KitForm,
  type UltimateForm,
} from '@/components/admin/kit-habilidades';
import { ghostButton, inputClass, labelClass, primaryButton } from '@/components/admin/ui';
import { buscarEstado, validarKit } from '@/server/src/habilidades.mjs';

const compact = `${inputClass} !mt-1`;
const AYUDA_TOKENS = 'Una línea por efecto. Escribe [[Miedo]] para poner un estado con su color oficial.';

type Problema = ReturnType<typeof validarKit>[number];

function ListaDeProblemas({ problemas, faltan = [] }: { problemas: Problema[]; faltan?: string[] }) {
  if (!problemas.length && !faltan.length) {
    return <p className="text-xs text-emerald-300" data-testid="kit-ok">Cumple todas las reglas que se pueden comprobar.</p>;
  }
  return (
    <ul className="space-y-1 text-xs" data-testid="kit-problemas">
      {faltan.map((f) => (
        <li key={f} className="text-amber-200">Falta: {f}</li>
      ))}
      {problemas.map((p, i) => (
        <li key={`${p.codigo}-${i}`} className={p.gravedad === 'error' ? 'text-red-300' : 'text-amber-200'}>
          <span className="font-semibold">{p.gravedad === 'error' ? 'Error' : 'Aviso'}</span> · {p.pieza}: {p.detalle}
        </li>
      ))}
    </ul>
  );
}

/**
 * Selector de estado. En la Ultimate cada opción muestra la evolución que se escribirá. Los exclusivos
 * de una facción que la ficha no tiene salen deshabilitados (con el motivo), no ocultos: así se sabe
 * que existen y por qué no se pueden usar.
 */
function SelectorDeEstado({
  valor,
  onChange,
  facciones,
  ultimate = false,
  etiqueta,
  opcional = false,
}: {
  valor: EstadoElegido;
  onChange: (v: EstadoElegido) => void;
  facciones: string[];
  ultimate?: boolean;
  etiqueta: string;
  opcional?: boolean;
}) {
  const estados = estadosDisponibles(facciones);
  const grupos: Array<{ titulo: string; polaridad: string }> = [
    { titulo: 'Positivos (se obtienen)', polaridad: 'positivo' },
    { titulo: 'Negativos (se aplican)', polaridad: 'negativo' },
    { titulo: 'Según el uso (eliges el verbo)', polaridad: 'ambos' },
  ];
  const ambos = buscarEstado(valor.nombre)?.estado.polaridad === 'ambos';
  return (
    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
      <label className={labelClass}>
        {etiqueta}
        <select value={valor.nombre} onChange={(e) => onChange({ ...valor, nombre: e.target.value })} className={compact}>
          <option value="">{opcional ? 'Sin estado' : 'Elige un estado…'}</option>
          {grupos.map((g) => (
            <optgroup key={g.polaridad} label={g.titulo}>
              {estados
                .filter((e) => e.polaridad === g.polaridad)
                .map((e) => (
                  <option key={e.nombre} value={e.nombre} disabled={e.bloqueado}>
                    {ultimate ? `${e.evolucion} (de ${e.nombre})` : e.nombre}
                    {e.bloqueado ? ' — exclusivo de otra facción' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {ambos && (
        <label className={labelClass}>
          Verbo
          <select value={valor.verbo} onChange={(e) => onChange({ ...valor, verbo: e.target.value as EstadoElegido['verbo'] })} className={compact}>
            <option value="aplicas">aplicas (al enemigo)</option>
            <option value="obtienes">obtienes (tú)</option>
          </select>
        </label>
      )}
    </div>
  );
}

function Pieza({ titulo, mp, children }: { titulo: string; mp?: number; children: ReactNode }) {
  return (
    <fieldset className="space-y-2 rounded-xl border border-dex-line p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-[0.14em] text-dex-ink">
        {titulo}
        {mp ? <span className="ml-2 font-mono text-dex-muted">MP {mp}</span> : null}
      </legend>
      {children}
    </fieldset>
  );
}

function EditorDeActiva({ valor, onChange, facciones, indice }: { valor: ActivaForm; onChange: (v: ActivaForm) => void; facciones: string[]; indice: number }) {
  const set = (parche: Partial<ActivaForm>) => onChange({ ...valor, ...parche });
  return (
    <Pieza titulo={`Activa ${indice + 1}`} mp={MP_ACTIVA[indice]}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={`${labelClass} sm:col-span-2`}>
          Nombre
          <input value={valor.nombre} onChange={(e) => set({ nombre: e.target.value })} className={compact} />
        </label>
        <label className={labelClass}>
          Tipo
          <select value={valor.tipo} onChange={(e) => set({ tipo: e.target.value as ActivaForm['tipo'] })} className={compact}>
            <option>Ofensivo</option>
            <option>Defensivo</option>
            <option>Soporte</option>
          </select>
        </label>
        <label className={labelClass}>
          Daño
          <select value={valor.ataque} onChange={(e) => set({ ataque: e.target.value as ActivaForm['ataque'] })} className={compact}>
            <option value="base">Ataque Base</option>
            <option value="magico">Ataque Mágico Base</option>
            <option value="ninguno">Sin daño</option>
          </select>
        </label>
        {valor.ataque !== 'ninguno' && (
          <label className={labelClass}>
            Bono (+)
            <input inputMode="numeric" value={valor.bono} onChange={(e) => set({ bono: e.target.value })} className={compact} />
          </label>
        )}
        <label className={labelClass}>
          Turnos del estado
          <input inputMode="numeric" value={valor.turnos} onChange={(e) => set({ turnos: e.target.value })} className={compact} />
        </label>
      </div>
      <SelectorDeEstado etiqueta="Estado (máximo uno)" opcional valor={valor.estado} onChange={(estado) => set({ estado })} facciones={facciones} />
      <label className={labelClass}>
        Efecto adicional
        <textarea rows={2} value={valor.extra} onChange={(e) => set({ extra: e.target.value })} className={compact} placeholder="Si el enemigo posee [[Miedo]], recuperas 5% de MP." />
        <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">{AYUDA_TOKENS} No apliques un segundo estado aquí.</span>
      </label>
    </Pieza>
  );
}

function EditorDeUltimate({ valor, onChange, facciones }: { valor: UltimateForm; onChange: (v: UltimateForm) => void; facciones: string[] }) {
  const set = (parche: Partial<UltimateForm>) => onChange({ ...valor, ...parche });
  const setUnica = (parche: Partial<UltimateForm['unica']>) => set({ unica: { ...valor.unica, ...parche } });
  const setEstado = (i: 0 | 1, estado: EstadoElegido) => {
    const estados: UltimateForm['estados'] = [...valor.estados];
    estados[i] = estado;
    set({ estados });
  };
  return (
    <Pieza titulo="Ultimate" mp={MP_ULTIMATE}>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className={`${labelClass} sm:col-span-3`}>
          Nombre
          <input value={valor.nombre} onChange={(e) => set({ nombre: e.target.value })} className={compact} />
        </label>
        <label className={labelClass}>
          Fórmula
          <select value={valor.formula} onChange={(e) => set({ formula: e.target.value as UltimateForm['formula'] })} className={compact}>
            <option value="consecutivos">N ataques consecutivos</option>
            <option value="directo">Un ataque directo</option>
            <option value="dado">Lanza 1d6 (X ataques)</option>
          </select>
        </label>
        <label className={labelClass}>
          Daño
          <select value={valor.ataque} onChange={(e) => set({ ataque: e.target.value as UltimateForm['ataque'] })} className={compact}>
            <option value="base">Ataque Base</option>
            <option value="magico">Ataque Mágico Base</option>
          </select>
        </label>
        <label className={labelClass}>
          Bono (+)
          <input inputMode="numeric" value={valor.bono} onChange={(e) => set({ bono: e.target.value })} className={compact} />
        </label>
        {valor.formula === 'consecutivos' && (
          <label className={labelClass}>
            Ataques
            <input inputMode="numeric" value={valor.golpes} onChange={(e) => set({ golpes: e.target.value })} className={compact} />
          </label>
        )}
        <label className={labelClass}>
          Turnos de los estados
          <input inputMode="numeric" value={valor.turnos} onChange={(e) => set({ turnos: e.target.value })} className={compact} />
        </label>
      </div>
      <p className="text-[11px] text-dex-muted">Exactamente dos estados. Se escriben en su evolución, con sus efectos oficiales.</p>
      <SelectorDeEstado etiqueta="Estado 1" ultimate valor={valor.estados[0]} onChange={(e) => setEstado(0, e)} facciones={facciones} />
      <SelectorDeEstado etiqueta="Estado 2" ultimate valor={valor.estados[1]} onChange={(e) => setEstado(1, e)} facciones={facciones} />
      <label className={labelClass}>
        Efecto adicional (opcional)
        <textarea rows={2} value={valor.extra} onChange={(e) => set({ extra: e.target.value })} className={compact} />
      </label>

      <label className="flex items-center gap-2 text-sm text-dex-ink">
        <input type="checkbox" checked={valor.unica.activa} onChange={(e) => setUnica({ activa: e.target.checked })} />
        Activa una Habilidad Única
      </label>
      {valor.unica.activa && (
        <div className="grid gap-2 rounded-lg border border-dex-line/70 p-2 sm:grid-cols-4">
          <label className={`${labelClass} sm:col-span-2`}>
            Nombre (en inglés)
            <input value={valor.unica.nombre} onChange={(e) => setUnica({ nombre: e.target.value })} className={compact} />
          </label>
          <label className={labelClass}>
            Color
            <input type="color" value={valor.unica.color} onChange={(e) => setUnica({ color: e.target.value })} className={`${compact} h-9 p-1`} />
          </label>
          <label className={labelClass}>
            Turnos
            <input inputMode="numeric" value={valor.unica.turnos} onChange={(e) => setUnica({ turnos: e.target.value })} className={compact} />
          </label>
          <label className={`${labelClass} sm:col-span-4`}>
            Condición (opcional)
            <input value={valor.unica.condicion} onChange={(e) => setUnica({ condicion: e.target.value })} className={compact} placeholder="Si el enemigo posee 2 o más estados negativos" />
          </label>
          <label className={`${labelClass} sm:col-span-4`}>
            Efectos mientras está activa
            <textarea rows={3} value={valor.unica.efectos} onChange={(e) => setUnica({ efectos: e.target.value })} className={compact} />
            <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">{AYUDA_TOKENS}</span>
          </label>
        </div>
      )}
    </Pieza>
  );
}

function VistaPrevia({ habilidades }: { habilidades: SkillForm[] }) {
  return (
    <ul className="space-y-2" data-testid="kit-vista-previa">
      {habilidades.map((h, i) => (
        <li key={i} className="rounded-xl border border-dex-line/80 bg-black/25 px-3 py-2 text-sm">
          <p className="font-bold text-dex-ink">{h.name || <span className="text-dex-muted">(sin nombre)</span>}</p>
          {/* El HTML sale de kit-habilidades.ts: lo escrito a mano va escapado y los estados son del catálogo. */}
          <div className="mt-1 leading-relaxed text-dex-ink/85" dangerouslySetInnerHTML={{ __html: h.effectHtml ?? '' }} />
        </li>
      ))}
    </ul>
  );
}

export function KitBuilder({ skills, facciones, onApply }: { skills: SkillForm[]; facciones: string[]; onApply: (skills: SkillForm[]) => void }) {
  const [kit, setKit] = useState<KitForm | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const kitActual = skills.filter((s) => s.category !== 'other');
  const problemasActuales = useMemo(() => {
    const actual = skills.filter((s) => s.category !== 'other');
    if (!actual.length) return [];
    return validarKit({
      habilidades: actual.map((s) => ({ category: s.category as 'active' | 'passive' | 'ultimate', name: s.name, effectHtml: s.effectHtml ?? s.effect })),
      // Sin facciones no se sabe nada de la exclusividad: no se acusa a ciegas (igual que el informe).
      facciones: facciones.length ? facciones : null,
    });
  }, [skills, facciones]);
  const revision = useMemo(() => (kit ? revisarKit(kit, facciones) : null), [kit, facciones]);
  const errores = revision ? revision.problemas.filter((p) => p.gravedad === 'error').length : 0;
  const listo = revision !== null && revision.faltan.length === 0 && errores === 0;

  const aplicar = () => {
    if (!revision) return;
    onApply(reemplazarKit(skills, revision.habilidades));
    setKit(null);
    setConfirmando(false);
    setAviso('Kit puesto en el formulario. Guarda los cambios para publicarlo.');
  };

  return (
    <section className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/40 p-4" data-testid="kit-builder">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-bold text-dex-ink">Kit del RPG</h4>
        {!kit && (
          <button
            type="button"
            className={ghostButton}
            onClick={() => {
              setAviso(null);
              setKit(kitDesdeHabilidades(skills));
            }}
          >
            {kitActual.length ? 'Rehacer el kit con el asistente' : 'Armar el kit con el asistente'}
          </button>
        )}
      </div>
      {aviso && <p className="text-xs text-emerald-300">{aviso}</p>}
      {!kit && kitActual.length > 0 && <ListaDeProblemas problemas={problemasActuales} />}
      {!kit && !facciones.length && (
        <p className="text-[11px] text-dex-muted">La ficha no tiene facciones: no se comprueban los estados exclusivos.</p>
      )}

      {kit && revision && (
        <div className="space-y-3">
          <p className="text-xs text-dex-muted">
            Tú decides los nombres, los estados y lo que dicen las pasivas a partir del lore; los colores, los verbos y las
            evoluciones los pone el sistema.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">
            {kit.activas.map((a, i) => (
              <EditorDeActiva
                key={i}
                indice={i}
                valor={a}
                facciones={facciones}
                onChange={(v) => {
                  const activas: KitForm['activas'] = [...kit.activas];
                  activas[i] = v;
                  setKit({ ...kit, activas });
                }}
              />
            ))}
            {kit.pasivas.map((p, i) => (
              <Pieza key={i} titulo={`Pasiva ${i + 1}`}>
                <label className={labelClass}>
                  Nombre
                  <input
                    value={p.nombre}
                    onChange={(e) => {
                      const pasivas: KitForm['pasivas'] = [...kit.pasivas];
                      pasivas[i] = { ...p, nombre: e.target.value };
                      setKit({ ...kit, pasivas });
                    }}
                    className={compact}
                  />
                </label>
                <label className={labelClass}>
                  Efecto
                  <textarea
                    rows={3}
                    value={p.texto}
                    onChange={(e) => {
                      const pasivas: KitForm['pasivas'] = [...kit.pasivas];
                      pasivas[i] = { ...p, texto: e.target.value };
                      setKit({ ...kit, pasivas });
                    }}
                    className={compact}
                  />
                  <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">{AYUDA_TOKENS}</span>
                </label>
              </Pieza>
            ))}
          </div>
          <EditorDeUltimate valor={kit.ultimate} onChange={(ultimate) => setKit({ ...kit, ultimate })} facciones={facciones} />

          <div className="space-y-2 rounded-xl border border-dex-line p-3">
            <h5 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Revisión</h5>
            <ListaDeProblemas problemas={revision.problemas} faltan={revision.faltan} />
          </div>
          <details className="rounded-xl border border-dex-line p-3">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Vista previa</summary>
            <div className="mt-2">
              <VistaPrevia habilidades={revision.habilidades} />
            </div>
          </details>

          {confirmando ? (
            <div role="alertdialog" aria-label="Confirmar reemplazo del kit" className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
              <p>
                Se reemplazan las {kitActual.length} habilidades actuales. Los puntos de habilidad repartidos en «Mi ficha» van por
                NOMBRE: si cambias un nombre, esos puntos dejan de contar.
              </p>
              <div className="flex gap-2">
                <button type="button" className={primaryButton} onClick={aplicar}>
                  Reemplazar
                </button>
                <button type="button" className={ghostButton} onClick={() => setConfirmando(false)}>
                  Volver
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primaryButton}
                disabled={!listo}
                onClick={() => (kitActual.length ? setConfirmando(true) : aplicar())}
              >
                Usar este kit
              </button>
              <button type="button" className={ghostButton} onClick={() => setKit(null)}>
                Cancelar
              </button>
              {!listo && <span className="self-center text-[11px] text-dex-muted">Corrige lo marcado para poder usarlo.</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
