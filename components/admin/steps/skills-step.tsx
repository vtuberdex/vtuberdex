// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
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
import { useCallback, useMemo, useState } from "react";

import { emptySkill, type SkillForm } from "@/components/admin/form-model";
import {
  KitBuilder,
  ListaDeProblemas,
  type Problema,
} from "@/components/admin/kit-builder";
import {
  MP_ACTIVA,
  MP_ULTIMATE,
  mapaSubfacciones,
} from "@/components/admin/kit-habilidades";
import type { StepProps } from "@/components/admin/steps/types";
import {
  ghostButton,
  inputClass,
  labelClass,
  primaryButton,
} from "@/components/admin/ui";
import { htmlDeEfecto, validarKit } from "@/server/src/habilidades.mjs";

const compact = `${inputClass} !mt-1`;

const GRUPOS: Array<{ category: SkillForm["category"]; titulo: string }> = [
  { category: "active", titulo: "Activas" },
  { category: "passive", titulo: "Pasivas" },
  { category: "ultimate", titulo: "Ultimate" },
  { category: "other", titulo: "Otras" },
];

/** El nombre de la pieza tal como lo usa `validarKit` («Activa 2», «Ultimate»). */
function piezaDe(category: SkillForm["category"], posicion: number): string {
  if (category === "ultimate") {
    return "Ultimate";
  }
  if (category === "active") {
    return `Activa ${posicion + 1}`;
  }
  if (category === "passive") {
    return `Pasiva ${posicion + 1}`;
  }
  return "";
}

function mpDe(
  category: SkillForm["category"],
  posicion: number,
): number | null {
  if (category === "active") {
    return MP_ACTIVA[posicion] ?? null;
  }
  if (category === "ultimate") {
    return MP_ULTIMATE;
  }
  return null;
}

/** El punto de color de cada fila: rojo con errores, ámbar con avisos, verde si cumple. */
function estadoDeFila(suyos: Problema[]): { etiqueta: string; clase: string } {
  if (suyos.some((p) => p.gravedad === "error")) {
    return { etiqueta: "con errores", clase: "bg-red-400" };
  }
  if (suyos.length) {
    return { etiqueta: "con avisos", clase: "bg-amber-300" };
  }
  return { etiqueta: "correcta", clase: "bg-emerald-400" };
}

/** La línea de arriba: sin habilidades, todo en regla, o cuántos errores y avisos hay. */
function ResumenDelKit({
  total,
  errores,
  avisos,
}: Readonly<{ total: number; errores: number; avisos: number }>) {
  if (total === 0) {
    return (
      <span className="text-dex-muted">
        Esta ficha aún no tiene habilidades.
      </span>
    );
  }
  if (errores === 0 && avisos === 0) {
    return (
      <span className="text-emerald-300">
        ✓ El kit cumple todas las reglas que se pueden comprobar.
      </span>
    );
  }
  return (
    <span>
      {errores > 0 && (
        <span className="text-red-300">
          {errores === 1 ? "1 error" : `${errores} errores`}
        </span>
      )}
      {errores > 0 && avisos > 0 && <span className="text-dex-muted"> · </span>}
      {avisos > 0 && (
        <span className="text-amber-200">
          {avisos === 1 ? "1 aviso" : `${avisos} avisos`}
        </span>
      )}
      <span className="text-dex-muted">
        {" "}
        — abre cada habilidad para ver el detalle.
      </span>
    </span>
  );
}

/** Lo que se edita a mano de una habilidad (nombre, categoría, tipo, sección y efecto). */
function EdicionAMano({
  s,
  i,
  actualizar,
}: Readonly<{
  s: SkillForm;
  i: number;
  actualizar: (i: number, parche: Partial<SkillForm>) => void;
}>) {
  return (
    <details className="rounded-lg border border-dex-line/70 p-2">
      <summary className="cursor-pointer text-xs text-dex-muted">
        Editar a mano
      </summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className={`${labelClass} sm:col-span-2`}>
          Nombre{" "}
          <input
            value={s.name}
            onChange={(e) => actualizar(i, { name: e.target.value })}
            className={compact}
          />
        </label>
        <label className={labelClass}>
          Categoría{" "}
          <select
            value={s.category}
            onChange={(e) =>
              actualizar(i, {
                category: e.target.value as SkillForm["category"],
              })
            }
            className={compact}
          >
            <option value="active">Activa</option>
            <option value="passive">Pasiva</option>
            <option value="ultimate">Ultimate</option>
            <option value="other">Otra</option>
          </select>
        </label>
        <label className={labelClass}>
          Tipo{" "}
          <input
            value={s.type}
            onChange={(e) => actualizar(i, { type: e.target.value })}
            className={compact}
          />
        </label>
        <label className={`${labelClass} sm:col-span-2`}>
          Sección{" "}
          <input
            value={s.section}
            onChange={(e) => actualizar(i, { section: e.target.value })}
            className={compact}
          />
        </label>
        <label className={`${labelClass} sm:col-span-3`}>
          Efecto
          {/* Reescribir el texto suelta el HTML de ESTA habilidad: el HTML ya no lo describiría. */}
          <textarea
            rows={4}
            value={s.effect}
            onChange={(e) =>
              actualizar(i, {
                effect: e.target.value,
                effectHtml: null,
              })
            }
            className={compact}
          />
          {s.effectHtml && (
            <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
              Si editas este texto, esta habilidad pierde los colores de los
              estados. Para cambiarla sin perderlos, rehaz el kit con el
              asistente.
            </span>
          )}
        </label>
      </div>
    </details>
  );
}

function FilaDeHabilidad({
  s,
  i,
  posicion,
  problemas,
  abierta,
  onAlternar,
  actualizar,
  onQuitar,
}: Readonly<{
  s: SkillForm;
  i: number;
  /** Posición dentro de su categoría: «Activa 2» es la segunda activa, esté donde esté en la lista. */
  posicion: number;
  problemas: Problema[];
  abierta: boolean;
  onAlternar: (i: number) => void;
  actualizar: (i: number, parche: Partial<SkillForm>) => void;
  onQuitar: (i: number) => void;
}>) {
  const pieza = piezaDe(s.category, posicion);
  const suyos = pieza
    ? problemas.filter((p) => p.pieza.split(", ").includes(pieza))
    : [];
  const estado = estadoDeFila(suyos);
  const mp = mpDe(s.category, posicion);
  return (
    <li
      className="rounded-xl border border-dex-line bg-dex-void/40"
      data-testid="skill-row"
    >
      <button
        type="button"
        aria-expanded={abierta}
        onClick={() => onAlternar(i)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <span
          aria-label={estado.etiqueta}
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${estado.clase}`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-dex-ink">
            {s.name || "Sin nombre"}
          </span>
          <span className="block truncate text-[11px] text-dex-muted">
            {[pieza || null, s.type || null].filter(Boolean).join(" · ")}
          </span>
        </span>
        {mp && (
          <span className="shrink-0 font-mono text-[11px] text-dex-muted">
            MP {mp}
          </span>
        )}
        <span
          aria-hidden
          className={`text-dex-muted transition-transform ${abierta ? "rotate-180" : ""}`}
        >
          ▾
        </span>
      </button>
      {abierta && (
        <div className="space-y-3 border-t border-dex-line/70 px-3 py-3">
          {/* El HTML viene del asistente (escapado) o del scrape, y el servidor solo acepta su lista blanca. */}
          <div
            className="text-sm leading-relaxed text-dex-ink/85"
            dangerouslySetInnerHTML={{ __html: htmlDeEfecto(s) }}
          />
          {suyos.length > 0 && <ListaDeProblemas problemas={suyos} />}
          <EdicionAMano s={s} i={i} actualizar={actualizar} />
          <div className="flex justify-end">
            <button
              type="button"
              className={`${ghostButton} hover:!text-red-300`}
              onClick={() => onQuitar(i)}
            >
              Quitar habilidad
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function SkillsStep({ form, set, factions }: Readonly<StepProps>) {
  const [asistente, setAsistente] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const skills = form.skills;
  /**
   * Subfacción → madre, desde el catálogo (`faction.parent_id`). Sin esto, una ficha con una
   * subfacción veía bloqueados los estados exclusivos de su madre.
   */
  const subfacciones = useMemo(
    () => mapaSubfacciones(factions ?? []),
    [factions],
  );

  const problemas: Problema[] = useMemo(() => {
    const kit = skills.filter((s) => s.category !== "other");
    if (!kit.length) {
      return [];
    }
    return validarKit({
      habilidades: kit.map((s) => ({
        category: s.category as "active" | "passive" | "ultimate",
        name: s.name,
        effectHtml: s.effectHtml ?? s.effect,
      })),
      // Sin facciones no se sabe nada de la exclusividad: no se acusa a ciegas (igual que el informe).
      facciones: form.factions.length ? form.factions : null,
      // La subfacción acredita los estados de su madre: el mapa viene del catálogo (faction.parent_id).
      subfacciones,
    });
  }, [skills, form.factions, subfacciones]);
  const errores = problemas.filter((p) => p.gravedad === "error").length;
  const avisos = problemas.length - errores;
  const delKit = problemas.filter((p) => p.pieza === "Kit");

  /*
   * Los manejadores que bajan al asistente y a cada fila van en `useCallback` (el paso ya memoiza
   * los problemas): las filas reciben siempre la misma función y la fila va por índice.
   */
  const cerrarAsistente = useCallback(() => setAsistente(false), []);
  const aplicarKit = useCallback(
    (next: SkillForm[]) => {
      set("skills", next);
      setAsistente(false);
      setAbierta(null);
      setAviso("Kit puesto en la ficha. Guarda los cambios para publicarlo.");
    },
    [set],
  );
  const actualizar = useCallback(
    (i: number, parche: Partial<SkillForm>) =>
      set(
        "skills",
        skills.map((s, j) => (j === i ? { ...s, ...parche } : s)),
      ),
    [set, skills],
  );
  const alternar = useCallback(
    (i: number) => setAbierta((actual) => (actual === i ? null : i)),
    [],
  );
  const quitar = useCallback(
    (i: number) => {
      set(
        "skills",
        skills.filter((_, j) => j !== i),
      );
      setAbierta(null);
    },
    [set, skills],
  );

  if (asistente) {
    return (
      <KitBuilder
        skills={skills}
        facciones={form.factions}
        subfacciones={subfacciones}
        onCancel={cerrarAsistente}
        onApply={aplicarKit}
      />
    );
  }

  /** Posición de cada habilidad dentro de su categoría: «Activa 2» es la segunda activa, esté donde esté en la lista. */
  const posiciones = skills.map(
    (s, i) =>
      skills.slice(0, i).filter((x) => x.category === s.category).length,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dex-line bg-black/20 px-4 py-3">
        <div className="text-sm" data-testid="kit-resumen">
          <ResumenDelKit
            total={skills.length}
            errores={errores}
            avisos={avisos}
          />
        </div>
        <button
          type="button"
          className={primaryButton}
          onClick={() => {
            setAviso(null);
            setAsistente(true);
          }}
        >
          {skills.some((s) => s.category !== "other")
            ? "Rehacer el kit con el asistente"
            : "Armar el kit con el asistente"}
        </button>
      </div>
      {aviso && <p className="text-xs text-emerald-300">{aviso}</p>}
      {delKit.length > 0 && <ListaDeProblemas problemas={delKit} />}

      {GRUPOS.map((g) => {
        const filas = skills
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s.category === g.category);
        if (!filas.length) {
          return null;
        }
        return (
          <section key={g.category} className="space-y-1.5">
            <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">
              {g.titulo}
            </h4>
            <ul className="space-y-1.5">
              {filas.map(({ s, i }) => (
                <FilaDeHabilidad
                  key={i}
                  s={s}
                  i={i}
                  posicion={posiciones[i]}
                  problemas={problemas}
                  abierta={abierta === i}
                  onAlternar={alternar}
                  actualizar={actualizar}
                  onQuitar={quitar}
                />
              ))}
            </ul>
          </section>
        );
      })}

      <button
        type="button"
        className={ghostButton}
        disabled={skills.length >= 30}
        onClick={() => {
          set("skills", [...skills, { ...emptySkill(), category: "other" }]);
          setAbierta(skills.length);
        }}
      >
        + Agregar una habilidad a mano
      </button>
    </div>
  );
}
