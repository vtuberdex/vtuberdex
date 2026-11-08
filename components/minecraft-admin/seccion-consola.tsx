"use client";

/**
 * Consola RCON del panel. El admin escribe cualquier comando; el mantenedor solo los de la lista
 * blanca del servidor (`lib/minecraft-consola.mjs`). Aquí no se filtra nada: el servidor decide y
 * esta pantalla solo muestra su respuesta. Cada comando queda en la auditoría.
 */
import { useRef, useState } from "react";

import { CLASE_BOTON, CLASE_CAMPO_MONO, FUENTE_MONO, Seccion } from "./ui";

type Linea = { comando: string; salida: string; ok: boolean };

export function SeccionConsola({ esAdmin }: { esAdmin: boolean }) {
  const [comando, setComando] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [ocupado, setOcupado] = useState(false);
  const historial = useRef<string[]>([]);
  const posicion = useRef(-1);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const texto = comando.trim();
    if (!texto || ocupado) return;
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/consola", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ comando: texto }),
      });
      const c = (await r.json().catch(() => null)) as {
        respuesta?: string;
        error?: string;
        detail?: string;
      } | null;
      const salida = r.ok
        ? c?.respuesta?.trim() || "(sin respuesta)"
        : [c?.error ?? `error ${r.status}`, c?.detail]
            .filter(Boolean)
            .join(": ");
      setLineas((l) => [
        ...l.slice(-199),
        { comando: texto, salida, ok: r.ok },
      ]);
      historial.current = [texto, ...historial.current.slice(0, 49)];
      posicion.current = -1;
      setComando("");
    } finally {
      setOcupado(false);
    }
  };

  const teclas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const h = historial.current;
    posicion.current =
      e.key === "ArrowUp"
        ? Math.min(posicion.current + 1, h.length - 1)
        : Math.max(posicion.current - 1, -1);
    setComando(posicion.current >= 0 ? h[posicion.current] : "");
  };

  return (
    <Seccion
      titulo="Consola"
      bajada={
        esAdmin
          ? "Cualquier comando, como en la consola del servidor. Todo queda en la auditoría."
          : "Comandos de mantenimiento (mm, reload, whitelist, say…). Lo demás es solo de admin. Todo queda en la auditoría."
      }
    >
      <pre
        aria-label="Salida de la consola"
        className={`max-h-[28rem] min-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-dex-line bg-dex-void p-3 text-xs leading-relaxed text-dex-accent ${FUENTE_MONO}`}
      >
        {lineas.length === 0
          ? "Escribe un comando (sin barra). ↑/↓ recorre el historial."
          : lineas.map((l, n) => (
              <span key={n} className={l.ok ? "" : "text-red-400"}>
                {`> ${l.comando}\n${l.salida}\n`}
              </span>
            ))}
      </pre>
      <form onSubmit={enviar} className="flex gap-2">
        <input
          type="text"
          value={comando}
          onChange={(e) => setComando(e.target.value)}
          onKeyDown={teclas}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          placeholder="mm reload"
          aria-label="Comando"
          className={CLASE_CAMPO_MONO}
        />
        <button
          type="submit"
          disabled={ocupado}
          className={CLASE_BOTON.primario}
        >
          Enviar
        </button>
      </form>
    </Seccion>
  );
}
