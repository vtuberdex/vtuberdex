// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Panel de `/minecraft-admin`: pedir el enlace mágico y, SOLO con la sesión abierta, operar el
 * servidor (RCON), ver/subir plugins y editar la configuración.
 *
 * Mientras no hay sesión no se pinta ningún dato ni control del mantenedor: ni siquiera la
 * estructura de pestañas. Antes el bloque de plugins y configuración quedaba fuera de la
 * condición y se veía desde el formulario del correo.
 *
 * Todo pasa por `/api/minecraft-admin/*`. Si la sesión no tiene el rol `mantenedor`, la API
 * responde 401 o 403 y el panel vuelve al formulario del correo: esconder los botones no sería
 * una protección, solo una molestia.
 */
import { useCallback, useEffect, useState } from "react";

import { SeccionArchivos } from "./seccion-archivos";
import { SeccionConsola } from "./seccion-consola";
import { SeccionExperiencia } from "./seccion-experiencia";
import { SeccionPlugins } from "./seccion-plugins";
import {
  CLASE_BOTON,
  CLASE_CAMPO,
  CLASE_CAMPO_MONO,
  CLASE_TARJETA,
  Indicador,
  Pildora,
  Seccion,
  type Tono,
} from "./ui";

type Estado = {
  plugins: string[];
  pluginsDetalle?: {
    nombre: string;
    bytes: number;
    modificado: string | null;
  }[];
  configuraciones: string[];
  servidor: boolean;
  directorio?: string;
  /** false cuando el servicio web no puede abrir la carpeta de plugins (falta permiso o ruta). */
  legible?: boolean;
  /** Solo decide qué se muestra; el servidor hace cumplir cada permiso por su cuenta. */
  rol?: "admin" | "mantenedor";
};

type Sesion = "comprobando" | "dentro" | "fuera";
type Pestana =
  | "servidor"
  | "plugins"
  | "configuracion"
  | "archivos"
  | "consola"
  | "experiencia";

const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: "servidor", titulo: "Servidor" },
  { id: "plugins", titulo: "Plugins" },
  { id: "configuracion", titulo: "Configuración" },
  { id: "archivos", titulo: "Archivos" },
  { id: "consola", titulo: "Consola" },
  { id: "experiencia", titulo: "Experiencia" },
];

/**
 * Acciones de un clic. El navegador manda el NOMBRE de la acción, nunca un comando: el servidor
 * arma el comando (`lib/minecraft-rcon.mjs`). La consola con comandos va aparte (pestaña «Consola»), con lista blanca para mantenedores.
 */
const ACCIONES_RAPIDAS: { titulo: string; accion: string; ayuda: string }[] = [
  { titulo: "Quién juega", accion: "jugadores", ayuda: "Jugadores conectados" },
  {
    titulo: "Guardar mundo",
    accion: "guardar",
    ayuda: "Escribe el mundo a disco ya",
  },
  {
    titulo: "Recargar lista blanca",
    accion: "lista-blanca-recargar",
    ayuda: "Relee whitelist.json",
  },
  { titulo: "Día", accion: "dia", ayuda: "Pone el mediodía" },
  {
    titulo: "Despejar clima",
    accion: "clima-despejado",
    ayuda: "Quita lluvia y tormenta",
  },
  {
    titulo: "Ver plugins",
    accion: "plugins",
    ayuda: "Plugins cargados en el servidor",
  },
];

type Panorama = {
  hora: string;
  rcon: "ok" | "caido" | "sin_configurar";
  jugadores: { enLinea: number; maximo: number; nombres: string[] } | null;
  tps: number[] | null;
  mspt: { promedio: number; minimo: number; maximo: number } | null;
  sistema: {
    cargaPorNucleo: number;
    nucleos: number;
    memoriaUsadaMb: number;
    memoriaTotalMb: number;
    encendidoHoras: number;
  };
};

/** Cada cuánto se repregunta al servidor mientras la pestaña está a la vista. */
const REFRESCO_MS = 5000;
/** Puntos que guardan las gráficas (5 s × 36 = 3 minutos). */
const PUNTOS_HISTORIAL = 36;

const ESTADO_VACIO: Estado = {
  plugins: [],
  pluginsDetalle: [],
  configuraciones: [],
  servidor: false,
};

const leerError = async (r: Response, porDefecto: string) => {
  const cuerpo = (await r.json().catch(() => null)) as {
    error?: string;
  } | null;
  return cuerpo?.error ?? porDefecto;
};

export function PanelMinecraftAdmin() {
  const [estado, setEstado] = useState<Estado>(ESTADO_VACIO);
  const [sesion, setSesion] = useState<Sesion>("comprobando");
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const [archivo, setArchivo] = useState<File | null>(null);
  const [destino, setDestino] = useState<"servidor" | "plugin">("servidor");
  const [nombreConfig, setNombreConfig] = useState("config.yml");
  const [texto, setTexto] = useState("");

  const esAdmin = estado.rol === "admin";
  const [pestana, setPestana] = useState<Pestana>("servidor");
  const [anuncio, setAnuncio] = useState("");
  const [jugador, setJugador] = useState("");
  const [motivo, setMotivo] = useState("");
  const [consola, setConsola] = useState<
    { comando: string; salida: string; ok: boolean }[]
  >([]);

  const [panorama, setPanorama] = useState<Panorama | null>(null);
  const [historial, setHistorial] = useState<{
    tps: number[];
    jugadores: number[];
    mspt: number[];
  }>({ tps: [], jugadores: [], mspt: [] });
  const [hace, setHace] = useState(0);
  /** Segundos que faltan para reiniciar (null = no hay reinicio en marcha). */
  const [cuentaReinicio, setCuentaReinicio] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    const r = await fetch("/api/minecraft-admin/estado", { cache: "no-store" });
    if (r.status === 401 || r.status === 403) {
      setSesion("fuera");
      return;
    }
    if (!r.ok) {
      setSesion("dentro");
      setError(await leerError(r, "no se pudo leer el estado"));
      return;
    }
    setSesion("dentro");
    setEstado((await r.json()) as Estado);
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Panorama «casi en vivo»: se repregunta cada pocos segundos, solo con la sesión abierta y la
  // pestaña visible (una pestaña olvidada no debe mantener al servidor contestando RCON).
  useEffect(() => {
    if (sesion !== "dentro") {
      return;
    }
    let activo = true;
    const consultar = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      try {
        const r = await fetch("/api/minecraft-admin/panorama", {
          cache: "no-store",
        });
        if (r.status === 401) {
          if (activo) {
            setSesion("fuera");
          }
          return;
        }
        if (!r.ok || !activo) {
          return;
        }
        const p = (await r.json()) as Panorama;
        // Una respuesta que no es un panorama (proxy, error de otra ruta) no se pinta.
        if (!p || typeof p.rcon !== "string" || !p.sistema) {
          return;
        }
        setPanorama(p);
        setHace(0);
        setHistorial((h) => {
          const dentro = (lista: number[], v: number | undefined | null) =>
            v == null ? lista : [...lista, v].slice(-PUNTOS_HISTORIAL);
          return {
            tps: dentro(h.tps, p.tps?.[0]),
            jugadores: dentro(h.jugadores, p.jugadores?.enLinea),
            mspt: dentro(h.mspt, p.mspt?.promedio),
          };
        });
      } catch {
        /* una caída puntual no rompe el panel: se reintenta en el siguiente ciclo */
      }
    };
    void consultar();
    const ciclo = setInterval(() => void consultar(), REFRESCO_MS);
    const reloj = setInterval(() => setHace((n) => n + 1), 1000);
    return () => {
      activo = false;
      clearInterval(ciclo);
      clearInterval(reloj);
    };
  }, [sesion]);

  // Cuenta atrás del reinicio: da 15 s a los jugadores tras el aviso y luego manda `stop` (acción
  // fija `reiniciar`). El servicio de systemd lo vuelve a levantar solo (`Restart=always`).
  useEffect(() => {
    if (cuentaReinicio === null) {
      return;
    }
    if (cuentaReinicio <= 0) {
      setCuentaReinicio(null);
      void ejecutar("reiniciar", {}, "reiniciar el servidor");
      return;
    }
    const t = setTimeout(() => setCuentaReinicio((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
    // `ejecutar` se redefine en cada render; la cuenta solo depende de sí misma.
  }, [cuentaReinicio]);

  // El enlace mágico llega en el fragmento (`#t=...`): no viaja al servidor, y aquí se canjea.
  useEffect(() => {
    const trozo = window.location.hash.match(/t=([A-Za-z0-9_-]+)/);
    if (!trozo) {
      return;
    }
    const token = trozo[1];
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      const r = await fetch("/api/minecraft-admin/sesion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (r.ok) {
        await cargar();
      } else {
        setError("el enlace caducó o ya se usó: pide otro");
      }
    })();
  }, [cargar]);

  /** Pide una acción al servidor y la anota en el registro con su respuesta (o su error). */
  const ejecutar = async (
    accion: string,
    datos: Record<string, string> = {},
    texto: string = accion,
  ) => {
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/rcon", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accion, ...datos }),
      });
      if (r.status === 401) {
        setSesion("fuera");
        return;
      }
      if (!r.ok) {
        const motivoError = await leerError(r, "no se pudo ejecutar la acción");
        setConsola((c) => [
          ...c,
          { comando: texto, salida: motivoError, ok: false },
        ]);
        return;
      }
      const cuerpo = (await r.json()) as { respuesta?: string };
      setConsola((c) => [
        ...c,
        {
          comando: texto,
          salida: cuerpo.respuesta?.trim() || "(sin respuesta)",
          ok: true,
        },
      ]);
    } catch (e) {
      const m =
        e instanceof Error ? e.message : "no se pudo ejecutar la acción";
      setConsola((c) => [...c, { comando: texto, salida: m, ok: false }]);
    } finally {
      setOcupado(false);
    }
  };

  const iniciarReinicio = () => {
    if (
      !window.confirm(
        "¿Reiniciar el servidor de Minecraft? Se avisa a los jugadores, el mundo se guarda y vuelve en ~1 minuto.",
      )
    ) {
      return;
    }
    void ejecutar(
      "anunciar",
      { mensaje: "El servidor se reiniciará en 15 segundos" },
      "aviso de reinicio",
    );
    setCuentaReinicio(15);
  };

  const anunciar = (evento: React.FormEvent) => {
    evento.preventDefault();
    const limpio = anuncio.trim();
    if (!limpio) {
      return;
    }
    setAnuncio("");
    void ejecutar("anunciar", { mensaje: limpio }, `anunciar: ${limpio}`);
  };

  const sobreJugador = (accion: string, etiqueta: string) => {
    const nombre = jugador.trim();
    if (!/^[A-Za-z0-9_.]{1,20}$/.test(nombre)) {
      setError("escribe el nombre exacto del jugador (letras, números, _ o .)");
      return;
    }
    setError(null);
    const razon = motivo.trim();
    void ejecutar(
      accion,
      { jugador: nombre, motivo: razon },
      `${etiqueta} ${nombre}${razon ? ` (${razon})` : ""}`,
    );
  };

  const pedirEnlace = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/enlace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!r.ok) {
        throw new Error(await leerError(r, "no se pudo enviar el enlace"));
      }
      setAviso(
        "Si el correo puede administrar el servidor, el enlace va en camino.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo enviar el enlace");
    } finally {
      setOcupado(false);
    }
  };

  const subir = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    if (!archivo) {
      setError("elige un archivo .jar");
      return;
    }
    setOcupado(true);
    try {
      const nombre = encodeURIComponent(archivo.name);
      const r = await fetch(`/api/minecraft-admin/plugins?nombre=${nombre}`, {
        method: "POST",
        headers: { "content-type": "application/java-archive" },
        body: archivo,
      });
      if (!r.ok) {
        throw new Error(await leerError(r, "no se pudo subir el plugin"));
      }
      const meta = (await r.json()) as { plugin?: string };
      setAviso(`Plugin guardado: ${meta.plugin ?? archivo.name}`);
      setArchivo(null);
      await cargar();
    } catch (e) {
      setError(e instanceof Error ? e.message : "no se pudo subir el plugin");
    } finally {
      setOcupado(false);
    }
  };

  const abrirConfiguracion = async () => {
    setError(null);
    setAviso(null);
    const parametros = new URLSearchParams({ tipo: destino });
    if (destino === "plugin") {
      parametros.set("archivo", nombreConfig);
    }
    const r = await fetch(`/api/minecraft-admin/configuracion?${parametros}`, {
      cache: "no-store",
    });
    if (!r.ok) {
      setError(await leerError(r, "no se pudo abrir la configuración"));
      return;
    }
    const cuerpo = (await r.json()) as { contenido?: string };
    setTexto(cuerpo.contenido ?? "");
  };

  const guardarConfiguracion = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setError(null);
    setAviso(null);
    setOcupado(true);
    try {
      const r = await fetch("/api/minecraft-admin/configuracion", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tipo: destino,
          archivo: destino === "plugin" ? nombreConfig : undefined,
          contenido: texto,
        }),
      });
      if (!r.ok) {
        throw new Error(
          await leerError(r, "no se pudo guardar la configuración"),
        );
      }
      setAviso("Configuración guardada.");
      await cargar();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "no se pudo guardar la configuración",
      );
    } finally {
      setOcupado(false);
    }
  };

  const tonoTps: Tono = !panorama?.tps
    ? "neutro"
    : panorama.tps[0] >= 19
      ? "bien"
      : panorama.tps[0] >= 15
        ? "ojo"
        : "mal";
  const tonoMspt: Tono = !panorama?.mspt
    ? "neutro"
    : panorama.mspt.promedio < 35
      ? "bien"
      : panorama.mspt.promedio < 50
        ? "ojo"
        : "mal";
  const tonoMaquina: Tono = !panorama
    ? "neutro"
    : panorama.sistema.cargaPorNucleo > 1.5
      ? "mal"
      : panorama.sistema.cargaPorNucleo > 0.9
        ? "ojo"
        : "bien";
  const estadoServidor: { tono: Tono; texto: string } = !panorama
    ? { tono: "neutro", texto: "Consultando…" }
    : panorama.rcon === "ok"
      ? { tono: "bien", texto: "Servidor en línea" }
      : panorama.rcon === "sin_configurar"
        ? { tono: "ojo", texto: "RCON sin configurar" }
        : { tono: "mal", texto: "Servidor sin respuesta" };

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      {sesion === "comprobando" ? (
        <p className="py-24 text-center text-sm text-dex-muted">
          Comprobando la sesión…
        </p>
      ) : null}

      {sesion === "fuera" ? (
        <div className="mx-auto max-w-md space-y-6 py-16">
          <header className="space-y-2 text-center">
            <h1 className="text-3xl text-dex-ink">Mantenedor de Minecraft</h1>
            <p className="text-sm text-dex-muted">
              Estado del servidor en vivo, plugins y configuración. El acceso se
              abre con un enlace de un solo uso enviado al correo del
              mantenedor.
            </p>
          </header>
          <section className={`${CLASE_TARJETA} space-y-4`}>
            <h2 className="text-lg text-dex-ink">Entrar con enlace mágico</h2>
            <form onSubmit={pedirEnlace} className="space-y-3">
              <label className="block text-sm">
                <span className="sr-only">Correo</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@example.com"
                  className={CLASE_CAMPO}
                />
              </label>
              <button
                type="submit"
                disabled={ocupado}
                className={`${CLASE_BOTON.primario} w-full`}
              >
                Enviarme el enlace
              </button>
            </form>
            {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
            {error ? (
              <p role="alert" className="text-sm text-red-400">
                {error}
              </p>
            ) : null}
          </section>
        </div>
      ) : null}

      {sesion === "dentro" ? (
        <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-4 lg:self-start">
            <div className="mb-4 space-y-2">
              <h1 className="text-2xl leading-tight text-dex-ink">
                Mantenedor de Minecraft
              </h1>
              <Pildora tono={estadoServidor.tono}>
                {estadoServidor.texto}
              </Pildora>
              <p className="text-xs text-dex-muted">
                Sesión: {esAdmin ? "administrador" : "mantenedor"}
              </p>
            </div>
            <div
              role="tablist"
              aria-label="Secciones"
              aria-orientation="vertical"
              className="flex gap-1 overflow-x-auto rounded-2xl border border-dex-line bg-dex-panel/60 p-1.5 lg:flex-col lg:overflow-visible"
            >
              {PESTANAS.filter((p) => esAdmin || p.id !== "experiencia").map(
                (p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="tab"
                    aria-selected={pestana === p.id}
                    onClick={() => setPestana(p.id)}
                    className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-left text-sm transition lg:flex-none ${
                      pestana === p.id
                        ? "bg-dex-accent/15 text-dex-accent"
                        : "text-dex-muted hover:bg-dex-panel-soft hover:text-dex-ink"
                    }`}
                  >
                    {p.titulo}
                  </button>
                ),
              )}
            </div>
            <div className="mt-4 space-y-2 rounded-2xl border border-dex-line bg-dex-panel/60 p-3">
              <p className="text-xs text-dex-muted">
                Los cambios de plugins y configuración se aplican al reiniciar.
              </p>
              {cuentaReinicio === null ? (
                <button
                  type="button"
                  disabled={ocupado}
                  onClick={iniciarReinicio}
                  className={`${CLASE_BOTON.peligro} w-full`}
                >
                  Reiniciar servidor
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setCuentaReinicio(null)}
                  className={`${CLASE_BOTON.secundario} w-full`}
                >
                  Cancelar ({cuentaReinicio} s)
                </button>
              )}
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            {estado.legible === false && pestana !== "servidor" ? (
              <p
                role="alert"
                className="rounded-2xl border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-400"
              >
                El panel no puede leer la carpeta del servidor
                {estado.directorio ? ` (${estado.directorio})` : ""}. Falta
                darle permiso al servicio web o definir VTUBERDEX_MINECRAFT_DIR;
                por eso no aparecen plugins ni archivos de configuración.
              </p>
            ) : null}

            {pestana === "servidor" ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl text-dex-ink">Resumen en vivo</h2>
                  {panorama ? (
                    <span className="text-xs text-dex-muted">
                      actualizado hace {hace} s · cada {REFRESCO_MS / 1000} s
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
                  <Indicador
                    titulo="Jugadores"
                    valor={
                      panorama?.jugadores
                        ? `${panorama.jugadores.enLinea}/${panorama.jugadores.maximo}`
                        : "—"
                    }
                    detalle="conectados ahora"
                    tono="acento"
                    valores={historial.jugadores}
                  />
                  <Indicador
                    titulo="TPS (1 min)"
                    valor={panorama?.tps ? panorama.tps[0].toFixed(1) : "—"}
                    detalle={
                      panorama?.tps
                        ? `5 min ${panorama.tps[1]?.toFixed(1) ?? "—"} · 15 min ${panorama.tps[2]?.toFixed(1) ?? "—"}`
                        : "ticks por segundo (20 = fluido)"
                    }
                    tono={tonoTps}
                    valores={historial.tps}
                  />
                  <Indicador
                    titulo="Tiempo de tick"
                    valor={
                      panorama?.mspt
                        ? `${panorama.mspt.promedio.toFixed(1)} ms`
                        : "—"
                    }
                    detalle={
                      panorama?.mspt
                        ? `mín ${panorama.mspt.minimo.toFixed(1)} · máx ${panorama.mspt.maximo.toFixed(1)} (límite 50 ms)`
                        : "promedio de los últimos 5 s"
                    }
                    tono={tonoMspt}
                    valores={historial.mspt}
                  />
                  <Indicador
                    titulo="Máquina"
                    valor={
                      panorama
                        ? `${Math.round((panorama.sistema.memoriaUsadaMb / panorama.sistema.memoriaTotalMb) * 100)} %`
                        : "—"
                    }
                    detalle={
                      panorama
                        ? `memoria ${panorama.sistema.memoriaUsadaMb}/${panorama.sistema.memoriaTotalMb} MB · carga ${panorama.sistema.cargaPorNucleo} por núcleo (${panorama.sistema.nucleos})`
                        : "memoria y CPU de la VPS"
                    }
                    tono={tonoMaquina}
                  />
                </div>

                <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
                  <div className="min-w-0 space-y-6">
                    <Seccion
                      titulo="En línea ahora"
                      bajada="Elige a alguien para rellenar el formulario de abajo."
                    >
                      {panorama?.jugadores?.nombres.length ? (
                        <ul className="divide-y divide-dex-line text-sm">
                          {panorama.jugadores.nombres.map((nombre) => (
                            <li
                              key={nombre}
                              className="flex items-center justify-between gap-2 py-2"
                            >
                              <span className="flex items-center gap-2 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">
                                <span
                                  aria-hidden="true"
                                  className="size-2 rounded-full bg-emerald-400"
                                />
                                {nombre}
                              </span>
                              <span className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={ocupado}
                                  onClick={() => setJugador(nombre)}
                                  className={CLASE_BOTON.secundario}
                                  aria-label={`Elegir a ${nombre}`}
                                >
                                  Elegir
                                </button>
                                <button
                                  type="button"
                                  disabled={ocupado}
                                  onClick={() =>
                                    void ejecutar(
                                      "expulsar",
                                      { jugador: nombre },
                                      `expulsar ${nombre}`,
                                    )
                                  }
                                  className={CLASE_BOTON.peligro}
                                  aria-label={`Expulsar a ${nombre}`}
                                >
                                  Expulsar
                                </button>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-dex-muted">
                          {panorama
                            ? "No hay nadie conectado."
                            : "Consultando…"}
                        </p>
                      )}
                    </Seccion>

                    <Seccion
                      titulo="Moderar un jugador"
                      bajada="Escribe el nombre exacto de la cuenta."
                    >
                      <div className="grid gap-3 sm:grid-cols-[14rem_1fr]">
                        <input
                          type="text"
                          value={jugador}
                          onChange={(e) => setJugador(e.target.value)}
                          placeholder="Nombre del jugador"
                          aria-label="Nombre del jugador"
                          className={CLASE_CAMPO_MONO}
                        />
                        <input
                          type="text"
                          value={motivo}
                          onChange={(e) => setMotivo(e.target.value)}
                          maxLength={120}
                          placeholder="Motivo (expulsar y vetar)"
                          aria-label="Motivo"
                          className={CLASE_CAMPO_MONO}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(
                          [
                            ["Expulsar", "expulsar", false, "peligro"],
                            ["Vetar", "vetar", true, "peligro"],
                            ["Quitar veto", "quitar-veto", true, "secundario"],
                            [
                              "Añadir a la lista blanca",
                              "lista-blanca-anadir",
                              false,
                              "secundario",
                            ],
                            [
                              "Quitar de la lista blanca",
                              "lista-blanca-quitar",
                              false,
                              "secundario",
                            ],
                          ] as const
                        )
                          .filter(([, , soloAdmin]) => !soloAdmin || esAdmin)
                          .map(([titulo, accion, , estilo]) => (
                            <button
                              key={accion}
                              type="button"
                              disabled={ocupado}
                              onClick={() => sobreJugador(accion, titulo)}
                              className={CLASE_BOTON[estilo]}
                            >
                              {titulo}
                            </button>
                          ))}
                      </div>
                    </Seccion>

                    <Seccion
                      titulo="Acciones rápidas"
                      bajada="Comandos fijos: aquí no se escribe ningún comando."
                    >
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {ACCIONES_RAPIDAS.map((a) => (
                          <button
                            key={a.accion}
                            type="button"
                            title={a.ayuda}
                            aria-label={a.titulo}
                            disabled={ocupado}
                            onClick={() =>
                              void ejecutar(a.accion, {}, a.titulo)
                            }
                            className={`${CLASE_BOTON.secundario} py-3 text-left`}
                          >
                            <span className="block text-dex-ink">
                              {a.titulo}
                            </span>
                            <span className="block text-xs text-dex-muted">
                              {a.ayuda}
                            </span>
                          </button>
                        ))}
                      </div>
                      <form onSubmit={anunciar} className="flex gap-2">
                        <input
                          type="text"
                          value={anuncio}
                          onChange={(e) => setAnuncio(e.target.value)}
                          maxLength={200}
                          placeholder="Mensaje para todos los jugadores"
                          aria-label="Anuncio al servidor"
                          className={CLASE_CAMPO_MONO}
                        />
                        <button
                          type="submit"
                          disabled={ocupado}
                          className={CLASE_BOTON.primario}
                        >
                          Anunciar
                        </button>
                      </form>
                    </Seccion>
                  </div>

                  <Seccion
                    titulo="Registro"
                    bajada="Respuesta de cada acción"
                    className="xl:sticky xl:top-4 xl:self-start"
                  >
                    <pre
                      aria-label="Salida del servidor"
                      className="max-h-[34rem] min-h-40 overflow-auto whitespace-pre-wrap rounded-xl border border-dex-line bg-dex-void p-3 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-xs leading-relaxed text-dex-accent"
                    >
                      {consola.length === 0
                        ? "Aquí aparece la respuesta de cada acción."
                        : consola.map((linea, n) => (
                            <span
                              key={n}
                              className={linea.ok ? "" : "text-red-400"}
                            >
                              {`> ${linea.comando}\n${linea.salida}\n`}
                            </span>
                          ))}
                    </pre>
                  </Seccion>
                </div>
              </>
            ) : null}

            {pestana === "plugins" ? (
              <SeccionPlugins respaldo={estado.plugins ?? []}>
                <Seccion
                  titulo="Subir plugin"
                  bajada="Solo .jar, hasta 50 MB. Un jar es código que corre en el servidor: sube solo plugins de confianza. Queda en la carpeta y se carga al reiniciar."
                >
                  <form
                    onSubmit={subir}
                    className="flex flex-col gap-3 sm:flex-row sm:items-center"
                  >
                    <input
                      type="file"
                      accept=".jar"
                      onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                      className="text-sm text-dex-muted file:mr-3 file:rounded-xl file:border file:border-dex-line file:bg-dex-panel-soft file:px-3 file:py-1.5 file:text-dex-ink"
                    />
                    <button
                      type="submit"
                      disabled={ocupado}
                      className={CLASE_BOTON.primario}
                    >
                      Subir .jar
                    </button>
                  </form>
                </Seccion>
              </SeccionPlugins>
            ) : null}

            {pestana === "archivos" ? <SeccionArchivos /> : null}

            {pestana === "consola" ? (
              <SeccionConsola esAdmin={esAdmin} />
            ) : null}

            {pestana === "experiencia" && esAdmin ? (
              <SeccionExperiencia />
            ) : null}

            {pestana === "configuracion" ? (
              <Seccion
                titulo="Configuración"
                bajada="Se aplica al reiniciar el servidor. Los valores de RCON no se muestran ni se pueden cambiar si no eres admin."
              >
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destino"
                      checked={destino === "servidor"}
                      onChange={() => setDestino("servidor")}
                      className="accent-[var(--color-dex-accent)]"
                    />
                    server.properties
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="destino"
                      checked={destino === "plugin"}
                      onChange={() => setDestino("plugin")}
                      className="accent-[var(--color-dex-accent)]"
                    />
                    Plugin (.yml)
                  </label>
                  {destino === "plugin" ? (
                    <input
                      type="text"
                      value={nombreConfig}
                      onChange={(e) => setNombreConfig(e.target.value)}
                      className={`${CLASE_CAMPO_MONO} !w-56`}
                      aria-label="Archivo del plugin"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={abrirConfiguracion}
                    className={CLASE_BOTON.secundario}
                  >
                    Abrir
                  </button>
                </div>
                <form onSubmit={guardarConfiguracion} className="space-y-3">
                  <textarea
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    rows={18}
                    spellCheck={false}
                    aria-label="Contenido de la configuración"
                    className={`${CLASE_CAMPO} font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace] text-xs leading-relaxed`}
                  />
                  <button
                    type="submit"
                    disabled={ocupado}
                    className={CLASE_BOTON.primario}
                  >
                    Guardar configuración
                  </button>
                </form>
              </Seccion>
            ) : null}

            {true ? (
              <>
                {aviso ? (
                  <p className="text-sm text-emerald-400">{aviso}</p>
                ) : null}
                {error ? (
                  <p role="alert" className="text-sm text-red-400">
                    {error}
                  </p>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </main>
  );
}
