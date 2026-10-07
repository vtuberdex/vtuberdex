'use client';
/**
 * Asistente del KIT de habilidades (2 activas, 2 pasivas, Ultimate y Habilidad Única opcional).
 *
 * PIEZA POR PIEZA: una pestaña por habilidad (con ✓ o ⚠ según lo que le falte) y una de «Revisar».
 * La primera versión ponía las cinco piezas, la revisión y la vista previa en una sola columna y
 * era una sábana difícil de seguir; ahora cada pantalla tiene un formulario corto y su vista previa al
 * lado. La persona elige nombres, estados y fórmulas; el HTML (colores, verbos, evoluciones, `<br>`)
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
  type PasivaForm,
  type ActivaForm,
  type EstadoElegido,
  type KitForm,
  type UltimateForm,
} from '@/components/admin/kit-habilidades';
import { ghostButton, inputClass, labelClass, primaryButton } from '@/components/admin/ui';
import { buscarEstado, type validarKit } from '@/server/src/habilidades.mjs';

const compact = `${inputClass} !mt-1`;
const AYUDA_TOKENS = 'Una línea por efecto. Escribe [[Miedo]] para poner un estado con su color oficial.';

export type Problema = ReturnType<typeof validarKit>[number];

export function ListaDeProblemas({ problemas, faltan = [] }: { problemas: Problema[]; faltan?: string[] }) {
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
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={labelClass}>
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
          Turnos
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
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Nombre
          <input value={valor.nombre} onChange={(e) => set({ nombre: e.target.value })} className={compact} />
        </label>
        <label className={labelClass}>
          Fórmula
          <select value={valor.formula} onChange={(e) => set({ formula: e.target.value as UltimateForm['formula'] })} className={compact}>
            <option value="consecutivos">Varios ataques</option>
            <option value="directo">Un solo ataque</option>
            <option value="dado">Dado 1d6</option>
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
          Turnos
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

const PIEZAS = ['Activa 1', 'Activa 2', 'Pasiva 1', 'Pasiva 2', 'Ultimate'] as const;
const REVISAR = PIEZAS.length;

/** A qué pieza pertenece un «Falta: …» de `faltantes` (las de la Ultimate no nombran «Ultimate» siempre). */
function piezaDeFaltante(texto: string): string {
  if (/Ultimate|Única/.test(texto)) return 'Ultimate';
  return /(Activa|Pasiva) \d/.exec(texto)?.[0] ?? '';
}

function EditorDePasiva({ valor, onChange, indice }: { valor: PasivaForm; onChange: (v: PasivaForm) => void; indice: number }) {
  return (
    <Pieza titulo={`Pasiva ${indice + 1}`}>
      <label className={labelClass}>
        Nombre
        <input value={valor.nombre} onChange={(e) => onChange({ ...valor, nombre: e.target.value })} className={compact} />
      </label>
      <label className={labelClass}>
        Efecto
        <textarea rows={4} value={valor.texto} onChange={(e) => onChange({ ...valor, texto: e.target.value })} className={compact} />
        <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">{AYUDA_TOKENS}</span>
      </label>
    </Pieza>
  );
}

export function KitBuilder({
  skills,
  facciones,
  onApply,
  onCancel,
}: {
  skills: SkillForm[];
  facciones: string[];
  onApply: (skills: SkillForm[]) => void;
  onCancel: () => void;
}) {
  const [kit, setKit] = useState<KitForm>(() => kitDesdeHabilidades(skills));
  const [paso, setPaso] = useState(0);
  const [confirmando, setConfirmando] = useState(false);

  const kitActual = skills.filter((s) => s.category !== 'other');
  const revision = useMemo(() => revisarKit(kit, facciones), [kit, facciones]);
  /**
   * Lo que la ficha dice HOY en cada pieza. Activas y Ultimate no se pueden leer de vuelta como menús, así
   * que al rehacerlas se escriben desde cero: tener el texto anterior al lado evita trabajar de memoria.
   */
  const anteriores = [
    ...[0, 1].map((i) => skills.filter((s) => s.category === 'active')[i]),
    ...[0, 1].map((i) => skills.filter((s) => s.category === 'passive')[i]),
    skills.find((s) => s.category === 'ultimate'),
  ];
  const errores = revision.problemas.filter((p) => p.gravedad === 'error').length;
  const listo = revision.faltan.length === 0 && errores === 0;

  /** Lo que toca a cada pieza: sus faltantes y los problemas que la nombran. */
  const dePieza = (pieza: string) => ({
    faltan: revision.faltan.filter((f) => piezaDeFaltante(f) === pieza),
    problemas: revision.problemas.filter((p) => p.pieza.split(', ').includes(pieza)),
  });

  const aplicar = () => {
    onApply(reemplazarKit(skills, revision.habilidades));
  };

  const setActiva = (i: number, v: ActivaForm) => {
    const activas: KitForm['activas'] = [...kit.activas];
    activas[i] = v;
    setKit({ ...kit, activas });
  };
  const setPasiva = (i: number, v: PasivaForm) => {
    const pasivas: KitForm['pasivas'] = [...kit.pasivas];
    pasivas[i] = v;
    setKit({ ...kit, pasivas });
  };

  return (
    <section className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/40 p-4" data-testid="kit-builder">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-dex-ink">Asistente del kit</h4>
          <p className="text-xs text-dex-muted">Tú eliges nombres, estados y textos; colores, verbos y evoluciones los pone el sistema.</p>
        </div>
        <button type="button" className={ghostButton} onClick={onCancel}>
          Cancelar
        </button>
      </div>

      <nav aria-label="Piezas del kit">
        <ol className="flex flex-wrap gap-1.5">
          {[...PIEZAS, 'Revisar'].map((nombre, i) => {
            const estado = i === REVISAR ? null : dePieza(nombre);
            const bien = estado && !estado.faltan.length && !estado.problemas.some((p) => p.gravedad === 'error');
            return (
              <li key={nombre}>
                <button
                  type="button"
                  aria-current={paso === i ? 'step' : undefined}
                  onClick={() => setPaso(i)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                    paso === i ? 'border-dex-accent bg-dex-accent/15 text-dex-ink' : 'border-dex-line text-dex-muted hover:text-dex-ink'
                  }`}
                >
                  {estado && (
                    <span aria-hidden className={bien ? 'text-emerald-300' : 'text-amber-300'}>
                      {bien ? '✓' : '•'}
                    </span>
                  )}
                  {nombre}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {paso < REVISAR ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            {paso < 2 && <EditorDeActiva indice={paso} valor={kit.activas[paso]} facciones={facciones} onChange={(v) => setActiva(paso, v)} />}
            {paso >= 2 && paso < 4 && <EditorDePasiva indice={paso - 2} valor={kit.pasivas[paso - 2]} onChange={(v) => setPasiva(paso - 2, v)} />}
            {paso === 4 && <EditorDeUltimate valor={kit.ultimate} onChange={(ultimate) => setKit({ ...kit, ultimate })} facciones={facciones} />}
          </div>
          <aside className="space-y-3">
            <div className="space-y-1">
              <h5 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">Así se verá</h5>
              <VistaPrevia habilidades={[revision.habilidades[paso]]} />
            </div>
            <ListaDeProblemas {...dePieza(PIEZAS[paso])} />
            {anteriores[paso] && (anteriores[paso]?.effectHtml || anteriores[paso]?.effect) && (
              <details className="rounded-xl border border-dex-line/70 p-2" data-testid="kit-anterior">
                <summary className="cursor-pointer text-xs text-dex-muted">Lo que dice ahora la ficha</summary>
                <p className="mt-2 text-sm font-semibold text-dex-ink">{anteriores[paso]?.name}</p>
                {/* HTML ya guardado en la ficha: el servidor solo acepta su lista blanca. */}
                <div
                  className="mt-1 text-sm leading-relaxed text-dex-ink/75"
                  dangerouslySetInnerHTML={{ __html: anteriores[paso]?.effectHtml ?? anteriores[paso]?.effect ?? '' }}
                />
              </details>
            )}
          </aside>
        </div>
      ) : (
        <div className="space-y-3">
          <ListaDeProblemas problemas={revision.problemas} faltan={revision.faltan} />
          <VistaPrevia habilidades={revision.habilidades} />
          {confirmando && (
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
          )}
        </div>
      )}

      {!confirmando && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dex-line pt-3">
          <button type="button" className={ghostButton} disabled={paso === 0} onClick={() => setPaso(paso - 1)}>
            ← Anterior
          </button>
          {paso < REVISAR ? (
            <button type="button" className={primaryButton} onClick={() => setPaso(paso + 1)}>
              {paso === REVISAR - 1 ? 'Revisar el kit →' : `Siguiente: ${PIEZAS[paso + 1]} →`}
            </button>
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {!listo && <span className="text-[11px] text-dex-muted">Corrige lo marcado para poder usarlo.</span>}
              <button
                type="button"
                className={primaryButton}
                disabled={!listo}
                onClick={() => (kitActual.length ? setConfirmando(true) : aplicar())}
              >
                Usar este kit
              </button>
            </span>
          )}
        </div>
      )}
    </section>
  );
}
