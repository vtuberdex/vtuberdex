// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Pestaña «Misiones» (solo admin): edita TODAS las misiones (secundarias y de grado), crea propias y desactiva las que
 * sobren. Cada ajuste se guarda sobre el catálogo del código; «Restablecer» lo devuelve a su valor original (ver
 * `server/src/misiones.mjs`). El progreso de la gente nunca se borra.
 */
import { useCallback, useEffect, useState } from "react";

import {
  CLASE_BOTON,
  CLASE_CAMPO,
  CLASE_CAMPO_MONO,
  Pildora,
  Seccion,
} from "./ui";

type Mision = {
  id: string;
  tipo: "secundaria" | "grado";
  nombre: string;
  descripcion: string;
  xp: number;
  repetible: "diaria" | "semanal" | null;
  grado?: string;
  requisitos: Record<string, number>;
  activa: boolean;
  propia: boolean;
};
type Borrador = {
  id: string;
  nuevo: boolean;
  tipo: Mision["tipo"];
  nombre: string;
  descripcion: string;
  xp: string;
  repetible: string;
  grado: string;
  activa: boolean;
  requisitos: { contador: string; meta: string }[];
};

const aBorrador = (m: Mision): Borrador => ({
  id: m.id,
  nuevo: false,
  tipo: m.tipo,
  nombre: m.nombre,
  descripcion: m.descripcion,
  xp: String(m.xp),
  repetible: m.repetible ?? "unica",
  grado: m.grado ?? "6",
  activa: m.activa,
  requisitos: Object.entries(m.requisitos).map(([contador, meta]) => ({
    contador,
    meta: String(meta),
  })),
});

const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  return c?.detail ? `${c.error}: ${c.detail}` : (c?.error ?? porDefecto);
};

const enviar = (cuerpo: object) =>
  fetch("/api/minecraft-admin/misiones", {
    method: "POST",
    headers: { "content-type": "application/json", "x-panel": "1" },
    body: JSON.stringify(cuerpo),
  });

export function SeccionMisiones() {
  const [misiones, setMisiones] = useState<Mision[]>([]);
  const [contadores, setContadores] = useState<Record<string, string>>({});
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/minecraft-admin/misiones", {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudieron cargar las misiones"));
      return;
    }
    const c = (await r.json()) as {
      misiones: Mision[];
      contadores: Record<string, string>;
    };
    setMisiones(c.misiones);
    setContadores(c.contadores);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const accion = async (cuerpo: object, exito: string) => {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await enviar(cuerpo);
      if (!r.ok) {
        setError(await leerError(r, "no se pudo completar la acción"));
        return false;
      }
      setAviso(exito);
      await cargar();
      return true;
    } finally {
      setOcupado(false);
    }
  };

  const nueva = () => {
    const primero = Object.keys(contadores)[0] ?? "mobs";
    setBorrador({
      id: "",
      nuevo: true,
      tipo: "secundaria",
      nombre: "",
      descripcion: "",
      xp: "0",
      repetible: "diaria",
      grado: "6",
      activa: true,
      requisitos: [{ contador: primero, meta: "1" }],
    });
  };

  const guardar = async (e: React.SubmitEvent) => {
    e.preventDefault();
    if (!borrador) {
      return;
    }
    const requisitos: Record<string, number> = {};
    for (const r of borrador.requisitos) {
      requisitos[r.contador] = Number(r.meta);
    }
    const esGrado = borrador.tipo === "grado";
    const cambios = {
      nombre: borrador.nombre,
      descripcion: borrador.descripcion,
      xp: Number(borrador.xp),
      repetible:
        esGrado || borrador.repetible === "unica" ? null : borrador.repetible,
      requisitos,
      activa: borrador.activa,
      ...(borrador.nuevo ? { tipo: borrador.tipo } : {}),
      ...(esGrado ? { grado: borrador.grado } : {}),
    };
    if (
      await accion(
        { accion: "guardar", id: borrador.id, cambios },
        `Misión «${borrador.nombre}» guardada.`,
      )
    ) {
      setBorrador(null);
    }
  };

  const campo = <K extends keyof Borrador>(k: K, v: Borrador[K]) =>
    setBorrador((b) => (b ? { ...b, [k]: v } : b));

  return (
    <div className="space-y-6">
      <Seccion
        titulo="Misiones"
        bajada="Cambia metas, XP y textos, desactiva las que sobren o crea las tuyas. «Restablecer» vuelve al valor original. El progreso de la gente se conserva siempre."
      >
        <button type="button" onClick={nueva} className={CLASE_BOTON.primario}>
          Nueva misión
        </button>
        <ul className="divide-y divide-dex-line text-sm">
          {misiones.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <span className="space-x-2">
                <Pildora tono={m.activa ? "bien" : "neutro"}>
                  {m.activa ? "activa" : "desactivada"}
                </Pildora>
                {m.propia ? <Pildora tono="acento">propia</Pildora> : null}
                <span>
                  {m.nombre}
                  {m.grado ? ` · grado ${m.grado}` : ""}
                </span>
                <span className="text-xs text-dex-muted">
                  {m.repetible ?? "única"} · {m.xp} XP ·{" "}
                  {Object.entries(m.requisitos)
                    .map(([c, n]) => `${n} ${c}`)
                    .join(", ")}
                </span>
              </span>
              <span className="space-x-2">
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => setBorrador(aBorrador(m))}
                  className={CLASE_BOTON.secundario}
                >
                  Editar
                </button>
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={() => {
                    if (
                      window.confirm(
                        `¿Restablecer «${m.nombre}»${m.propia ? " (se elimina)" : ""}?`,
                      )
                    ) {
                      void accion(
                        { accion: "restablecer", id: m.id },
                        "Misión restablecida.",
                      );
                    }
                  }}
                  className={CLASE_BOTON.secundario}
                >
                  Restablecer
                </button>
              </span>
            </li>
          ))}
        </ul>
      </Seccion>

      {borrador ? (
        <Seccion
          titulo={borrador.nuevo ? "Nueva misión" : `Editar ${borrador.id}`}
        >
          <form onSubmit={guardar} className="space-y-3">
            {borrador.nuevo ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="text"
                  value={borrador.id}
                  onChange={(e) => campo("id", e.target.value)}
                  placeholder="id (minúsculas, números, - y .)"
                  aria-label="Id de la misión"
                  className={CLASE_CAMPO_MONO}
                />
                <select
                  value={borrador.tipo}
                  onChange={(e) =>
                    campo("tipo", e.target.value as Mision["tipo"])
                  }
                  aria-label="Tipo"
                  className={CLASE_CAMPO}
                >
                  <option value="secundaria">Secundaria (da XP)</option>
                  <option value="grado">De grado</option>
                </select>
              </div>
            ) : null}
            <input
              type="text"
              value={borrador.nombre}
              onChange={(e) => campo("nombre", e.target.value)}
              maxLength={60}
              placeholder="Nombre"
              aria-label="Nombre"
              className={CLASE_CAMPO}
            />
            <input
              type="text"
              value={borrador.descripcion}
              onChange={(e) => campo("descripcion", e.target.value)}
              maxLength={200}
              placeholder="Descripción"
              aria-label="Descripción"
              className={CLASE_CAMPO}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-xs text-dex-muted">
                XP
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={borrador.xp}
                  onChange={(e) => campo("xp", e.target.value)}
                  className={CLASE_CAMPO_MONO}
                />
              </label>
              {borrador.tipo === "grado" ? (
                <label className="space-y-1 text-xs text-dex-muted">
                  Grado
                  <input
                    type="text"
                    value={borrador.grado}
                    onChange={(e) => campo("grado", e.target.value)}
                    className={CLASE_CAMPO_MONO}
                  />
                </label>
              ) : (
                <label className="space-y-1 text-xs text-dex-muted">
                  Repetición
                  <select
                    value={borrador.repetible}
                    onChange={(e) => campo("repetible", e.target.value)}
                    className={CLASE_CAMPO}
                  >
                    <option value="diaria">Diaria</option>
                    <option value="semanal">Semanal</option>
                    <option value="unica">Única</option>
                  </select>
                </label>
              )}
              <label className="flex items-end gap-2 pb-2 text-sm">
                <input
                  type="checkbox"
                  checked={borrador.activa}
                  onChange={(e) => campo("activa", e.target.checked)}
                />
                Activa
              </label>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-dex-muted">
                Requisitos (se cumplen todos)
              </p>
              {borrador.requisitos.map((r, i) => (
                <div
                  key={i}
                  className="grid gap-2 sm:grid-cols-[1fr_9rem_auto]"
                >
                  <select
                    value={r.contador}
                    onChange={(e) =>
                      campo(
                        "requisitos",
                        borrador.requisitos.map((x, j) =>
                          j === i ? { ...x, contador: e.target.value } : x,
                        ),
                      )
                    }
                    aria-label="Contador"
                    className={CLASE_CAMPO}
                  >
                    {Object.entries(contadores).map(([c, etiqueta]) => (
                      <option key={c} value={c}>
                        {c} — {etiqueta}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={r.meta}
                    onChange={(e) =>
                      campo(
                        "requisitos",
                        borrador.requisitos.map((x, j) =>
                          j === i ? { ...x, meta: e.target.value } : x,
                        ),
                      )
                    }
                    aria-label="Meta"
                    className={CLASE_CAMPO_MONO}
                  />
                  <button
                    type="button"
                    disabled={borrador.requisitos.length === 1}
                    onClick={() =>
                      campo(
                        "requisitos",
                        borrador.requisitos.filter((_, j) => j !== i),
                      )
                    }
                    className={CLASE_BOTON.secundario}
                  >
                    Quitar
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => {
                  const libres = Object.keys(contadores).filter(
                    (c) => !borrador.requisitos.some((r) => r.contador === c),
                  );
                  if (libres[0]) {
                    campo("requisitos", [
                      ...borrador.requisitos,
                      { contador: libres[0], meta: "1" },
                    ]);
                  }
                }}
                className={CLASE_BOTON.secundario}
              >
                Añadir requisito
              </button>
            </div>
            <div className="space-x-2">
              <button
                type="submit"
                disabled={ocupado}
                className={CLASE_BOTON.primario}
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setBorrador(null)}
                className={CLASE_BOTON.secundario}
              >
                Cancelar
              </button>
            </div>
          </form>
        </Seccion>
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
