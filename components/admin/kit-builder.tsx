// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
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
import {
  useCallback,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { SkillForm } from "@/components/admin/form-model";
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
  FRACCION_DEL_DADO,
  type CarasDelDado,
} from "@/components/admin/kit-habilidades";
import {
  ghostButton,
  inputClass,
  labelClass,
  primaryButton,
} from "@/components/admin/ui";
import {
  buscarEstado,
  htmlDeEfecto,
  type validarKit,
} from "@/server/src/habilidades.mjs";

const compact = `${inputClass} !mt-1`;
const AYUDA_TOKENS =
  "Una línea por efecto. Escribe [[Miedo]] para poner un estado con su color oficial.";

export type Problema = ReturnType<typeof validarKit>[number];

export function ListaDeProblemas({
  problemas,
  faltan = [],
}: Readonly<{
  problemas: Problema[];
  faltan?: string[];
}>) {
  if (!problemas.length && !faltan.length) {
    return (
      <p className="text-xs text-emerald-300" data-testid="kit-ok">
        Cumple todas las reglas que se pueden comprobar.
      </p>
    );
  }
  return (
    <ul className="space-y-1 text-xs" data-testid="kit-problemas">
      {faltan.map((f) => (
        <li key={f} className="text-amber-200">
          Falta: {f}
        </li>
      ))}
      {/* `validarKit` anota cada (código, pieza, detalle) una sola vez: esa terna es la identidad. */}
      {problemas.map((p) => (
        <li
          key={`${p.codigo}|${p.pieza}|${p.detalle}`}
          className={p.gravedad === "error" ? "text-red-300" : "text-amber-200"}
        >
          <span className="font-semibold">
            {p.gravedad === "error" ? "Error" : "Aviso"}
          </span>{" "}
          · {p.pieza}: {p.detalle}
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
  subfacciones = {},
  ultimate = false,
  etiqueta,
  opcional = false,
}: Readonly<{
  valor: EstadoElegido;
  onChange: (v: EstadoElegido) => void;
  facciones: string[];
  /** Subfacción → madre (catálogo): una subfacción habilita los estados de su madre. */
  subfacciones?: Record<string, string>;
  ultimate?: boolean;
  etiqueta: string;
  opcional?: boolean;
}>) {
  const estados = estadosDisponibles(facciones, subfacciones);
  const grupos: Array<{ titulo: string; polaridad: string }> = [
    { titulo: "Positivos (se obtienen)", polaridad: "positivo" },
    { titulo: "Negativos (se aplican)", polaridad: "negativo" },
    { titulo: "Según el uso (eliges el verbo)", polaridad: "ambos" },
  ];
  const ambos = buscarEstado(valor.nombre)?.estado.polaridad === "ambos";
  return (
    <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
      <label className={labelClass}>
        {etiqueta}
        <select
          value={valor.nombre}
          onChange={(e) => onChange({ ...valor, nombre: e.target.value })}
          className={compact}
        >
          <option value="">
            {opcional ? "Sin estado" : "Elige un estado…"}
          </option>
          {grupos.map((g) => (
            <optgroup key={g.polaridad} label={g.titulo}>
              {estados
                .filter((e) => e.polaridad === g.polaridad)
                .map((e) => (
                  <option
                    key={e.nombre}
                    value={e.nombre}
                    disabled={e.bloqueado}
                  >
                    {ultimate ? `${e.evolucion} (de ${e.nombre})` : e.nombre}
                    {e.bloqueado ? " — exclusivo de otra facción" : ""}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
      {ambos && (
        <label className={labelClass}>
          Verbo{" "}
          <select
            value={valor.verbo}
            onChange={(e) =>
              onChange({
                ...valor,
                verbo: e.target.value as EstadoElegido["verbo"],
              })
            }
            className={compact}
          >
            <option value="aplicas">aplicas (al enemigo)</option>
            <option value="obtienes">obtienes (tú)</option>
          </select>
        </label>
      )}
    </div>
  );
}

function Pieza({
  titulo,
  mp,
  children,
}: Readonly<{
  titulo: string;
  mp?: number;
  children: ReactNode;
}>) {
  return (
    <fieldset className="space-y-2 rounded-xl border border-dex-line p-3">
      <legend className="px-1 text-xs font-bold uppercase tracking-[0.14em] text-dex-ink">
        {titulo}
        {mp ? (
          <span className="ml-2 font-mono text-dex-muted">MP {mp}</span>
        ) : null}
      </legend>
      {children}
    </fieldset>
  );
}

function EditorDeActiva({
  valor,
  onChange,
  facciones,
  subfacciones,
  indice,
}: Readonly<{
  valor: ActivaForm;
  onChange: (v: ActivaForm) => void;
  facciones: string[];
  subfacciones?: Record<string, string>;
  indice: number;
}>) {
  const set = (parche: Partial<ActivaForm>) =>
    onChange({ ...valor, ...parche });
  const cambiarEstado = useCallback(
    (estado: EstadoElegido) => onChange({ ...valor, estado }),
    [valor, onChange],
  );
  return (
    <Pieza titulo={`Activa ${indice + 1}`} mp={MP_ACTIVA[indice]}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={labelClass}>
          Nombre{" "}
          <input
            value={valor.nombre}
            onChange={(e) => set({ nombre: e.target.value })}
            className={compact}
          />
        </label>
        <label className={labelClass}>
          Tipo{" "}
          <select
            value={valor.tipo}
            onChange={(e) =>
              set({ tipo: e.target.value as ActivaForm["tipo"] })
            }
            className={compact}
          >
            <option>Ofensivo</option>
            <option>Defensivo</option>
            <option>Soporte</option>
          </select>
        </label>
        <label className={labelClass}>
          Daño{" "}
          <select
            value={valor.ataque}
            onChange={(e) =>
              set({ ataque: e.target.value as ActivaForm["ataque"] })
            }
            className={compact}
          >
            <option value="base">Ataque Base</option>
            <option value="magico">Ataque Mágico Base</option>
            <option value="ninguno">Sin daño</option>
          </select>
        </label>
        {valor.ataque !== "ninguno" && (
          <label className={labelClass}>
            Bono (+){" "}
            <input
              inputMode="numeric"
              value={valor.bono}
              onChange={(e) => set({ bono: e.target.value })}
              className={compact}
            />
          </label>
        )}
        <label className={labelClass}>
          Turnos{" "}
          <input
            inputMode="numeric"
            value={valor.turnos}
            onChange={(e) => set({ turnos: e.target.value })}
            className={compact}
          />
        </label>
      </div>
      <SelectorDeEstado
        etiqueta="Estado (máximo uno)"
        opcional
        valor={valor.estado}
        onChange={cambiarEstado}
        facciones={facciones}
        subfacciones={subfacciones}
      />
      <label className={labelClass}>
        Efecto adicional{" "}
        <textarea
          rows={2}
          value={valor.extra}
          onChange={(e) => set({ extra: e.target.value })}
          className={compact}
          placeholder="Si el enemigo posee [[Miedo]], recuperas 5% de MP."
        />
        <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
          {AYUDA_TOKENS} No apliques un segundo estado aquí.
        </span>
      </label>
    </Pieza>
  );
}

function EditorDeUltimate({
  valor,
  onChange,
  facciones,
  subfacciones,
}: Readonly<{
  valor: UltimateForm;
  onChange: (v: UltimateForm) => void;
  facciones: string[];
  subfacciones?: Record<string, string>;
}>) {
  const set = (parche: Partial<UltimateForm>) =>
    onChange({ ...valor, ...parche });
  const setUnica = (parche: Partial<UltimateForm["unica"]>) =>
    set({ unica: { ...valor.unica, ...parche } });
  const setEstado = useCallback(
    (i: 0 | 1, estado: EstadoElegido) => {
      const estados: UltimateForm["estados"] = [...valor.estados];
      estados[i] = estado;
      onChange({ ...valor, estados });
    },
    [valor, onChange],
  );
  const cambiarEstado1 = useCallback(
    (e: EstadoElegido) => setEstado(0, e),
    [setEstado],
  );
  const cambiarEstado2 = useCallback(
    (e: EstadoElegido) => setEstado(1, e),
    [setEstado],
  );
  return (
    <Pieza titulo="Ultimate" mp={MP_ULTIMATE}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className={`${labelClass} sm:col-span-2`}>
          Nombre{" "}
          <input
            value={valor.nombre}
            onChange={(e) => set({ nombre: e.target.value })}
            className={compact}
          />
        </label>
        <label className={labelClass}>
          Fórmula{" "}
          <select
            value={valor.formula}
            onChange={(e) =>
              set({ formula: e.target.value as UltimateForm["formula"] })
            }
            className={compact}
          >
            <option value="consecutivos">Varios ataques</option>
            <option value="directo">Un solo ataque</option>
            <option value="dado">Dado (X ataques)</option>
          </select>
        </label>
        <label className={labelClass}>
          Daño{" "}
          <select
            value={valor.ataque}
            onChange={(e) =>
              set({ ataque: e.target.value as UltimateForm["ataque"] })
            }
            className={compact}
          >
            <option value="base">Ataque Base</option>
            <option value="magico">Ataque Mágico Base</option>
          </select>
        </label>
        {valor.formula === "dado" ? (
          <>
            <label className={labelClass}>
              Dados{" "}
              <select
                value={valor.dados}
                onChange={(e) =>
                  set({ dados: e.target.value as UltimateForm["dados"] })
                }
                className={compact}
              >
                <option value="1">1 dado</option>
                <option value="2">2 dados (X = la suma)</option>
              </select>
            </label>
            <label className={labelClass}>
              Caras{" "}
              <select
                value={valor.caras}
                onChange={(e) => set({ caras: e.target.value as CarasDelDado })}
                className={compact}
              >
                {(Object.keys(FRACCION_DEL_DADO) as CarasDelDado[]).map((c) => (
                  <option key={c} value={c}>
                    d{c} · cada ataque, {FRACCION_DEL_DADO[c]}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label className={labelClass}>
            Bono (+){" "}
            <input
              inputMode="numeric"
              value={valor.bono}
              onChange={(e) => set({ bono: e.target.value })}
              className={compact}
            />
          </label>
        )}
        {valor.formula === "consecutivos" && (
          <label className={labelClass}>
            Ataques{" "}
            <input
              inputMode="numeric"
              value={valor.golpes}
              onChange={(e) => set({ golpes: e.target.value })}
              className={compact}
            />
          </label>
        )}
        <label className={labelClass}>
          Turnos{" "}
          <input
            inputMode="numeric"
            value={valor.turnos}
            onChange={(e) => set({ turnos: e.target.value })}
            className={compact}
          />
        </label>
      </div>
      <p className="text-[11px] text-dex-muted">
        Exactamente dos estados. Se escriben en su evolución, con sus efectos
        oficiales.
      </p>
      <SelectorDeEstado
        etiqueta="Estado 1"
        ultimate
        valor={valor.estados[0]}
        onChange={cambiarEstado1}
        facciones={facciones}
        subfacciones={subfacciones}
      />
      <SelectorDeEstado
        etiqueta="Estado 2"
        ultimate
        valor={valor.estados[1]}
        onChange={cambiarEstado2}
        facciones={facciones}
        subfacciones={subfacciones}
      />
      <label className={labelClass}>
        Efecto adicional (opcional){" "}
        <textarea
          rows={2}
          value={valor.extra}
          onChange={(e) => set({ extra: e.target.value })}
          className={compact}
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-dex-ink">
        <input
          type="checkbox"
          checked={valor.unica.activa}
          onChange={(e) => setUnica({ activa: e.target.checked })}
        />{" "}
        Activa una Habilidad Única
      </label>
      {valor.unica.activa && (
        <div className="grid gap-2 rounded-lg border border-dex-line/70 p-2 sm:grid-cols-4">
          <label className={`${labelClass} sm:col-span-2`}>
            Nombre (en inglés){" "}
            <input
              value={valor.unica.nombre}
              onChange={(e) => setUnica({ nombre: e.target.value })}
              className={compact}
            />
          </label>
          <label className={labelClass}>
            Color{" "}
            <input
              type="color"
              value={valor.unica.color}
              onChange={(e) => setUnica({ color: e.target.value })}
              className={`${compact} h-9 p-1`}
            />
          </label>
          <label className={labelClass}>
            Turnos{" "}
            <input
              inputMode="numeric"
              value={valor.unica.turnos}
              onChange={(e) => setUnica({ turnos: e.target.value })}
              className={compact}
            />
          </label>
          <label className={`${labelClass} sm:col-span-4`}>
            Condición (opcional){" "}
            <input
              value={valor.unica.condicion}
              onChange={(e) => setUnica({ condicion: e.target.value })}
              className={compact}
              placeholder="Si el enemigo posee 2 o más estados negativos"
            />
          </label>
          <label className={`${labelClass} sm:col-span-4`}>
            Efectos mientras está activa{" "}
            <textarea
              rows={3}
              value={valor.unica.efectos}
              onChange={(e) => setUnica({ efectos: e.target.value })}
              className={compact}
            />
            <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
              {AYUDA_TOKENS}
            </span>
          </label>
        </div>
      )}
    </Pieza>
  );
}

/**
 * El kit es posicional (Activa 1, Activa 2, Pasiva 1…): la identidad de cada habilidad es su categoría y
 * su orden dentro de ella, no el nombre (puede estar vacío o repetido mientras se escribe).
 */
function conClaveDePieza(
  habilidades: SkillForm[],
): Array<{ h: SkillForm; clave: string }> {
  const vistas: Record<string, number> = {};
  return habilidades.map((h) => {
    vistas[h.category] = (vistas[h.category] ?? 0) + 1;
    return { h, clave: `${h.category}-${vistas[h.category]}` };
  });
}

function VistaPrevia({ habilidades }: Readonly<{ habilidades: SkillForm[] }>) {
  return (
    <ul className="space-y-2" data-testid="kit-vista-previa">
      {conClaveDePieza(habilidades).map(({ h, clave }) => (
        <li
          key={clave}
          className="rounded-xl border border-dex-line/80 bg-black/25 px-3 py-2 text-sm"
        >
          <p className="font-bold text-dex-ink">
            {h.name || <span className="text-dex-muted">(sin nombre)</span>}
          </p>
          {/* El HTML sale de kit-habilidades.ts: lo escrito a mano va escapado y los estados son del catálogo. */}
          <div
            className="mt-1 leading-relaxed text-dex-ink/85"
            dangerouslySetInnerHTML={{ __html: h.effectHtml ?? "" }}
          />
        </li>
      ))}
    </ul>
  );
}

const PIEZAS = [
  "Activa 1",
  "Activa 2",
  "Pasiva 1",
  "Pasiva 2",
  "Ultimate",
] as const;
const REVISAR = PIEZAS.length;

/** A qué pieza pertenece un «Falta: …» de `faltantes` (las de la Ultimate no nombran «Ultimate» siempre). */
function piezaDeFaltante(texto: string): string {
  if (/Ultimate|Única/.test(texto)) {
    return "Ultimate";
  }
  return /(Activa|Pasiva) \d/.exec(texto)?.[0] ?? "";
}

function EditorDePasiva({
  valor,
  onChange,
  indice,
}: Readonly<{
  valor: PasivaForm;
  onChange: (v: PasivaForm) => void;
  indice: number;
}>) {
  return (
    <Pieza titulo={`Pasiva ${indice + 1}`}>
      <label className={labelClass}>
        Nombre{" "}
        <input
          value={valor.nombre}
          onChange={(e) => onChange({ ...valor, nombre: e.target.value })}
          className={compact}
        />
      </label>
      <label className={labelClass}>
        Efecto{" "}
        <textarea
          rows={4}
          value={valor.texto}
          onChange={(e) => onChange({ ...valor, texto: e.target.value })}
          className={compact}
        />
        <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
          {AYUDA_TOKENS}
        </span>
      </label>
    </Pieza>
  );
}

type Revision = ReturnType<typeof revisarKit>;

/** Lo que toca a cada pieza: sus faltantes y los problemas que la nombran. */
function dePieza(revision: Revision, pieza: string) {
  return {
    faltan: revision.faltan.filter((f) => piezaDeFaltante(f) === pieza),
    problemas: revision.problemas.filter((p) =>
      p.pieza.split(", ").includes(pieza),
    ),
  };
}

/** Una pieza está bien si no le falta nada ni tiene errores (los avisos no cuentan). */
function piezaBien(estado: ReturnType<typeof dePieza>): boolean {
  return (
    !estado.faltan.length &&
    !estado.problemas.some((p) => p.gravedad === "error")
  );
}

function NavDePiezas({
  revision,
  paso,
  onPaso,
}: Readonly<{
  revision: Revision;
  paso: number;
  onPaso: (i: number) => void;
}>) {
  return (
    <nav aria-label="Piezas del kit">
      <ol className="flex flex-wrap gap-1.5">
        {[...PIEZAS, "Revisar"].map((nombre, i) => {
          const estado = i === REVISAR ? null : dePieza(revision, nombre);
          const bien = estado && piezaBien(estado);
          return (
            <li key={nombre}>
              <button
                type="button"
                aria-current={paso === i ? "step" : undefined}
                onClick={() => onPaso(i)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                  paso === i
                    ? "border-dex-accent bg-dex-accent/15 text-dex-ink"
                    : "border-dex-line text-dex-muted hover:text-dex-ink"
                }`}
              >
                {estado && (
                  <span
                    aria-hidden
                    className={bien ? "text-emerald-300" : "text-amber-300"}
                  >
                    {bien ? "✓" : "•"}
                  </span>
                )}
                {nombre}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * El editor de la pieza en curso (0-1 activas, 2-3 pasivas, 4 Ultimate). Los cambios usan la forma
 * funcional de `setKit`: así cada manejador solo depende del paso, no del kit entero.
 */
function EditorDePieza({
  paso,
  kit,
  setKit,
  facciones,
  subfacciones,
}: Readonly<{
  paso: number;
  kit: KitForm;
  setKit: Dispatch<SetStateAction<KitForm>>;
  facciones: string[];
  subfacciones: Record<string, string>;
}>) {
  const cambiarActiva = useCallback(
    (v: ActivaForm) =>
      setKit((actual) => {
        const activas: KitForm["activas"] = [...actual.activas];
        activas[paso] = v;
        return { ...actual, activas };
      }),
    [paso, setKit],
  );
  const cambiarPasiva = useCallback(
    (v: PasivaForm) =>
      setKit((actual) => {
        const pasivas: KitForm["pasivas"] = [...actual.pasivas];
        pasivas[paso - 2] = v;
        return { ...actual, pasivas };
      }),
    [paso, setKit],
  );
  const cambiarUltimate = useCallback(
    (ultimate: UltimateForm) => setKit((actual) => ({ ...actual, ultimate })),
    [setKit],
  );
  if (paso < 2) {
    return (
      <EditorDeActiva
        indice={paso}
        valor={kit.activas[paso]}
        facciones={facciones}
        subfacciones={subfacciones}
        onChange={cambiarActiva}
      />
    );
  }
  if (paso < 4) {
    return (
      <EditorDePasiva
        indice={paso - 2}
        valor={kit.pasivas[paso - 2]}
        onChange={cambiarPasiva}
      />
    );
  }
  return (
    <EditorDeUltimate
      valor={kit.ultimate}
      onChange={cambiarUltimate}
      facciones={facciones}
      subfacciones={subfacciones}
    />
  );
}

/**
 * Lo que la ficha dice HOY en una pieza. Activas y Ultimate no se pueden leer de vuelta como menús, así
 * que al rehacerlas se escriben desde cero: tener el texto anterior al lado evita trabajar de memoria.
 */
function TextoAnterior({ anterior }: Readonly<{ anterior?: SkillForm }>) {
  if (!anterior || !(anterior.effectHtml || anterior.effect)) {
    return null;
  }
  return (
    <details
      className="rounded-xl border border-dex-line/70 p-2"
      data-testid="kit-anterior"
    >
      <summary className="cursor-pointer text-xs text-dex-muted">
        Lo que dice ahora la ficha
      </summary>
      <p className="mt-2 text-sm font-semibold text-dex-ink">{anterior.name}</p>
      {/* HTML ya guardado en la ficha: el servidor solo acepta su lista blanca. */}
      <div
        className="mt-1 text-sm leading-relaxed text-dex-ink/75"
        dangerouslySetInnerHTML={{
          __html: htmlDeEfecto(anterior),
        }}
      />
    </details>
  );
}

function ConfirmarReemplazo({
  cuantas,
  onReemplazar,
  onVolver,
}: Readonly<{
  cuantas: number;
  onReemplazar: () => void;
  onVolver: () => void;
}>) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirmar reemplazo del kit"
      className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100"
    >
      <p>
        Se reemplazan las {cuantas} habilidades actuales. Los puntos de
        habilidad repartidos en «Mi ficha» van por NOMBRE: si cambias un nombre,
        esos puntos dejan de contar.
      </p>
      <div className="flex gap-2">
        <button type="button" className={primaryButton} onClick={onReemplazar}>
          Reemplazar
        </button>
        <button type="button" className={ghostButton} onClick={onVolver}>
          Volver
        </button>
      </div>
    </div>
  );
}

function PieDelKit({
  paso,
  listo,
  onAnterior,
  onSiguiente,
  onUsar,
}: Readonly<{
  paso: number;
  listo: boolean;
  onAnterior: () => void;
  onSiguiente: () => void;
  onUsar: () => void;
}>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-dex-line pt-3">
      <button
        type="button"
        className={ghostButton}
        disabled={paso === 0}
        onClick={onAnterior}
      >
        ← Anterior
      </button>
      {paso < REVISAR ? (
        <button type="button" className={primaryButton} onClick={onSiguiente}>
          {paso === REVISAR - 1
            ? "Revisar el kit →"
            : `Siguiente: ${PIEZAS[paso + 1]} →`}
        </button>
      ) : (
        <span className="flex flex-wrap items-center gap-2">
          {!listo && (
            <span className="text-[11px] text-dex-muted">
              Corrige lo marcado para poder usarlo.
            </span>
          )}
          <button
            type="button"
            className={primaryButton}
            disabled={!listo}
            onClick={onUsar}
          >
            Usar este kit
          </button>
        </span>
      )}
    </div>
  );
}

export function KitBuilder({
  skills,
  facciones,
  subfacciones = {},
  onApply,
  onCancel,
}: Readonly<{
  skills: SkillForm[];
  facciones: string[];
  /** Subfacción → madre (del catálogo): acredita los estados exclusivos de la madre. */
  subfacciones?: Record<string, string>;
  onApply: (skills: SkillForm[]) => void;
  onCancel: () => void;
}>) {
  const [kit, setKit] = useState<KitForm>(() => kitDesdeHabilidades(skills));
  const [paso, setPaso] = useState(0);
  const [confirmando, setConfirmando] = useState(false);

  const kitActual = skills.filter((s) => s.category !== "other");
  const revision = useMemo(
    () => revisarKit(kit, facciones, subfacciones),
    [kit, facciones, subfacciones],
  );
  const anteriores = [
    ...[0, 1].map((i) => skills.filter((s) => s.category === "active")[i]),
    ...[0, 1].map((i) => skills.filter((s) => s.category === "passive")[i]),
    skills.find((s) => s.category === "ultimate"),
  ];
  const errores = revision.problemas.filter(
    (p) => p.gravedad === "error",
  ).length;
  const listo = revision.faltan.length === 0 && errores === 0;

  const aplicar = useCallback(() => {
    onApply(reemplazarKit(skills, revision.habilidades));
  }, [onApply, skills, revision.habilidades]);
  const anterior = useCallback(() => setPaso((p) => p - 1), []);
  const siguiente = useCallback(() => setPaso((p) => p + 1), []);
  const volver = useCallback(() => setConfirmando(false), []);
  // Sin habilidades que perder no hace falta confirmar.
  const usar = useCallback(() => {
    if (kitActual.length) {
      setConfirmando(true);
    } else {
      aplicar();
    }
  }, [kitActual.length, aplicar]);

  return (
    <section
      className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/40 p-4"
      data-testid="kit-builder"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-dex-ink">Asistente del kit</h4>
          <p className="text-xs text-dex-muted">
            Tú eliges nombres, estados y textos; colores, verbos y evoluciones
            los pone el sistema.
          </p>
        </div>
        <button type="button" className={ghostButton} onClick={onCancel}>
          Cancelar
        </button>
      </div>

      <NavDePiezas revision={revision} paso={paso} onPaso={setPaso} />

      {paso < REVISAR ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div>
            <EditorDePieza
              paso={paso}
              kit={kit}
              setKit={setKit}
              facciones={facciones}
              subfacciones={subfacciones}
            />
          </div>
          <aside className="space-y-3">
            <div className="space-y-1">
              <h5 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
                Así se verá
              </h5>
              <VistaPrevia habilidades={[revision.habilidades[paso]]} />
            </div>
            <ListaDeProblemas {...dePieza(revision, PIEZAS[paso])} />
            <TextoAnterior anterior={anteriores[paso]} />
          </aside>
        </div>
      ) : (
        <div className="space-y-3">
          <ListaDeProblemas
            problemas={revision.problemas}
            faltan={revision.faltan}
          />
          <VistaPrevia habilidades={revision.habilidades} />
          {confirmando && (
            <ConfirmarReemplazo
              cuantas={kitActual.length}
              onReemplazar={aplicar}
              onVolver={volver}
            />
          )}
        </div>
      )}

      {!confirmando && (
        <PieDelKit
          paso={paso}
          listo={listo}
          onAnterior={anterior}
          onSiguiente={siguiente}
          onUsar={usar}
        />
      )}
    </section>
  );
}
