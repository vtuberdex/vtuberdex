"use client";

/**
 * Explorador de archivos del servidor: se navega CARPETA por carpeta (raíz, `plugins/<Plugin>` con
 * sus subcarpetas, `config/`), se abre un archivo y se guarda con copia `.bak`.
 *
 * Antes llegaba una lista plana con todo el servidor (hasta 4000 rutas) y había que buscarlas por
 * texto; con un servidor con MythicMobs, MMOItems y compañía eso eran cientos de líneas mezcladas.
 * El servidor decide qué se puede abrir, qué se puede escribir y valida al guardar; aquí solo se
 * pinta (`lib/minecraft-archivos.mjs`).
 */
import { useCallback, useEffect, useMemo, useState } from "react";

import { CLASE_BOTON, CLASE_CAMPO, CLASE_CAMPO_MONO, Seccion } from "./ui";

type Archivo = {
  ruta: string;
  nombre: string;
  bytes: number;
  modificado: string;
  escribible?: boolean;
};
type Carpeta = { nombre: string; ruta: string };
type Migaja = { nombre: string; ruta: string };
type Contenido = {
  ruta: string;
  migas: Migaja[];
  carpetas: Carpeta[];
  archivos: Archivo[];
  /** Solo aparecen dentro de `plugins/`: son los `.zip` que se pueden subir y reemplazar. */
  comprimidos?: Archivo[];
  escribible: boolean;
  legible: boolean;
};

const MENSAJES: Record<string, string> = {
  sin_permiso_escritura:
    "El panel puede leer esta carpeta pero no guardar: al servicio web le falta permiso de escritura en ella.",
  sin_espacio: "No queda espacio en disco.",
  extension_no_permitida: "Solo se pueden subir archivos .zip.",
  archivo_demasiado_grande: "El zip pasa de los 50 MB.",
};
const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  if (!c?.error) return porDefecto;
  const amable = MENSAJES[c.error];
  if (amable) return amable;
  return c.detail ? `${c.error}: ${c.detail}` : c.error;
};

const tamano = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`;

const MONO = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

/** Mismo tope que un jar de plugin (50 MB): el servidor lo vuelve a comprobar. */
const LIMITE_ZIP_BYTES = 50 * 1024 * 1024;

export function SeccionArchivos() {
  const [datos, setDatos] = useState<Contenido | null>(null);
  const [filtro, setFiltro] = useState("");
  const [ruta, setRuta] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [original, setOriginal] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [zip, setZip] = useState<File | null>(null);

  const cargar = useCallback(async (destino: string) => {
    setError(null);
    const consulta = destino
      ? `?${new URLSearchParams({ carpeta: destino })}`
      : "";
    const r = await fetch(`/api/minecraft-admin/archivos${consulta}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo listar la carpeta"));
      return;
    }
    setDatos((await r.json()) as Contenido);
  }, []);

  useEffect(() => {
    void cargar("");
  }, [cargar]);

  const sinGuardar = texto !== original;

  const navegar = async (destino: string) => {
    if (sinGuardar && !window.confirm("Hay cambios sin guardar. ¿Descartarlos?")) {
      return;
    }
    setAviso(null);
    setRuta(null);
    setTexto("");
    setOriginal("");
    setFiltro("");
    await cargar(destino);
  };

  const abrir = async (destino: string) => {
    if (sinGuardar && !window.confirm("Hay cambios sin guardar. ¿Descartarlos?")) {
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
      await cargar(datos?.ruta ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo guardar");
    } finally {
      setOcupado(false);
    }
  };

  const f = filtro.trim().toLowerCase();
  const carpetas = useMemo(
    () =>
      (datos?.carpetas ?? []).filter((c) => !f || c.nombre.toLowerCase().includes(f)),
    [datos, f],
  );
  const archivos = useMemo(
    () =>
      (datos?.archivos ?? []).filter(
        (a) => !f || a.nombre.toLowerCase().includes(f),
      ),
    [datos, f],
  );

  const abierto = datos?.archivos.find((a) => a.ruta === ruta);
  const soloLectura =
    datos?.escribible === false || abierto?.escribible === false;

  return (
    <Seccion
      titulo="Archivos"
      bajada="Se navega carpeta por carpeta: plugins (cada uno con lo suyo), config/ y los yml de la raíz. Se valida al guardar y queda una copia .bak."
    >
      {datos?.legible === false ? (
        <p
          role="alert"
          className="rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm text-red-400"
        >
          El panel no puede leer esa carpeta del servidor. Revisa que exista y que
          el servicio web tenga permiso para leerla.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
        <div className="space-y-2">
          <nav
            aria-label="Carpeta actual"
            className={`flex flex-wrap items-center gap-1 text-xs ${MONO}`}
          >
            <button
              type="button"
              onClick={() => void navegar("")}
              className="rounded px-1.5 py-0.5 text-dex-accent hover:bg-dex-panel-soft"
            >
              servidor
            </button>
            {(datos?.migas ?? []).map((m) => (
              <span key={m.ruta} className="flex items-center gap-1">
                <span className="text-dex-muted">/</span>
                <button
                  type="button"
                  onClick={() => void navegar(m.ruta)}
                  className="rounded px-1.5 py-0.5 text-dex-accent hover:bg-dex-panel-soft"
                >
                  {m.nombre}
                </button>
              </span>
            ))}
          </nav>

          <input
            type="search"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar en esta carpeta"
            aria-label="Filtrar archivos"
            className={CLASE_CAMPO}
          />

          <ul
            aria-label="Contenido de la carpeta"
            className="max-h-[32rem] overflow-auto rounded-xl border border-dex-line bg-dex-void/60 p-1 text-xs"
          >
            {carpetas.length === 0 && archivos.length === 0 ? (
              <li className="p-2 text-dex-muted">Carpeta vacía.</li>
            ) : null}
            {carpetas.map((c) => (
              <li key={c.ruta}>
                <button
                  type="button"
                  onClick={() => void navegar(c.ruta)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left ${MONO} text-dex-ink hover:bg-dex-panel-soft`}
                  title={c.ruta}
                >
                  <span aria-hidden>📁</span>
                  <span className="truncate">{c.nombre}</span>
                  <span className="ml-auto text-dex-muted">›</span>
                </button>
              </li>
            ))}
            {archivos.map((a) => (
              <li key={a.ruta}>
                <button
                  type="button"
                  onClick={() => void abrir(a.ruta)}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left ${MONO} hover:bg-dex-panel-soft ${
                    a.ruta === ruta
                      ? "bg-dex-panel-soft text-dex-accent"
                      : "text-dex-ink"
                  }`}
                  title={a.ruta}
                >
                  <span className="truncate">{a.nombre}</span>
                  {a.escribible === false ? (
                    <span className="ml-auto shrink-0 text-[10px] uppercase text-amber-400">
                      solo lectura
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={guardar} className="space-y-3">
          {soloLectura ? (
            <p
              role="alert"
              className="rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-xs text-amber-300"
            >
              Esta carpeta se puede leer pero no guardar: al servicio web le falta
              permiso de escritura en el servidor. Se puede abrir el archivo, pero
              «Guardar» está desactivado hasta que se arregle ese permiso.
            </p>
          ) : null}
          <input
            readOnly
            value={ruta ?? ""}
            placeholder="Elige un archivo de la carpeta"
            aria-label="Archivo abierto"
            className={CLASE_CAMPO_MONO}
          />
          {abierto ? (
            <p className="text-[11px] text-dex-muted">
              {tamano(abierto.bytes)} · modificado{" "}
              {new Date(abierto.modificado).toLocaleString("es")}
            </p>
          ) : null}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={22}
            disabled={!ruta}
            spellCheck={false}
            aria-label="Contenido del archivo"
            className={`${CLASE_CAMPO} ${MONO} text-xs leading-relaxed`}
          />
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={ocupado || !ruta || !sinGuardar || soloLectura}
              className={CLASE_BOTON.primario}
            >
              Guardar archivo
            </button>
            {sinGuardar ? (
              <span className="text-xs text-amber-400">Cambios sin guardar</span>
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
