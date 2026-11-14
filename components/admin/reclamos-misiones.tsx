// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Grados que la gente reclamó con misiones de Minecraft. El mantenedor puede revisarlos y REVOCAR uno (por ejemplo si se
 * sospecha de un abuso): la carta vuelve al grado que tenía antes, salvo que ya lleve otro (una donación la subió después).
 * Revocar pide confirmación: cambia la carta pública.
 */
import { useCallback, useEffect, useState } from "react";

import { ApiError, api, type ReclamoDeMision } from "@/lib/api";

const NOMBRE = (g: string | null) => (g === null ? "carta normal" : `grado ${g}`);

/** Revocado, pidiendo confirmación, o el botón «Revocar». */
function AccionDeReclamo({
  r,
  confirmando,
  ocupado,
  onRevocar,
  onConfirmar,
}: Readonly<{
  r: ReclamoDeMision;
  confirmando: boolean;
  ocupado: boolean;
  onRevocar: (r: ReclamoDeMision) => Promise<void>;
  /** Clave del reclamo que se está confirmando, o `null` para cancelar. */
  onConfirmar: (clave: string | null) => void;
}>) {
  if (r.revocado) {
    return <p className="mt-1 text-xs text-dex-muted">Revocado el {new Date(r.revocado).toLocaleDateString("es-CL")}.</p>;
  }
  if (!confirmando) {
    return (
      <button
        type="button"
        onClick={() => onConfirmar(`${r.vtuberId}:${r.misionId}`)}
        className="mt-2 rounded-lg border border-dex-line px-3 py-1 text-xs text-dex-muted hover:text-dex-ink"
      >
        Revocar
      </button>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-dex-ink/85">
        ¿Devolver la carta a {NOMBRE(r.gradoPrevio)}? No podrá volver a reclamar esta misión.
      </span>
      <button
        type="button"
        disabled={ocupado}
        onClick={() => void onRevocar(r)}
        className="rounded-lg border border-red-500/60 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
      >
        Sí, revocar
      </button>
      <button
        type="button"
        onClick={() => onConfirmar(null)}
        className="rounded-lg border border-dex-line px-3 py-1 text-xs text-dex-muted hover:text-dex-ink"
      >
        Cancelar
      </button>
    </div>
  );
}

export function ReclamosMisiones({
  token,
  notify,
  onChanged,
}: Readonly<{
  token: string;
  notify: (tipo: "ok" | "error", texto: string) => void;
  onChanged?: () => void;
}>) {
  const [items, setItems] = useState<ReclamoDeMision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setItems((await api.reclamosDeMisiones(token)).items);
      setError(null);
    } catch (error_) {
      setError(error_ instanceof ApiError ? error_.message : "No se pudieron leer los reclamos.");
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const revocar = useCallback(async (r: ReclamoDeMision) => {
    setOcupado(true);
    try {
      const res = await api.revocarReclamoDeMision(token, r.vtuberId, r.misionId);
      notify(
        "ok",
        res.cartaModificada
          ? `Reclamo revocado: ${r.name} vuelve a ${NOMBRE(r.gradoPrevio)}.`
          : `Reclamo revocado. La carta de ${r.name} ya llevaba otro grado y no se tocó.`,
      );
      setConfirmar(null);
      await cargar();
      onChanged?.();
    } catch (error_) {
      notify("error", error_ instanceof ApiError ? error_.message : "No se pudo revocar.");
    } finally {
      setOcupado(false);
    }
  }, [token, notify, cargar, onChanged]);

  return (
    <section
      className="mt-6 space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="reclamos-misiones"
    >
      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
        Grados reclamados con misiones
      </h3>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {items?.length === 0 && (
        <p className="text-sm text-dex-muted">Nadie ha reclamado un grado con misiones todavía.</p>
      )}
      <ul className="space-y-2">
        {(items ?? []).map((r) => {
          const clave = `${r.vtuberId}:${r.misionId}`;
          return (
            <li key={clave} className="rounded-xl border border-dex-line p-3 text-sm" data-testid={`reclamo-${clave}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-dex-ink">
                  {r.name} <span className="font-normal text-dex-muted">· {r.mision}</span>
                </span>
                <span className="font-mono text-xs text-dex-muted">
                  {new Date(r.reclamado).toLocaleDateString("es-CL")}
                </span>
              </div>
              <p className="text-xs text-dex-muted">
                Reclamó {NOMBRE(r.grado)} (antes: {NOMBRE(r.gradoPrevio)}; hoy: {NOMBRE(r.gradoActual)}).
              </p>
              <AccionDeReclamo
                r={r}
                confirmando={confirmar === clave}
                ocupado={ocupado}
                onRevocar={revocar}
                onConfirmar={setConfirmar}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default ReclamosMisiones;
