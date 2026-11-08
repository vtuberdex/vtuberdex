"use client";

/**
 * Explorador de archivos del servidor: árbol de lo editable (plugins a cualquier profundidad,
 * `bukkit.yml`, `spigot.yml`, `config/paper-*.yml`), editor y guardado con copia `.bak`.
 * El servidor decide qué se puede abrir y valida; aquí solo se pinta (`lib/minecraft-archivos.mjs`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { CLASE_BOTON, CLASE_CAMPO, CLASE_CAMPO_MONO, Seccion } from "./ui";

type Archivo = { ruta: string; bytes: number; modificado: string };

const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  return c?.detail ? `${c.error}: ${c.detail}` : (c?.error ?? porDefecto);
};

export function SeccionArchivos() {
  const [archivos, setArchivos] = useState<Archivo[]>([]);
  const [truncado, setTruncado] = useState(false);
  const [filtro, setFiltro] = useState("");
  const [ruta, setRuta] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [original, setOriginal] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/minecraft-admin/archivos", {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo listar los archivos"));
      return;
    }
    const c = (await r.json()) as { archivos: Archivo[]; truncado?: boolean };
    setArchivos(c.archivos);
    setTruncado(Boolean(c.truncado));
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const visibles = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    return f
      ? archivos.filter((a) => a.ruta.toLowerCase().includes(f))
      : archivos;
  }, [archivos, filtro]);

  const abrir = async (destino: string) => {
    if (
      texto !== original &&
      !window.confirm("Hay cambios sin guardar. ¿Descartarlos?")
    ) {
      return;
    }
    setError(null);
    setAviso(null);
    const r = await fetch(
      `/api/minecraft-admin/archivos?${new URLSearchParams({ ruta: destino })}`,
      { cache: "no-store" },
    );
    if (!r.ok) {
      setError(await leerError(r, "no se pudo abrir el archivo"));
      return;
    }
    const c = (await r.json()) as { contenido: string };
    setRuta(destino);
    setTexto(c.contenido);
    setOriginal(c.contenido);
  };

  const guardar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!ruta) return;
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/archivos", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ruta, contenido: texto }),
      });
      if (!r.ok) throw new Error(await leerError(r, "no se pudo guardar"));
      setOriginal(texto);
      setAviso(
        `Guardado ${ruta} (copia anterior en .bak). Recarga el plugin o reinicia para aplicar.`,
      );
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo guardar");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Seccion
      titulo="Archivos"
      bajada="Plugins (cualquier carpeta), bukkit.yml, spigot.yml y config/paper-*. Se valida al guardar y queda una copia .bak."
    >
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-2">
          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar (ej. mythic, skills)"
            aria-label="Filtrar archivos"
            className={CLASE_CAMPO}
          />
          <ul
            aria-label="Archivos editables"
            className="max-h-[32rem] overflow-auto rounded-xl border border-dex-line bg-dex-void/60 p-1 text-xs"
          >
            {visibles.length === 0 ? (
              <li className="p-2 text-dex-muted">Sin archivos.</li>
            ) : (
              visibles.map((a) => (
                <li key={a.ruta}>
                  <button
                    type="button"
                    onClick={() => void abrir(a.ruta)}
                    className={`block w-full truncate rounded-lg px-2 py-1 text-left font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] hover:bg-dex-panel-soft ${
                      a.ruta === ruta
                        ? "bg-dex-panel-soft text-dex-accent"
                        : "text-dex-ink"
                    }`}
                    title={a.ruta}
                  >
                    {a.ruta}
                  </button>
                </li>
              ))
            )}
          </ul>
          {truncado ? (
            <p className="text-xs text-amber-400">
              Lista recortada: usa el filtro.
            </p>
          ) : null}
        </div>

        <form onSubmit={guardar} className="space-y-3">
          <input
            readOnly
            value={ruta ?? ""}
            placeholder="Elige un archivo de la lista"
            aria-label="Archivo abierto"
            className={CLASE_CAMPO_MONO}
          />
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={22}
            disabled={!ruta}
            spellCheck={false}
            aria-label="Contenido del archivo"
            className={`${CLASE_CAMPO} font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-xs leading-relaxed`}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={ocupado || !ruta || texto === original}
              className={CLASE_BOTON.primario}
            >
              Guardar archivo
            </button>
            {texto !== original ? (
              <span className="text-xs text-amber-400">
                Cambios sin guardar
              </span>
            ) : null}
          </div>
          {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : null}
        </form>
      </div>
    </Seccion>
  );
}
