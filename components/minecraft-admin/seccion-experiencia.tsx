// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Pestaña «Experiencia» (solo admin): buscar una ficha, ver su nivel y darle o quitarle experiencia a mano.
 * Cada ajuste queda registrado con quién lo hizo y por qué, y se puede corregir con una cantidad negativa.
 */
import { useEffect, useState } from "react";

import {
  CLASE_BOTON,
  CLASE_CAMPO,
  CLASE_CAMPO_MONO,
  Pildora,
  Seccion,
} from "./ui";

type Resumen = { id: number; slug: string; name: string; dex: number };
type Vista = Resumen & {
  level: number;
  experience: { current: number; max: number; total: number };
  xpDeJuego: number;
  likes: number;
};
type Ajuste = {
  id: number;
  cantidad: number;
  motivo: string;
  actor: string;
  creado: string;
};

const ATAJOS = [50, 100, 500, 1000, -100];

const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  return c?.detail ?? c?.error ?? porDefecto;
};

export function SeccionExperiencia() {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<Resumen[]>([]);
  const [ficha, setFicha] = useState<Vista | null>(null);
  const [historial, setHistorial] = useState<Ajuste[]>([]);
  const [maximo, setMaximo] = useState(10000);
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // Búsqueda con un respiro al teclear: no se pregunta al servidor por cada letra.
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 2) {
      setResultados([]);
      return undefined;
    }
    const t = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/minecraft-admin/experiencia?q=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        if (!r.ok) {
          return;
        }
        const cuerpo = (await r.json()) as { fichas?: Resumen[] };
        setResultados(cuerpo.fichas ?? []);
      } catch {
        /* se reintenta al seguir escribiendo */
      }
    }, 250);
    return () => clearTimeout(t);
  }, [texto]);

  const abrir = async (id: number) => {
    setError(null);
    setAviso(null);
    const r = await fetch(`/api/minecraft-admin/experiencia?ficha=${id}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo abrir la ficha"));
      return;
    }
    const cuerpo = (await r.json()) as {
      ficha: Vista;
      historial: Ajuste[];
      maximo?: number;
    };
    setFicha(cuerpo.ficha);
    setHistorial(cuerpo.historial);
    if (cuerpo.maximo) {
      setMaximo(cuerpo.maximo);
    }
    setResultados([]);
    setTexto("");
  };

  const enviar = async (evento: React.SubmitEvent) => {
    evento.preventDefault();
    if (!ficha) {
      return;
    }
    setError(null);
    setAviso(null);
    const n = Number(cantidad);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > maximo) {
      setError(
        `escribe un entero distinto de 0, de hasta ${maximo} (o -${maximo})`,
      );
      return;
    }
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/experiencia", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ficha: ficha.id, cantidad: n, motivo }),
      });
      if (!r.ok) {
        setError(await leerError(r, "no se pudo registrar el ajuste"));
        return;
      }
      setAviso(
        `${n > 0 ? "+" : ""}${n} XP para ${ficha.name}. Se refleja en su nivel de inmediato.`,
      );
      setCantidad("");
      setMotivo("");
      await abrir(ficha.id);
    } finally {
      setOcupado(false);
    }
  };

  const porcentaje = ficha
    ? Math.min(
        100,
        Math.round((ficha.experience.current / ficha.experience.max) * 100),
      )
    : 0;

  return (
    <div className="space-y-6">
      <Seccion
        titulo="Buscar ficha"
        bajada="Por nombre o por número de dex (por ejemplo, #16)."
      >
        <input
          type="text"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Nombre o #dex"
          aria-label="Buscar ficha"
          className={CLASE_CAMPO}
        />
        {resultados.length > 0 ? (
          <ul className="divide-y divide-dex-line text-sm">
            {resultados.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => void abrir(f.id)}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left hover:text-dex-accent"
                >
                  <span>{f.name}</span>
                  <span className="text-xs text-dex-muted">
                    #{String(f.dex).padStart(3, "0")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Seccion>

      {ficha ? (
        <>
          <Seccion
            titulo={ficha.name}
            bajada={`#${String(ficha.dex).padStart(3, "0")} · ${ficha.slug}`}
            acciones={<Pildora tono="acento">Nivel {ficha.level}</Pildora>}
          >
            <div className="space-y-2">
              <div
                className="h-2 overflow-hidden rounded-full bg-dex-panel-soft"
                role="progressbar"
                aria-valuenow={porcentaje}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Barra de experiencia"
              >
                <div
                  className="h-full bg-dex-accent"
                  style={{ width: `${porcentaje}%` }}
                />
              </div>
              <p className="text-xs text-dex-muted">
                {ficha.experience.current}/{ficha.experience.max} XP en este
                nivel · {ficha.experience.total} en total · {ficha.likes} likes
                · {ficha.xpDeJuego} XP de juego y ajustes
              </p>
            </div>
          </Seccion>

          <Seccion
            titulo="Dar experiencia"
            bajada="Un número negativo quita XP (para corregir un error). Queda registrado."
          >
            <form onSubmit={enviar} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {ATAJOS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCantidad(String(n))}
                    className={CLASE_BOTON.secundario}
                  >
                    {n > 0 ? `+${n}` : n}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
                <input
                  type="number"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="Cantidad"
                  aria-label="Cantidad de XP"
                  step={1}
                  className={CLASE_CAMPO_MONO}
                />
                <input
                  type="text"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  maxLength={200}
                  placeholder="Motivo (obligatorio)"
                  aria-label="Motivo del ajuste"
                  className={CLASE_CAMPO}
                />
              </div>
              <button
                type="submit"
                disabled={ocupado}
                className={CLASE_BOTON.primario}
              >
                Aplicar ajuste
              </button>
            </form>
          </Seccion>

          <Seccion titulo="Ajustes recientes">
            {historial.length === 0 ? (
              <p className="text-sm text-dex-muted">
                Esta ficha no tiene ajustes manuales.
              </p>
            ) : (
              <ul className="divide-y divide-dex-line text-sm">
                {historial.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                  >
                    <span>
                      <span
                        className={`font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] ${a.cantidad > 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {a.cantidad > 0 ? "+" : ""}
                        {a.cantidad}
                      </span>{" "}
                      {a.motivo}
                    </span>
                    <span className="text-xs text-dex-muted">
                      {a.actor} · {a.creado.slice(0, 10)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Seccion>
        </>
      ) : null}

      {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
