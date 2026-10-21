"use client";
/**
 * Grados que la gente reclamó con misiones de Minecraft. El mantenedor puede revisarlos y REVOCAR uno (por ejemplo si se
 * sospecha de un abuso): la carta vuelve al grado que tenía antes, salvo que ya lleve otro (una donación la subió después).
 * Revocar pide confirmación: cambia la carta pública.
 */
import { useCallback, useEffect, useState } from "react";

import { ApiError, api, type ReclamoDeMision } from "@/lib/api";

const NOMBRE = (g: string | null) => (g === null ? "carta normal" : `grado ${g}`);

export function ReclamosMisiones({
  token,
  notify,
  onChanged,
}: {
  token: string;
  notify: (tipo: "ok" | "error", texto: string) => void;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<ReclamoDeMision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    try {
      setItems((await api.reclamosDeMisiones(token)).items);
      setError(null);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : "No se pudieron leer los reclamos.");
    }
  }, [token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const revocar = async (r: ReclamoDeMision) => {
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
    } catch (causa) {
      notify("error", causa instanceof ApiError ? causa.message : "No se pudo revocar.");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section
      className="mt-6 space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-5"
      data-testid="reclamos-misiones"
    >
      <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
        Grados reclamados con misiones
      </h3>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {items && items.length === 0 && (
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
              {r.revocado ? (
                <p className="mt-1 text-xs text-dex-muted">Revocado el {new Date(r.revocado).toLocaleDateString("es-CL")}.</p>
              ) : confirmar === clave ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-dex-ink/85">
                    ¿Devolver la carta a {NOMBRE(r.gradoPrevio)}? No podrá volver a reclamar esta misión.
                  </span>
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() => void revocar(r)}
                    className="rounded-lg border border-red-500/60 px-3 py-1 text-xs text-red-300 hover:bg-red-500/10"
                  >
                    Sí, revocar
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmar(null)}
                    className="rounded-lg border border-dex-line px-3 py-1 text-xs text-dex-muted hover:text-dex-ink"
                  >
                    Cancelar
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmar(clave)}
                  className="mt-2 rounded-lg border border-dex-line px-3 py-1 text-xs text-dex-muted hover:text-dex-ink"
                >
                  Revocar
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default ReclamosMisiones;
