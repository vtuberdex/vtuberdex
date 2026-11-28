// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Consola del servidor de Minecraft, como pestaña fija del panel de abajo de «Archivos» (junto a las
 * terminales bash). Arriba, el registro del servidor (`logs/latest.log`) en vivo; abajo, un campo para
 * mandar comandos por RCON (`/api/minecraft-admin/consola`: el admin cualquiera, el mantenedor los de
 * la lista blanca; todo queda en la auditoría). La respuesta de cada comando se intercala en la salida.
 *
 * El registro se pide cada `CADA_MS` mientras la pestaña está a la vista y solo se añaden las líneas
 * nuevas (`lineasNuevas`), así que lo que ya se leyó no se repinta ni salta.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { colaDelServidor, comandoDelServidor } from "./api";

export const CADA_MS = 2000;
const MAXIMO_LINEAS = 2000;
const COLA = 300;

export type LineaConsola = {
  id: number;
  texto: string;
  tipo: "registro" | "comando" | "respuesta" | "error" | "aviso";
};

/**
 * Las líneas de `cola` (lo último del registro) que no estaban en `previas`. Las dos son ventanas del
 * final del mismo archivo: lo ya visto termina donde empieza lo nuevo, así que se busca el solape MÁS
 * LARGO entre el final de `previas` y el principio de `cola` (el más largo, para que una línea repetida
 * no corte antes de tiempo). Sin solape (registro rotado, servidor reiniciado o más de una ventana de
 * líneas nuevas entre dos lecturas), todo es nuevo.
 */
export function lineasNuevas(previas: readonly string[], cola: readonly string[]): string[] {
  for (let k = Math.min(previas.length, cola.length); k > 0; k--) {
    let coincide = true;
    for (let i = 0; i < k; i++) {
      if (cola[i] !== previas[previas.length - k + i]) {
        coincide = false;
        break;
      }
    }
    if (coincide) {
      return cola.slice(k);
    }
  }
  return [...cola];
}

const COLOR: Record<LineaConsola["tipo"], string> = {
  registro: "text-dex-ink/85",
  comando: "text-dex-accent",
  respuesta: "text-[#addb67]",
  error: "text-red-400",
  aviso: "text-dex-muted",
};

/** WARN y ERROR del registro, con el color de siempre en una consola. */
function colorDeRegistro(texto: string) {
  if (/\b(ERROR|SEVERE)\]/.test(texto)) {
    return "text-red-400";
  }
  if (/\bWARN(ING)?\]/.test(texto)) {
    return "text-[#ffeb95]";
  }
  return COLOR.registro;
}

export function ConsolaServidor({ visible }: Readonly<{ visible: boolean }>) {
  const [lineas, setLineas] = useState<LineaConsola[]>([]);
  const [comando, setComando] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sinRegistro, setSinRegistro] = useState<string | null>(null);
  const vistas = useRef<string[]>([]);
  const siguiente = useRef(0);
  const caja = useRef<HTMLDivElement>(null);
  const alFondo = useRef(true);
  const historial = useRef<string[]>([]);
  const posicion = useRef(-1);

  const agregar = useCallback((nuevas: Omit<LineaConsola, "id">[]) => {
    if (!nuevas.length) {
      return;
    }
    setLineas((l) => {
      const con = nuevas.map((n) => {
        const id = siguiente.current;
        siguiente.current += 1;
        return { ...n, id };
      });
      return [...l, ...con].slice(-MAXIMO_LINEAS);
    });
  }, []);

  const leerRegistro = useCallback(async () => {
    try {
      const cola = await colaDelServidor(COLA);
      const nuevas = lineasNuevas(vistas.current, cola);
      const reinicio = vistas.current.length > 0 && nuevas.length === cola.length && cola.length > 0;
      vistas.current = cola;
      setSinRegistro(null);
      agregar([
        ...(reinicio ? [{ texto: "── el registro empezó de nuevo (o se saltaron líneas) ──", tipo: "aviso" as const }] : []),
        ...nuevas.map((texto) => ({ texto, tipo: "registro" as const })),
      ]);
    } catch (e) {
      setSinRegistro(e instanceof Error ? e.message : "no se pudo leer el registro");
    }
  }, [agregar]);

  // Sondeo mientras se ve (y la pestaña del navegador está a la vista).
  useEffect(() => {
    if (!visible) {
      return;
    }
    void leerRegistro();
    const reloj = setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void leerRegistro();
      }
    }, CADA_MS);
    return () => clearInterval(reloj);
  }, [visible, leerRegistro]);

  // Baja sola al final, salvo que la persona haya subido a leer algo.
  useEffect(() => {
    const c = caja.current;
    if (c && alFondo.current) {
      c.scrollTop = c.scrollHeight;
    }
  }, [lineas]);

  const alDesplazar = () => {
    const c = caja.current;
    if (c) {
      alFondo.current = c.scrollHeight - c.scrollTop - c.clientHeight < 24;
    }
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const texto = comando.trim().replace(/^\//, "");
    if (!texto || enviando) {
      return;
    }
    setEnviando(true);
    alFondo.current = true;
    historial.current = [texto, ...historial.current.filter((h) => h !== texto)].slice(0, 50);
    posicion.current = -1;
    setComando("");
    agregar([{ texto: `> ${texto}`, tipo: "comando" }]);
    try {
      const respuesta = (await comandoDelServidor(texto)).trim();
      agregar(
        (respuesta || "(sin respuesta)").split("\n").map((t) => ({ texto: t, tipo: "respuesta" as const })),
      );
    } catch (e) {
      agregar([{ texto: e instanceof Error ? e.message : "no se pudo enviar el comando", tipo: "error" }]);
    } finally {
      setEnviando(false);
      void leerRegistro();
    }
  };

  const teclas = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setLineas([]);
      return;
    }
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
      return;
    }
    e.preventDefault();
    const h = historial.current;
    posicion.current =
      e.key === "ArrowUp" ? Math.min(posicion.current + 1, h.length - 1) : Math.max(posicion.current - 1, -1);
    setComando(posicion.current >= 0 ? h[posicion.current] : "");
  };

  return (
    <div className={`flex h-full min-h-0 flex-col ${visible ? "" : "hidden"}`}>
      <div
        ref={caja}
        onScroll={alDesplazar}
        role="log"
        aria-label="Consola del servidor"
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words px-3 py-1 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[12px] leading-snug"
      >
        {sinRegistro ? <p className="text-red-400">{sinRegistro}</p> : null}
        {!lineas.length && !sinRegistro ? <p className="text-dex-muted">Leyendo el registro del servidor…</p> : null}
        {lineas.map((l) => (
          <div key={l.id} className={l.tipo === "registro" ? colorDeRegistro(l.texto) : COLOR[l.tipo]}>
            {l.texto || " "}
          </div>
        ))}
      </div>
      <form onSubmit={(e) => void enviar(e)} className="flex items-center gap-2 border-t border-dex-line/60 px-2 py-1">
        <span className="font-mono text-dex-accent">&gt;</span>
        <input
          type="text"
          value={comando}
          onChange={(e) => setComando(e.target.value)}
          onKeyDown={teclas}
          maxLength={256}
          autoComplete="off"
          spellCheck={false}
          placeholder="Comando del servidor (sin barra): list, say hola, mm reload… ↑/↓ historial, Ctrl+L limpia"
          aria-label="Comando del servidor"
          className="min-w-0 flex-1 bg-transparent py-1 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-[12px] text-dex-ink outline-none placeholder:text-dex-muted/70"
        />
        <button
          type="submit"
          disabled={enviando || !comando.trim()}
          className="rounded-md px-2 py-1 text-xs text-dex-muted hover:bg-dex-panel-soft hover:text-dex-ink disabled:opacity-40"
        >
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}
