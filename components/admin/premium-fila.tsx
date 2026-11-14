// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Una FILA de la lista de premium (`premium-manager.tsx`) con su panel «Más». Vive aparte del manager para que
 * cada decisión (qué botón se resalta, cuándo se puede bajar al 1, la confirmación de quitar) sea una función
 * con nombre en vez de un ternario más dentro de un JSX de 400 líneas. Los manejadores llegan por id
 * (`onAlternar(id)`, `onConfirmar(id, valor)`) para que el manager no cree una función nueva por fila.
 */
import { useState } from "react";

import {
  GRADOS,
  GRADOS_DEGRADADOS,
  GRADO_DE_BAJA,
  esGradoDegradado,
  gradoSiguiente,
  leyendaDePremium,
  mesesEntre,
  mismoMes,
  nombreDeGrado,
  textoDeRacha,
} from "@/lib/premium";
import type { PremiumGrade, VtuberCard } from "@/lib/types";
import { PremiumBadge } from "@/components/premium-badge";
import {
  Reason,
  ghostButton,
  inputClass,
  labelClass,
  primaryButton,
} from "@/components/admin/ui";

export type Guardar = (
  row: VtuberCard,
  premium: { grade: PremiumGrade } | null,
  okText: string,
) => Promise<void>;

export const dexTexto = (n: number) => `#${String(n).padStart(3, "0")}`;
/**
 * Columnas de la lista en pantallas anchas. La última es de ANCHO FIJO (no `auto`): con `auto` el encabezado y las
 * filas calculaban anchos distintos y los títulos quedaban desalineados de sus datos.
 */
export const COLUMNAS = "md:grid-cols-[3.5rem_minmax(0,1fr)_5rem_9rem_15rem]";

/** El aviso bajo la fecha del último cambio de grado; ninguno si la ficha está degradada. */
function avisoDeGrado(
  premium: NonNullable<VtuberCard["premium"]>,
  siguiente: ReturnType<typeof gradoSiguiente>,
): { texto: string; clase: string } | null {
  if (esGradoDegradado(premium.grade)) {
    return null;
  }
  if (siguiente === null) {
    return { texto: "grado máximo", clase: "text-dex-muted" };
  }
  if (mismoMes(premium.gradedAt)) {
    return { texto: "✓ subió este mes", clase: "text-emerald-300" };
  }
  return { texto: "por revisar", clase: "text-amber-200" };
}

/** Cuándo se cambió el grado por última vez y si toca revisarla este mes. */
function UltimoCambio({ row }: Readonly<{ row: VtuberCard }>) {
  const premium = row.premium;
  if (!premium) {
    return null;
  }
  const siguiente = gradoSiguiente(premium.grade);
  const aviso = avisoDeGrado(premium, siguiente);
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-mono text-xs text-dex-ink">{premium.gradedAt}</span>
      {aviso && (
        <span className={`text-[11px] ${aviso.clase}`}>{aviso.texto}</span>
      )}
    </span>
  );
}

/** Una carta ya degradada solo puede bajar al 1 (la baja), y no si ya está ahí. */
function LlevarAGradoDeBaja({
  row,
  busy,
  guardar,
}: Readonly<{ row: VtuberCard; busy: boolean; guardar: Guardar }>) {
  const yaEsBaja = row.premium?.grade === GRADO_DE_BAJA;
  return (
    <button
      type="button"
      className={ghostButton}
      disabled={busy || yaEsBaja}
      onClick={() =>
        guardar(
          row,
          { grade: GRADO_DE_BAJA },
          `${row.name} queda ilegible (grado ${GRADO_DE_BAJA}).`,
        )
      }
    >
      {yaEsBaja ? "Ya está en el grado 1" : "Llevar al grado 1 (baja)"}
    </button>
  );
}

const textoDeOpcionDeDeterioro = (item: PremiumGrade) =>
  item === GRADO_DE_BAJA
    ? "1 · ilegible (baja)"
    : `${item} · ${nombreDeGrado(item)}`;

/** Degradar una premium: se elige el grado y, si es el 1 (la baja), se confirma aparte. */
function Degradar({
  row,
  busy,
  guardar,
}: Readonly<{ row: VtuberCard; busy: boolean; guardar: Guardar }>) {
  // Arranca en el deterioro MÁS LEVE: el grado 1 (la baja) deja la ficha sin página pública y con el nombre oculto,
  // así que nunca debe ser el valor por defecto de un botón. Para el 1 se pide confirmación (ver abajo).
  const [gradoDeterioro, setGradoDeterioro] = useState<PremiumGrade>(
    GRADOS_DEGRADADOS[0],
  );
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const esBaja = gradoDeterioro === GRADO_DE_BAJA;
  const darDeBaja = () =>
    guardar(
      row,
      { grade: GRADO_DE_BAJA },
      `${row.name} queda ilegible (grado ${GRADO_DE_BAJA}).`,
    );
  const degradar = () => {
    if (esBaja) {
      setConfirmandoBaja(true);
      return;
    }
    void guardar(
      row,
      { grade: gradoDeterioro },
      `${row.name} queda degradada (${gradoDeterioro}).`,
    );
  };
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={`Grado de deterioro de ${row.name}`}
          value={gradoDeterioro}
          onChange={(event) => {
            setGradoDeterioro(event.target.value as PremiumGrade);
            setConfirmandoBaja(false);
          }}
          className={`${inputClass} !mt-0 w-auto`}
        >
          {GRADOS_DEGRADADOS.map((item) => (
            <option key={item} value={item}>
              {textoDeOpcionDeDeterioro(item)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={ghostButton}
          disabled={busy}
          onClick={degradar}
        >
          {esBaja ? "Dar de baja (grado 1)" : "Degradar"}
        </button>
      </div>
      {confirmandoBaja && (
        <span
          className="flex flex-wrap items-center gap-2 text-amber-200"
          data-testid="premium-confirmar-baja"
        >
          ¿Dar de baja a {row.name}? Su ficha dejará de tener página pública.
          <button
            type="button"
            className={ghostButton}
            disabled={busy}
            onClick={darDeBaja}
          >
            Sí, dar de baja
          </button>
          <button
            type="button"
            className={ghostButton}
            onClick={() => setConfirmandoBaja(false)}
          >
            No
          </button>
        </span>
      )}
    </>
  );
}

function QuitarPremium({
  row,
  busy,
  guardar,
  confirmando,
  onConfirmar,
}: Readonly<{
  row: VtuberCard;
  busy: boolean;
  guardar: Guardar;
  confirmando: boolean;
  onConfirmar: (id: number, valor: boolean) => void;
}>) {
  if (!confirmando) {
    return (
      <button
        type="button"
        className={`${ghostButton} block`}
        onClick={() => onConfirmar(row.id, true)}
      >
        Quitar premium
      </button>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-dex-muted">
      ¿Quitar el premium a {row.name}?
      <button
        type="button"
        className={ghostButton}
        disabled={busy}
        onClick={() => guardar(row, null, `${row.name} vuelve a carta normal.`)}
      >
        Sí, quitar
      </button>
      <button
        type="button"
        className={ghostButton}
        onClick={() => onConfirmar(row.id, false)}
      >
        No
      </button>
    </span>
  );
}

/** El panel «Más»: lo que no se usa cada mes. */
function PanelMas({
  row,
  busy,
  guardar,
  confirmando,
  onConfirmar,
}: Readonly<{
  row: VtuberCard;
  busy: boolean;
  guardar: Guardar;
  confirmando: boolean;
  onConfirmar: (id: number, valor: boolean) => void;
}>) {
  const premium = row.premium!;
  const degradada = esGradoDegradado(premium.grade);
  const siguiente = gradoSiguiente(premium.grade);

  return (
    <div
      className="grid gap-4 border-t border-dex-line/70 px-3 py-3 text-xs md:grid-cols-3"
      data-testid="premium-mas"
    >
      <div className="space-y-1 text-dex-muted">
        <p className="font-bold uppercase tracking-[0.14em]">Detalles</p>
        <p>
          Certificado{" "}
          <span className="font-mono text-dex-ink">{premium.cert}</span>
        </p>
        <p>
          {degradada ? "Degradada" : "Premium"} desde {premium.since} (
          {mesesEntre(premium.since)} meses)
        </p>
        <p>Último cambio de grado: {premium.gradedAt}</p>
        {siguiente && mismoMes(premium.gradedAt) && !degradada && (
          <div className="pt-1">
            <Reason>
              Ya cambió de grado este mes ({premium.gradedAt}): sube otra vez
              solo si de verdad corresponde.
            </Reason>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className={labelClass}>
          Fijar grado{" "}
          <select
            aria-label={`Grado de ${row.name}`}
            value={premium.grade}
            disabled={busy}
            onChange={(event) =>
              guardar(
                row,
                { grade: event.target.value as PremiumGrade },
                `${row.name}: grado ${event.target.value}.`,
              )
            }
            className={`${inputClass} w-32`}
          >
            <optgroup label="Deterioro">
              {GRADOS_DEGRADADOS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
            <optgroup label="Premium">
              {GRADOS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <p className="text-[11px] text-dex-muted">
          Para corregir un error o registrar a quien ya donaba.
        </p>
      </div>

      <div className="space-y-2">
        {degradada ? (
          <LlevarAGradoDeBaja row={row} busy={busy} guardar={guardar} />
        ) : (
          <Degradar row={row} busy={busy} guardar={guardar} />
        )}
        <QuitarPremium
          row={row}
          busy={busy}
          guardar={guardar}
          confirmando={confirmando}
          onConfirmar={onConfirmar}
        />
      </div>
    </div>
  );
}

/**
 * El botón relleno es para el TRABAJO PENDIENTE: solo lo lleva quien está por revisar este mes. Quien ya subió se ve
 * en contorno, y el grado máximo en gris: si todos los botones son iguales de llamativos, ninguno destaca.
 */
function claseDelBotonSubir(
  siguiente: PremiumGrade | null,
  gradedAt: string,
): string {
  if (!siguiente) {
    return `${ghostButton} !px-3`;
  }
  if (mismoMes(gradedAt)) {
    return "rounded-lg border border-dex-accent/40 px-3 py-1.5 text-xs font-semibold text-dex-accent hover:bg-dex-accent/10 disabled:opacity-50";
  }
  return `${primaryButton} !px-3 !py-1.5 !text-xs`;
}

function etiquetaDeSubir(siguiente: PremiumGrade | null): string {
  if (!siguiente) {
    return "Grado máximo";
  }
  return `Subir a ${siguiente === "BL" ? "Black Label" : siguiente}`;
}

/** El gesto mensual: subir medio punto (las degradadas no suben: las donaciones no arreglan una carta rota). */
function BotonSubir({
  row,
  busy,
  guardar,
}: Readonly<{ row: VtuberCard; busy: boolean; guardar: Guardar }>) {
  const premium = row.premium!;
  if (esGradoDegradado(premium.grade)) {
    return <span className="text-[11px] text-dex-muted">deteriorada</span>;
  }
  const siguiente = gradoSiguiente(premium.grade);
  const subir = () => {
    if (siguiente) {
      void guardar(
        row,
        { grade: siguiente },
        `${row.name} sube a ${leyendaDePremium({ grade: siguiente })}.`,
      );
    }
  };
  return (
    <button
      type="button"
      className={claseDelBotonSubir(siguiente, premium.gradedAt)}
      disabled={busy || siguiente === null}
      onClick={subir}
    >
      {etiquetaDeSubir(siguiente)}
    </button>
  );
}

function EtiquetaDeEstado({
  status,
}: Readonly<{ status: VtuberCard["status"] }>) {
  if (status === "published") {
    return null;
  }
  return (
    <span
      className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200"
      title="No se ve en el catálogo público"
    >
      {status === "draft" ? "borrador" : "oculto"}
    </span>
  );
}

export function Fila({
  row,
  abierta,
  onAlternar,
  busy,
  guardar,
  confirmando,
  onConfirmar,
}: Readonly<{
  row: VtuberCard;
  abierta: boolean;
  onAlternar: (id: number) => void;
  busy: boolean;
  guardar: Guardar;
  confirmando: boolean;
  onConfirmar: (id: number, valor: boolean) => void;
}>) {
  const premium = row.premium;
  if (!premium) {
    return null;
  }
  const racha = textoDeRacha(premium);

  return (
    <li
      data-testid="premium-row"
      className={`rounded-xl border bg-dex-panel/60 ${abierta ? "border-dex-accent/50" : "border-dex-line"}`}
    >
      {/*
        Móvil: DOS líneas (nombre y grado / estado y acciones). Escritorio: una fila de rejilla. Los `md:contents`
        hacen que los hijos de cada línea pasen a ser celdas de la rejilla grande.
      */}
      <div
        className={`flex flex-col gap-1.5 px-3 py-2.5 md:grid md:items-center md:gap-x-3 ${COLUMNAS}`}
      >
        <div className="flex min-w-0 items-center gap-2 md:contents">
          <span className="font-mono text-[11px] text-dex-muted">
            {dexTexto(row.dexNumber)}
          </span>
          <span className="flex min-w-0 flex-1 flex-col md:flex-none">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-bold text-dex-ink">
                {row.name}
              </span>
              <EtiquetaDeEstado status={row.status} />
            </span>
            {racha && (
              <span className="text-[11px] leading-tight text-dex-muted">
                {racha}
              </span>
            )}
          </span>
          <span className="shrink-0">
            <PremiumBadge premium={premium} compacto />
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 md:contents">
          <UltimoCambio row={row} />
          <span className="flex items-center justify-end gap-2">
            <BotonSubir row={row} busy={busy} guardar={guardar} />
            <button
              type="button"
              className={ghostButton}
              aria-expanded={abierta}
              aria-label={`Más opciones de ${row.name}`}
              onClick={() => onAlternar(row.id)}
            >
              Más {abierta ? "▴" : "▾"}
            </button>
          </span>
        </div>
      </div>
      {abierta && (
        <PanelMas
          row={row}
          busy={busy}
          guardar={guardar}
          confirmando={confirmando}
          onConfirmar={onConfirmar}
        />
      )}
    </li>
  );
}
