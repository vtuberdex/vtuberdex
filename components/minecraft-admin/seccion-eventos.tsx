// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Pestaña «Eventos de XP» (solo admin): eventos globales con fechas y multiplicador, y regalos únicos de XP a TODAS las
 * fichas vinculadas. Ambos van aparte del tope diario del juego (ver `server/src/eventos-xp.mjs`), así que un evento
 * no se come el cupo normal de nadie. Todo queda registrado con quién lo hizo.
 */
import { useCallback, useEffect, useState } from "react";

import {
  CLASE_BOTON,
  CLASE_CAMPO,
  CLASE_CAMPO_MONO,
  Pildora,
  Seccion,
  type Tono,
} from "./ui";

type Evento = {
  id: number;
  nombre: string;
  multiplicador: number;
  inicio: string;
  fin: string;
  actor: string;
  estado: "programado" | "activo" | "terminado" | "cancelado";
  xpPagada: number;
  fichas: number;
};
type Regalo = {
  id: number;
  motivo: string;
  cantidad: number;
  fichas: number;
  actor: string;
  creado: string;
};

const TONO: Record<Evento["estado"], Tono> = {
  activo: "bien",
  programado: "acento",
  terminado: "neutro",
  cancelado: "mal",
};

const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  return c?.detail ?? c?.error ?? porDefecto;
};

/** `datetime-local` (hora del navegador) → ISO en UTC; vacío si no se entiende. */
const aIso = (local: string) => {
  const t = Date.parse(local);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
};

const enviar = (cuerpo: object) =>
  fetch("/api/minecraft-admin/eventos", {
    method: "POST",
    headers: { "content-type": "application/json", "x-panel": "1" },
    body: JSON.stringify(cuerpo),
  });

export function SeccionEventos() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [regalos, setRegalos] = useState<Regalo[]>([]);
  const [nombre, setNombre] = useState("");
  const [multiplicador, setMultiplicador] = useState("2");
  const [inicio, setInicio] = useState("");
  const [fin, setFin] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/minecraft-admin/eventos", {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudieron cargar los eventos"));
      return;
    }
    const c = (await r.json()) as { eventos: Evento[]; regalos: Regalo[] };
    setEventos(c.eventos);
    setRegalos(c.regalos);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /** Una acción del panel: avisa del resultado o del error y recarga las listas. */
  const accion = async (cuerpo: object, exito: string, alTerminar?: () => void) => {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await enviar(cuerpo);
      if (!r.ok) {
        setError(await leerError(r, "no se pudo completar la acción"));
        return;
      }
      setAviso(exito);
      alTerminar?.();
      await cargar();
    } finally {
      setOcupado(false);
    }
  };

  const crear = (e: React.SubmitEvent) => {
    e.preventDefault();
    void accion(
      {
        accion: "crear",
        nombre,
        multiplicador: Number(multiplicador),
        inicio: aIso(inicio),
        fin: aIso(fin),
      },
      `Evento «${nombre}» creado.`,
      () => setNombre(""),
    );
  };

  const regalar = (e: React.SubmitEvent) => {
    e.preventDefault();
    const n = Number(cantidad);
    if (
      !window.confirm(
        `¿Regalar ${n} XP a TODAS las fichas vinculadas? Es de una sola vez.`,
      )
    ) {
      return;
    }
    void accion(
      { accion: "regalar", cantidad: n, motivo },
      `Regalo de ${n} XP aplicado.`,
      () => {
        setCantidad("");
        setMotivo("");
      },
    );
  };

  return (
    <div className="space-y-6">
      <Seccion
        titulo="Nuevo evento"
        bajada="Multiplicador por fechas: durante el evento, cada XP que el juego suma paga un bono extra. No gasta el tope diario."
      >
        <form onSubmit={crear} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={80}
              placeholder="Nombre del evento"
              aria-label="Nombre del evento"
              className={CLASE_CAMPO}
            />
            <input
              type="number"
              value={multiplicador}
              onChange={(e) => setMultiplicador(e.target.value)}
              min={1.1}
              max={10}
              step={0.1}
              aria-label="Multiplicador"
              className={CLASE_CAMPO_MONO}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-dex-muted">
              Inicio
              <input
                type="datetime-local"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                aria-label="Inicio del evento"
                className={CLASE_CAMPO}
              />
            </label>
            <label className="space-y-1 text-xs text-dex-muted">
              Fin
              <input
                type="datetime-local"
                value={fin}
                onChange={(e) => setFin(e.target.value)}
                aria-label="Fin del evento"
                className={CLASE_CAMPO}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={ocupado}
            className={CLASE_BOTON.primario}
          >
            Crear evento
          </button>
        </form>
      </Seccion>

      <Seccion titulo="Eventos">
        {eventos.length === 0 ? (
          <p className="text-sm text-dex-muted">Aún no hay eventos.</p>
        ) : (
          <ul className="divide-y divide-dex-line text-sm">
            {eventos.map((ev) => (
              <li
                key={ev.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2"
              >
                <span className="space-x-2">
                  <Pildora tono={TONO[ev.estado]}>{ev.estado}</Pildora>
                  <span>
                    {ev.nombre} · x{ev.multiplicador}
                  </span>
                  <span className="text-xs text-dex-muted">
                    {ev.inicio.slice(0, 16).replace("T", " ")} →{" "}
                    {ev.fin.slice(0, 16).replace("T", " ")} UTC ·{" "}
                    {ev.xpPagada} XP de bono a {ev.fichas} fichas
                  </span>
                </span>
                {ev.estado === "activo" || ev.estado === "programado" ? (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      void accion(
                        { accion: "cancelar", id: ev.id },
                        `Evento «${ev.nombre}» cancelado.`,
                      )
                    }
                    className={CLASE_BOTON.secundario}
                  >
                    Cancelar
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Seccion>

      <Seccion
        titulo="Regalo único a todas las fichas vinculadas"
        bajada="Suma XP una sola vez a todas las fichas con cuenta de Minecraft vinculada. Queda en el historial de cada ficha."
      >
        <form onSubmit={regalar} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <input
              type="number"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              min={1}
              step={1}
              placeholder="Cantidad"
              aria-label="Cantidad de XP del regalo"
              className={CLASE_CAMPO_MONO}
            />
            <input
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={150}
              placeholder="Motivo (obligatorio)"
              aria-label="Motivo del regalo"
              className={CLASE_CAMPO}
            />
          </div>
          <button
            type="submit"
            disabled={ocupado}
            className={CLASE_BOTON.primario}
          >
            Regalar XP a todas
          </button>
        </form>
        {regalos.length > 0 ? (
          <ul className="divide-y divide-dex-line text-sm">
            {regalos.map((g) => (
              <li
                key={g.id}
                className="flex flex-wrap items-baseline justify-between gap-2 py-2"
              >
                <span>
                  <span className="text-emerald-400">+{g.cantidad}</span>{" "}
                  {g.motivo} · {g.fichas} fichas
                </span>
                <span className="text-xs text-dex-muted">
                  {g.actor} · {g.creado.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </Seccion>

      {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
