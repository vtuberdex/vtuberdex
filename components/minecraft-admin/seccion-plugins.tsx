"use client";

/**
 * Pestaña «Plugins» de `/minecraft-admin`: lista con el estado de cada plugin y, al elegir uno,
 * su ficha (datos del jar), su configuración editable y su registro.
 *
 * Habilitar/deshabilitar renombra el jar y surte efecto al REINICIAR el servidor (Paper no
 * descarga plugins en caliente de forma segura); por eso cada fila distingue lo que dicen los
 * archivos de lo que corre ahora, y avisa «pendiente de reinicio».
 */
import { useCallback, useEffect, useState } from "react";

import {
  CLASE_BOTON,
  CLASE_CAMPO,
  CLASE_TARJETA,
  Pildora,
  Seccion,
  type Tono,
} from "./ui";

export type PluginInfo = {
  archivo: string;
  nombre: string;
  version: string;
  descripcion: string;
  autores: string[];
  bytes: number;
  modificado: string | null;
  habilitado: boolean;
  cargado: boolean | null;
  estado:
    | "activo"
    | "deshabilitado"
    | "pendiente-reinicio"
    | "sin-cargar"
    | "sin-leer";
  legible?: boolean;
  protegido: boolean;
  configuraciones: string[];
};

const ETIQUETA_ESTADO: Record<
  PluginInfo["estado"],
  { texto: string; tono: Tono }
> = {
  activo: { texto: "Activo", tono: "bien" },
  deshabilitado: { texto: "Deshabilitado", tono: "neutro" },
  "pendiente-reinicio": { texto: "Se apagará al reiniciar", tono: "ojo" },
  "sin-leer": { texto: "Jar sin permiso de lectura", tono: "ojo" },
  "sin-cargar": { texto: "Pendiente de reinicio", tono: "ojo" },
};

const leerError = async (r: Response, porDefecto: string) => {
  const c = (await r.json().catch(() => null)) as {
    error?: string;
    detail?: string;
  } | null;
  return c?.detail ?? c?.error ?? porDefecto;
};

/** Cola del registro del servidor, entera o filtrada por plugin. Se puede refrescar a mano o cada 5 s. */
export function VisorRegistro({ plugin }: { plugin?: string }) {
  const [lineas, setLineas] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vivo, setVivo] = useState(false);

  const cargar = useCallback(async () => {
    const q = new URLSearchParams({ lineas: "200" });
    if (plugin) q.set("plugin", plugin);
    try {
      const r = await fetch(`/api/minecraft-admin/registros?${q}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        setError(await leerError(r, "no se pudo leer el registro"));
        return;
      }
      setError(null);
      const cuerpo = (await r.json()) as { lineas?: string[] };
      setLineas(Array.isArray(cuerpo.lineas) ? cuerpo.lineas : []);
    } catch {
      setError("no se pudo leer el registro");
    }
  }, [plugin]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!vivo) return;
    const ciclo = setInterval(() => void cargar(), 5000);
    return () => clearInterval(ciclo);
  }, [vivo, cargar]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={() => void cargar()}
          className={CLASE_BOTON.secundario}
        >
          Actualizar
        </button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={vivo}
            onChange={(e) => setVivo(e.target.checked)}
          />
          Seguir en vivo
        </label>
        <span className="text-xs text-dex-muted">
          {plugin ? `Líneas de [${plugin}]` : "Todo el servidor"} · últimas 200
          · las IP se ocultan
        </span>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <pre
        aria-label={plugin ? `Registro de ${plugin}` : "Registro del servidor"}
        className="max-h-96 min-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-dex-line bg-dex-void p-3 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-xs leading-relaxed text-dex-accent"
      >
        {lineas === null
          ? "Cargando…"
          : lineas.length === 0
            ? plugin
              ? "Este plugin no ha escrito nada reciente en el registro."
              : "El registro está vacío."
            : lineas.join("\n")}
      </pre>
    </div>
  );
}

export function SeccionPlugins({
  respaldo,
  children,
}: {
  /** Nombres de jar del estado general: se usan si la API detallada no responde. */
  respaldo: string[];
  /** Formulario de subida, que vive en el panel porque comparte su aviso y su estado de «ocupado». */
  children?: React.ReactNode;
}) {
  const [lista, setLista] = useState<PluginInfo[] | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [vista, setVista] = useState<"info" | "config" | "registro">("info");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [archivoConfig, setArchivoConfig] = useState<string | null>(null);
  const [texto, setTexto] = useState("");

  const cargar = useCallback(async () => {
    try {
      const r = await fetch("/api/minecraft-admin/plugins", {
        cache: "no-store",
      });
      if (r.ok) {
        const cuerpo = (await r.json()) as { plugins?: PluginInfo[] };
        if (Array.isArray(cuerpo.plugins)) {
          setLista(cuerpo.plugins);
          return;
        }
      }
    } catch {
      /* se usa el respaldo */
    }
    setLista(null);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const plugins: PluginInfo[] =
    lista ??
    respaldo.map((nombre) => ({
      archivo: nombre,
      nombre,
      version: "",
      descripcion: "",
      autores: [],
      bytes: 0,
      modificado: null,
      habilitado: true,
      cargado: null,
      estado: "activo" as const,
      protegido: false,
      configuraciones: [],
    }));
  const actual = plugins.find((p) => p.archivo === elegido) ?? null;

  const cambiarEstado = async (p: PluginInfo, habilitado: boolean) => {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/plugins/estado", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ archivo: p.archivo, habilitado }),
      });
      if (!r.ok) {
        setError(await leerError(r, "no se pudo cambiar el estado"));
        return;
      }
      setAviso(
        `${p.nombre} quedó ${habilitado ? "habilitado" : "deshabilitado"}. Se aplica al reiniciar el servidor.`,
      );
      setElegido(null);
      await cargar();
    } finally {
      setOcupado(false);
    }
  };

  const abrirConfig = async (archivo: string) => {
    setArchivoConfig(archivo);
    setError(null);
    const q = new URLSearchParams({ tipo: "plugin", archivo });
    const r = await fetch(`/api/minecraft-admin/configuracion?${q}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo abrir el archivo"));
      return;
    }
    setTexto(((await r.json()) as { contenido?: string }).contenido ?? "");
  };

  const guardarConfig = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!archivoConfig) return;
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/configuracion", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo: "plugin",
          archivo: archivoConfig,
          contenido: texto,
        }),
      });
      if (!r.ok) {
        setError(await leerError(r, "no se pudo guardar"));
        return;
      }
      setAviso(
        `${archivoConfig} guardado. El plugin lo relee al reiniciar el servidor.`,
      );
    } finally {
      setOcupado(false);
    }
  };

  const elegir = (p: PluginInfo) => {
    setElegido(p.archivo);
    setVista("info");
    setArchivoConfig(null);
    setTexto("");
    setError(null);
    setAviso(null);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-5">
        <section className={`${CLASE_TARJETA} space-y-3 lg:col-span-2`}>
          <h2 className="text-lg text-dex-ink">
            Plugins instalados ({plugins.length})
          </h2>
          {plugins.length === 0 ? (
            <p className="text-sm text-dex-muted">
              No hay jars en la carpeta de plugins.
            </p>
          ) : (
            <ul className="-mx-2 divide-y divide-dex-line text-sm">
              {plugins.map((p) => (
                <li key={p.archivo}>
                  <button
                    type="button"
                    onClick={() => elegir(p)}
                    aria-pressed={elegido === p.archivo}
                    className={`flex w-full flex-col gap-1 rounded-xl px-2 py-2.5 text-left transition hover:bg-dex-panel-soft ${elegido === p.archivo ? "bg-dex-accent/10" : ""}`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">
                        {p.nombre}
                        {p.version ? (
                          <span className="text-dex-muted"> {p.version}</span>
                        ) : null}
                      </span>
                      {lista ? (
                        <Pildora tono={ETIQUETA_ESTADO[p.estado].tono}>
                          {ETIQUETA_ESTADO[p.estado].texto}
                        </Pildora>
                      ) : null}
                    </span>
                    {p.nombre !== p.archivo ? (
                      <span className="text-xs text-dex-muted">
                        {p.archivo}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${CLASE_TARJETA} space-y-4 lg:col-span-3`}>
          {!actual ? (
            <p className="text-sm text-dex-muted">
              Elige un plugin de la lista para ver su ficha, editar su
              configuración y leer su registro.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg text-dex-ink">
                    {actual.nombre}
                    {actual.version ? (
                      <span className="text-dex-muted"> {actual.version}</span>
                    ) : null}
                  </h2>
                  {actual.descripcion ? (
                    <p className="text-sm text-dex-muted">
                      {actual.descripcion}
                    </p>
                  ) : null}
                </div>
                {actual.protegido ? (
                  <span className="text-xs text-dex-muted">
                    Plugin de VTuberDex: no se puede apagar desde la web
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={ocupado}
                    onClick={() =>
                      void cambiarEstado(actual, !actual.habilitado)
                    }
                    className={CLASE_BOTON.secundario}
                  >
                    {actual.habilitado ? "Deshabilitar" : "Habilitar"}
                  </button>
                )}
              </div>

              <div
                role="tablist"
                aria-label={`Secciones de ${actual.nombre}`}
                className="flex gap-1 border-b border-dex-line text-sm"
              >
                {(
                  [
                    ["info", "Información"],
                    [
                      "config",
                      `Configuración (${actual.configuraciones.length})`,
                    ],
                    ["registro", "Registro"],
                  ] as const
                ).map(([id, titulo]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={vista === id}
                    onClick={() => setVista(id)}
                    className={`-mb-px border-b-2 px-3 py-1.5 ${vista === id ? "border-dex-accent text-dex-accent" : "border-transparent text-dex-muted hover:text-dex-ink"}`}
                  >
                    {titulo}
                  </button>
                ))}
              </div>

              {vista === "info" ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-dex-muted">Archivo</dt>
                  <dd className="font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">
                    {actual.archivo}
                  </dd>
                  <dt className="text-dex-muted">Tamaño</dt>
                  <dd>
                    {actual.bytes
                      ? `${(actual.bytes / 1024).toFixed(0)} KB`
                      : "—"}
                  </dd>
                  <dt className="text-dex-muted">Modificado</dt>
                  <dd>
                    {actual.modificado ? actual.modificado.slice(0, 10) : "—"}
                  </dd>
                  <dt className="text-dex-muted">Autores</dt>
                  <dd>
                    {actual.autores.length ? actual.autores.join(", ") : "—"}
                  </dd>
                  <dt className="text-dex-muted">Estado</dt>
                  <dd>
                    {actual.cargado === null
                      ? "No se pudo comprobar si está cargado"
                      : actual.cargado
                        ? "Cargado en el servidor"
                        : "No cargado"}
                  </dd>
                </dl>
              ) : null}

              {vista === "config" ? (
                <div className="space-y-3">
                  {actual.configuraciones.length === 0 ? (
                    <p className="text-sm text-dex-muted">
                      Este plugin no tiene archivos .yml editables (o aún no los
                      ha creado).
                    </p>
                  ) : (
                    <ul className="flex flex-wrap gap-2 text-sm">
                      {actual.configuraciones.map((c) => (
                        <li key={c}>
                          <button
                            type="button"
                            onClick={() => void abrirConfig(c)}
                            aria-pressed={archivoConfig === c}
                            className={`${CLASE_BOTON.secundario} font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] ${archivoConfig === c ? "!border-dex-accent !text-dex-accent" : ""}`}
                          >
                            {c.split("/").pop()}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {archivoConfig ? (
                    <form onSubmit={guardarConfig} className="space-y-3">
                      <textarea
                        value={texto}
                        onChange={(e) => setTexto(e.target.value)}
                        rows={16}
                        spellCheck={false}
                        aria-label={`Contenido de ${archivoConfig}`}
                        className={`${CLASE_CAMPO} font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-xs leading-relaxed`}
                      />
                      <button
                        type="submit"
                        disabled={ocupado}
                        className={CLASE_BOTON.primario}
                      >
                        Guardar {archivoConfig.split("/").pop()}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              {vista === "registro" ? (
                <VisorRegistro plugin={actual.nombre} />
              ) : null}
            </>
          )}
        </section>
      </div>

      {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-dex-muted">
        Habilitar, deshabilitar, subir un jar o cambiar una configuración se
        aplica al reiniciar el servidor de Minecraft; usa «Reiniciar servidor»
        del menú lateral cuando no haya mucha gente.
      </p>

      {children}

      <Seccion
        titulo="Registro del servidor"
        bajada="Últimas líneas de logs/latest.log"
      >
        <VisorRegistro />
      </Seccion>
    </div>
  );
}
