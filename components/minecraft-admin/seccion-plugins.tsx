// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
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

export type EstadoDePlugin =
  | "activo"
  | "deshabilitado"
  | "pendiente-reinicio"
  | "sin-cargar"
  | "sin-leer";

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
  estado: EstadoDePlugin;
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
const MONO = "font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]";

/** Qué muestra el visor: «Cargando…», el aviso de vacío (distinto si se filtra por plugin) o las líneas. */
function textoDelRegistro(lineas: string[] | null, plugin?: string): string {
  if (lineas === null) {
    return "Cargando…";
  }
  if (lineas.length > 0) {
    return lineas.join("\n");
  }
  return plugin
    ? "Este plugin no ha escrito nada reciente en el registro."
    : "El registro está vacío.";
}

export function VisorRegistro({ plugin }: Readonly<{ plugin?: string }>) {
  const [lineas, setLineas] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vivo, setVivo] = useState(false);

  const cargar = useCallback(async () => {
    const q = new URLSearchParams({ lineas: "200" });
    if (plugin) {
      q.set("plugin", plugin);
    }
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
    if (!vivo) {
      return undefined;
    }
    const ciclo = setInterval(() => void cargar(), 5000);
    return () => clearInterval(ciclo);
  }, [vivo, cargar]);

  const actualizar = () => void cargar();
  const cambiarVivo = (e: React.ChangeEvent<HTMLInputElement>) =>
    setVivo(e.target.checked);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button
          type="button"
          onClick={actualizar}
          className={CLASE_BOTON.secundario}
        >
          Actualizar
        </button>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={vivo} onChange={cambiarVivo} />
          <span>Seguir en vivo</span>
        </label>
        <span className="text-xs text-dex-muted">
          {plugin ? `Líneas de [${plugin}]` : "Todo el servidor"} · últimas 200
          · las IP se ocultan
        </span>
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <pre
        aria-label={plugin ? `Registro de ${plugin}` : "Registro del servidor"}
        className={`max-h-96 min-h-32 overflow-auto whitespace-pre-wrap rounded-xl border border-dex-line bg-dex-void p-3 ${MONO} text-xs leading-relaxed text-dex-accent`}
      >
        {textoDelRegistro(lineas, plugin)}
      </pre>
    </div>
  );
}

/** Sin la API detallada solo se conocen los nombres de jar: se muestran como activos y sin ficha. */
function pluginsDeRespaldo(respaldo: string[]): PluginInfo[] {
  return respaldo.map((nombre) => ({
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
}

/** `cargado` es null cuando RCON no respondió: no se sabe, y se dice así. */
function textoDeCarga(cargado: boolean | null): string {
  if (cargado === null) {
    return "No se pudo comprobar si está cargado";
  }
  return cargado ? "Cargado en el servidor" : "No cargado";
}

type VistaPlugin = "info" | "config" | "registro";

/** Una fila de la lista: nombre, versión, estado (solo con la API detallada) y el jar si se llama distinto. */
function FilaPlugin({
  plugin: p,
  elegido,
  conEstado,
  alElegir,
}: Readonly<{
  plugin: PluginInfo;
  elegido: boolean;
  conEstado: boolean;
  alElegir: (p: PluginInfo) => void;
}>) {
  const elegir = () => alElegir(p);
  return (
    <li>
      <button
        type="button"
        onClick={elegir}
        aria-pressed={elegido}
        className={`flex w-full flex-col gap-1 rounded-xl px-2 py-2.5 text-left transition hover:bg-dex-panel-soft ${elegido ? "bg-dex-accent/10" : ""}`}
      >
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className={MONO}>
            {p.nombre}
            {p.version ? <span className="text-dex-muted"> {p.version}</span> : null}
          </span>
          {conEstado ? (
            <Pildora tono={ETIQUETA_ESTADO[p.estado].tono}>
              {ETIQUETA_ESTADO[p.estado].texto}
            </Pildora>
          ) : null}
        </span>
        {p.nombre === p.archivo ? null : (
          <span className="text-xs text-dex-muted">{p.archivo}</span>
        )}
      </button>
    </li>
  );
}

/** Un botón de las pestañas de la ficha. */
function BotonDeVista({
  id,
  titulo,
  activa,
  alElegir,
}: Readonly<{
  id: VistaPlugin;
  titulo: string;
  activa: boolean;
  alElegir: (id: VistaPlugin) => void;
}>) {
  const elegir = () => alElegir(id);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={elegir}
      className={`-mb-px border-b-2 px-3 py-1.5 ${activa ? "border-dex-accent text-dex-accent" : "border-transparent text-dex-muted hover:text-dex-ink"}`}
    >
      {titulo}
    </button>
  );
}

/** Pestaña «Información» de la ficha: los datos del jar. */
function InfoPlugin({ plugin }: Readonly<{ plugin: PluginInfo }>) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-dex-muted">Archivo</dt>
      <dd className={MONO}>{plugin.archivo}</dd>
      <dt className="text-dex-muted">Tamaño</dt>
      <dd>{plugin.bytes ? `${(plugin.bytes / 1024).toFixed(0)} KB` : "—"}</dd>
      <dt className="text-dex-muted">Modificado</dt>
      <dd>{plugin.modificado ? plugin.modificado.slice(0, 10) : "—"}</dd>
      <dt className="text-dex-muted">Autores</dt>
      <dd>{plugin.autores.length ? plugin.autores.join(", ") : "—"}</dd>
      <dt className="text-dex-muted">Estado</dt>
      <dd>{textoDeCarga(plugin.cargado)}</dd>
    </dl>
  );
}

/** Un archivo .yml del plugin: abrirlo lo carga en el editor de abajo. */
function BotonDeArchivo({
  archivo,
  abierto,
  alAbrir,
}: Readonly<{
  archivo: string;
  abierto: boolean;
  alAbrir: (archivo: string) => void;
}>) {
  const abrir = () => alAbrir(archivo);
  return (
    <li>
      <button
        type="button"
        onClick={abrir}
        aria-pressed={abierto}
        className={`${CLASE_BOTON.secundario} ${MONO} ${abierto ? "!border-dex-accent !text-dex-accent" : ""}`}
      >
        {archivo.split("/").pop()}
      </button>
    </li>
  );
}

/** Pestaña «Configuración» de la ficha: elegir un .yml y editarlo. */
function ConfigPlugin({
  plugin,
  archivoConfig,
  texto,
  ocupado,
  alAbrir,
  alCambiarTexto,
  alGuardar,
}: Readonly<{
  plugin: PluginInfo;
  archivoConfig: string | null;
  texto: string;
  ocupado: boolean;
  alAbrir: (archivo: string) => void;
  alCambiarTexto: (texto: string) => void;
  alGuardar: (evento: React.SubmitEvent) => void;
}>) {
  const cambiarTexto = (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    alCambiarTexto(e.target.value);
  return (
    <div className="space-y-3">
      {plugin.configuraciones.length === 0 ? (
        <p className="text-sm text-dex-muted">
          Este plugin no tiene archivos .yml editables (o aún no los
          ha creado).
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2 text-sm">
          {plugin.configuraciones.map((c) => (
            <BotonDeArchivo
              key={c}
              archivo={c}
              abierto={archivoConfig === c}
              alAbrir={alAbrir}
            />
          ))}
        </ul>
      )}
      {archivoConfig ? (
        <form onSubmit={alGuardar} className="space-y-3">
          <textarea
            value={texto}
            onChange={cambiarTexto}
            rows={16}
            spellCheck={false}
            aria-label={`Contenido de ${archivoConfig}`}
            className={`${CLASE_CAMPO} ${MONO} text-xs leading-relaxed`}
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
  );
}

/** Ficha del plugin elegido: cabecera con habilitar/deshabilitar y sus tres pestañas. */
function FichaPlugin({
  plugin,
  vista,
  ocupado,
  archivoConfig,
  texto,
  alCambiarVista,
  alCambiarEstado,
  alAbrirConfig,
  alCambiarTexto,
  alGuardarConfig,
}: Readonly<{
  plugin: PluginInfo;
  vista: VistaPlugin;
  ocupado: boolean;
  archivoConfig: string | null;
  texto: string;
  alCambiarVista: (vista: VistaPlugin) => void;
  alCambiarEstado: (p: PluginInfo, habilitado: boolean) => void;
  alAbrirConfig: (archivo: string) => void;
  alCambiarTexto: (texto: string) => void;
  alGuardarConfig: (evento: React.SubmitEvent) => void;
}>) {
  const alternar = () => alCambiarEstado(plugin, !plugin.habilitado);
  const vistas: [VistaPlugin, string][] = [
    ["info", "Información"],
    ["config", `Configuración (${plugin.configuraciones.length})`],
    ["registro", "Registro"],
  ];
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg text-dex-ink">
            {plugin.nombre}
            {plugin.version ? (
              <span className="text-dex-muted"> {plugin.version}</span>
            ) : null}
          </h2>
          {plugin.descripcion ? (
            <p className="text-sm text-dex-muted">{plugin.descripcion}</p>
          ) : null}
        </div>
        {plugin.protegido ? (
          <span className="text-xs text-dex-muted">
            Plugin de VTuberDex: no se puede apagar desde la web
          </span>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={alternar}
            className={CLASE_BOTON.secundario}
          >
            {plugin.habilitado ? "Deshabilitar" : "Habilitar"}
          </button>
        )}
      </div>

      <div
        role="tablist"
        aria-label={`Secciones de ${plugin.nombre}`}
        className="flex gap-1 border-b border-dex-line text-sm"
      >
        {vistas.map(([id, titulo]) => (
          <BotonDeVista
            key={id}
            id={id}
            titulo={titulo}
            activa={vista === id}
            alElegir={alCambiarVista}
          />
        ))}
      </div>

      {vista === "info" ? <InfoPlugin plugin={plugin} /> : null}

      {vista === "config" ? (
        <ConfigPlugin
          plugin={plugin}
          archivoConfig={archivoConfig}
          texto={texto}
          ocupado={ocupado}
          alAbrir={alAbrirConfig}
          alCambiarTexto={alCambiarTexto}
          alGuardar={alGuardarConfig}
        />
      ) : null}

      {vista === "registro" ? <VisorRegistro plugin={plugin.nombre} /> : null}
    </>
  );
}

export function SeccionPlugins({
  respaldo,
  children,
}: Readonly<{
  /** Nombres de jar del estado general: se usan si la API detallada no responde. */
  respaldo: string[];
  /** Formulario de subida, que vive en el panel porque comparte su aviso y su estado de «ocupado». */
  children?: React.ReactNode;
}>) {
  const [lista, setLista] = useState<PluginInfo[] | null>(null);
  const [elegido, setElegido] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaPlugin>("info");
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

  const plugins: PluginInfo[] = lista ?? pluginsDeRespaldo(respaldo);
  const actual = plugins.find((p) => p.archivo === elegido) ?? null;

  // Manejadores en `useCallback`: van a la fila y a la ficha del plugin, y recreados en cada
  // render obligaban a repintar la lista entera al teclear en la configuración.
  const cambiarEstado = useCallback(
    async (p: PluginInfo, habilitado: boolean) => {
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
    },
    [cargar],
  );
  const cambiarEstadoSinEsperar = useCallback(
    (p: PluginInfo, habilitado: boolean) => void cambiarEstado(p, habilitado),
    [cambiarEstado],
  );

  const abrirConfig = useCallback(async (archivo: string) => {
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
  }, []);
  const abrirConfigSinEsperar = useCallback(
    (archivo: string) => void abrirConfig(archivo),
    [abrirConfig],
  );

  const guardarConfig = useCallback(
    async (evento: React.SubmitEvent) => {
      evento.preventDefault();
      if (!archivoConfig) {
        return;
      }
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
    },
    [archivoConfig, texto],
  );

  const elegir = useCallback((p: PluginInfo) => {
    setElegido(p.archivo);
    setVista("info");
    setArchivoConfig(null);
    setTexto("");
    setError(null);
    setAviso(null);
  }, []);

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
                <FilaPlugin
                  key={p.archivo}
                  plugin={p}
                  elegido={elegido === p.archivo}
                  conEstado={lista !== null}
                  alElegir={elegir}
                />
              ))}
            </ul>
          )}
        </section>

        <section className={`${CLASE_TARJETA} space-y-4 lg:col-span-3`}>
          {actual ? (
            <FichaPlugin
              plugin={actual}
              vista={vista}
              ocupado={ocupado}
              archivoConfig={archivoConfig}
              texto={texto}
              alCambiarVista={setVista}
              alCambiarEstado={cambiarEstadoSinEsperar}
              alAbrirConfig={abrirConfigSinEsperar}
              alCambiarTexto={setTexto}
              alGuardarConfig={guardarConfig}
            />
          ) : (
            <p className="text-sm text-dex-muted">
              Elige un plugin de la lista para ver su ficha, editar su
              configuración y leer su registro.
            </p>
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
