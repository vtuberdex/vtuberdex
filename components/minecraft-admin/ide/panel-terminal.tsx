// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Terminal de la pestaña «Archivos» (abajo, como en VS Code): pestañas de sesiones bash sobre la
 * carpeta del servidor. Cada sesión vive en el agente, así que recargar la página no la mata: al
 * volver se reengancha y repinta lo último (hasta 256 KB).
 *
 * Salida por Server-Sent Events (`/api/minecraft-admin/terminal/[id]`, bytes en base64); entrada
 * por POST agrupando lo tecleado cada ~15 ms y en orden (una petición detrás de otra).
 */
import "@xterm/xterm/css/xterm.css";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  abrirTerminal,
  cerrarTerminal,
  escribirEnTerminal,
  listarTerminales,
  redimensionarTerminal,
  urlDeSalida,
  type Terminal as TerminalInfo,
} from "./api";

type Props = {
  /** Comando que el explorador pide escribir (p. ej. `cd 'plugins/X'`), con un contador para repetirlo. */
  pedido: { texto: string; n: number } | null;
  alError: (mensaje: string) => void;
};

const TEMA = {
  background: "#0b0d12",
  foreground: "#d6deeb",
  cursor: "#7fdbca",
  selectionBackground: "#1d3b53",
  black: "#011627",
  red: "#ef5350",
  green: "#22da6e",
  yellow: "#addb67",
  blue: "#82aaff",
  magenta: "#c792ea",
  cyan: "#21c7a8",
  white: "#d6deeb",
  brightBlack: "#575656",
  brightRed: "#ef5350",
  brightGreen: "#22da6e",
  brightYellow: "#ffeb95",
  brightBlue: "#82aaff",
  brightMagenta: "#c792ea",
  brightCyan: "#7fdbca",
  brightWhite: "#ffffff",
};

function Sesion({
  id,
  visible,
  pedido,
  alTerminar,
  alError,
}: {
  id: string;
  visible: boolean;
  pedido: Props["pedido"];
  alTerminar: () => void;
  alError: (m: string) => void;
}) {
  const caja = useRef<HTMLDivElement>(null);
  // Hasta que xterm carga, lo pedido se encola y se manda al estar lista.
  const cola = useRef("");
  const escribir = useRef<(texto: string) => void>((texto) => {
    cola.current += texto;
  });
  const ajustar = useRef<() => void>(() => {});
  const alTerminarRef = useRef(alTerminar);
  const alErrorRef = useRef(alError);
  alTerminarRef.current = alTerminar;
  alErrorRef.current = alError;

  useEffect(() => {
    let vivo = true;
    let limpiar = () => {};
    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (!vivo || !caja.current) {return;}
      const term = new Terminal({
        theme: TEMA,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        allowProposedApi: false,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(caja.current);

      // Entrada: se agrupa y se manda en orden.
      let pendiente = "";
      let enviando = false;
      let temporizador: ReturnType<typeof setTimeout> | null = null;
      const vaciar = async () => {
        if (enviando || !pendiente) {return;}
        enviando = true;
        const lote = pendiente;
        pendiente = "";
        try {
          await escribirEnTerminal(id, lote);
        } catch (e) {
          alErrorRef.current(e instanceof Error ? e.message : "no se pudo escribir");
        } finally {
          enviando = false;
          if (pendiente) {void vaciar();}
        }
      };
      escribir.current = (texto: string) => {
        pendiente += texto;
        if (!temporizador) {
          temporizador = setTimeout(() => {
            temporizador = null;
            void vaciar();
          }, 15);
        }
      };
      const datos = term.onData((d) => escribir.current(d));
      if (cola.current) {
        escribir.current(cola.current);
        cola.current = "";
      }

      // Tamaño.
      let ultimo = "";
      let tamTemporizador: ReturnType<typeof setTimeout> | null = null;
      ajustar.current = () => {
        if (!caja.current || caja.current.offsetParent === null) {return;}
        try {
          fit.fit();
        } catch {
          return;
        }
        const clave = `${term.rows}x${term.cols}`;
        if (clave === ultimo) {return;}
        ultimo = clave;
        if (tamTemporizador) {clearTimeout(tamTemporizador);}
        tamTemporizador = setTimeout(() => void redimensionarTerminal(id, term.rows, term.cols), 120);
      };
      const observador = new ResizeObserver(() => ajustar.current());
      observador.observe(caja.current);
      ajustar.current();

      // Salida.
      let abiertaAntes = false;
      const fuente = new EventSource(urlDeSalida(id));
      fuente.onopen = () => {
        // Al reconectar el agente repite lo guardado: se limpia para no verlo dos veces.
        if (abiertaAntes) {term.reset();}
        abiertaAntes = true;
      };
      fuente.onmessage = (ev) => {
        const binario = atob(ev.data);
        const bytes = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i += 1) {bytes[i] = binario.charCodeAt(i);}
        term.write(bytes);
      };
      fuente.addEventListener("fin", () => {
        fuente.close();
        alTerminarRef.current();
      });
      fuente.onerror = () => {
        if (fuente.readyState === EventSource.CLOSED) {alTerminarRef.current();}
      };

      limpiar = () => {
        fuente.close();
        observador.disconnect();
        datos.dispose();
        if (temporizador) {clearTimeout(temporizador);}
        term.dispose();
      };
    })();
    return () => {
      vivo = false;
      limpiar();
    };
  }, [id]);

  useEffect(() => {
    if (visible) {requestAnimationFrame(() => ajustar.current());}
  }, [visible]);

  useEffect(() => {
    if (visible && pedido) {escribir.current(pedido.texto);}
  }, [pedido, visible]);

  return <div ref={caja} className={`h-full w-full px-2 pt-1 ${visible ? "" : "hidden"}`} />;
}

export function PanelTerminal({ pedido, alError }: Props) {
  const [sesiones, setSesiones] = useState<(TerminalInfo & { fin?: boolean })[]>([]);
  const [activa, setActiva] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [pedidoActivo, setPedidoActivo] = useState<Props["pedido"]>(null);

  const nueva = useCallback(async () => {
    try {
      const t = await abrirTerminal(30, 120, `bash ${Date.now() % 1000}`);
      setSesiones((s) => [...s, t]);
      setActiva(t.id);
      return t.id;
    } catch (e) {
      alError(e instanceof Error ? e.message : "no se pudo abrir la terminal");
      return null;
    }
  }, [alError]);

  useEffect(() => {
    void (async () => {
      try {
        const abiertas = (await listarTerminales()).filter((t) => !t.terminada);
        setSesiones(abiertas);
        setActiva(abiertas.at(-1)?.id ?? null);
        if (!abiertas.length) {await nueva();}
      } catch (e) {
        alError(e instanceof Error ? e.message : "no se pudo listar las terminales");
      } finally {
        setCargando(false);
      }
    })();
    // Solo al montar: `nueva` y `alError` son estables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Un pedido del explorador va a la terminal activa (o abre una).
  useEffect(() => {
    if (!pedido) {return;}
    if (activa && !sesiones.find((s) => s.id === activa)?.fin) {
      setPedidoActivo(pedido);
    } else {
      void nueva().then((id) => id && setPedidoActivo(pedido));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedido]);

  const cerrar = async (id: string) => {
    await cerrarTerminal(id);
    setSesiones((s) => {
      const resto = s.filter((x) => x.id !== id);
      if (activa === id) {setActiva(resto.at(-1)?.id ?? null);}
      return resto;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b0d12]">
      <div className="flex items-center gap-1 border-b border-dex-line/60 px-2 text-xs">
        <span className="mr-2 py-1.5 font-bold uppercase tracking-wide text-dex-muted">Terminal</span>
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto">
          {sesiones.map((s, i) => (
            <div
              key={s.id}
              className={`group flex items-center gap-1 rounded-md px-2 py-1 ${
                s.id === activa ? "bg-dex-panel-soft text-dex-ink" : "text-dex-muted hover:text-dex-ink"
              }`}
            >
              <button type="button" onClick={() => setActiva(s.id)} className="whitespace-nowrap">
                {s.fin ? "✕ " : "❯ "}bash {i + 1}
              </button>
              <button
                type="button"
                aria-label={`Cerrar terminal ${i + 1}`}
                onClick={() => void cerrar(s.id)}
                className="opacity-60 hover:text-red-400 hover:opacity-100"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void nueva()}
          className="rounded-md px-2 py-1 text-dex-muted hover:bg-dex-panel-soft hover:text-dex-ink"
          title="Nueva terminal"
        >
          + Nueva
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        {cargando ? <p className="p-3 text-xs text-dex-muted">Abriendo terminal…</p> : null}
        {!cargando && !sesiones.length ? (
          <p className="p-3 text-xs text-dex-muted">Sin terminales. Pulsa «+ Nueva».</p>
        ) : null}
        {sesiones.map((s) => (
          <div key={s.id} className={s.id === activa ? "absolute inset-0" : "hidden"}>
            <Sesion
              id={s.id}
              visible={s.id === activa}
              pedido={s.id === activa ? pedidoActivo : null}
              alError={alError}
              alTerminar={() =>
                setSesiones((todas) => todas.map((x) => (x.id === s.id ? { ...x, fin: true } : x)))
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
