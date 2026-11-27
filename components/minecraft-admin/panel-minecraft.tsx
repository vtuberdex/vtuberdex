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
 *
 * Las llamadas a la API van en funciones de módulo (lanzan con el mensaje del servidor) y la vista
 * en piezas con nombre (`pestana-servidor.tsx` y las de abajo): el panel era una sola función con
 * decenas de ramas anidadas.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  PestanaServidor,
  REFRESCO_MS,
  estadoDelServidor,
  type Historial,
  type LineaDeConsola,
  type Panorama,
} from "./pestana-servidor";
import { EspacioArchivos } from "./ide/espacio-archivos";
import { SeccionConsola } from "./seccion-consola";
import { SeccionEventos } from "./seccion-eventos";
import { SeccionExperiencia } from "./seccion-experiencia";
import { CLASE_BOTON, CLASE_CAMPO, CLASE_TARJETA, Pildora } from "./ui";

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
type Pestana = "servidor" | "archivos" | "experiencia" | "eventos";

/**
 * Tres pestañas: la consola se unió a «Servidor» (registro, comandos y moderación en el mismo
 * sitio) y «Plugins» se unió a «Archivos» (2026-11-20): un espacio tipo VS Code sobre toda la
 * carpeta del servidor (explorador, editor Monaco y terminal) donde los jars de `plugins/` muestran
 * si están activos y se activan desde el propio árbol. Ver `ide/espacio-archivos.tsx`.
 */
const PESTANAS: { id: Pestana; titulo: string }[] = [
  { id: "servidor", titulo: "Servidor" },
  { id: "archivos", titulo: "Archivos y plugins" },
  { id: "experiencia", titulo: "Experiencia" },
  { id: "eventos", titulo: "Eventos de XP" },
];

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

/** Lanza con el mensaje del servidor (o el de respaldo) si la respuesta no es 2xx. */
async function exigirOk(r: Response, porDefecto: string): Promise<Response> {
  if (!r.ok) {
    throw new Error(await leerError(r, porDefecto));
  }
  return r;
}

const mensajeDe = (e: unknown, porDefecto: string) =>
  e instanceof Error ? e.message : porDefecto;

/**
 * Una pasada del panorama. `"fuera"` = la sesión caducó; `null` = nada que pintar (error, o una
 * respuesta que no es un panorama: un proxy, un error de otra ruta).
 */
async function pedirPanorama(): Promise<Panorama | "fuera" | null> {
  const r = await fetch("/api/minecraft-admin/panorama", { cache: "no-store" });
  if (r.status === 401) {
    return "fuera";
  }
  if (!r.ok) {
    return null;
  }
  const p = (await r.json()) as Panorama;
  if (!p || typeof p.rcon !== "string" || !p.sistema) {
    return null;
  }
  return p;
}

/** Suma el último panorama a las gráficas (un valor que falta no deja hueco: se salta). */
function sumarAlHistorial(h: Historial, p: Panorama): Historial {
  const dentro = (lista: number[], v: number | undefined | null) =>
    v == null ? lista : [...lista, v].slice(-PUNTOS_HISTORIAL);
  return {
    tps: dentro(h.tps, p.tps?.[0]),
    jugadores: dentro(h.jugadores, p.jugadores?.enLinea),
    mspt: dentro(h.mspt, p.mspt?.promedio),
  };
}

/** Pide una acción RCON. `"fuera"` = sesión caducada; si no, lo que va al registro. */
async function pedirAccion(
  accion: string,
  datos: Record<string, string>,
): Promise<"fuera" | { salida: string; ok: boolean }> {
  try {
    const r = await fetch("/api/minecraft-admin/rcon", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accion, ...datos }),
    });
    if (r.status === 401) {
      return "fuera";
    }
    if (!r.ok) {
      return {
        salida: await leerError(r, "no se pudo ejecutar la acción"),
        ok: false,
      };
    }
    const cuerpo = (await r.json()) as { respuesta?: string };
    return { salida: cuerpo.respuesta?.trim() || "(sin respuesta)", ok: true };
  } catch (e) {
    return { salida: mensajeDe(e, "no se pudo ejecutar la acción"), ok: false };
  }
}

/** Formulario del correo: lo único que se ve sin sesión. */
function FormularioDeEntrada({
  email,
  ocupado,
  aviso,
  error,
  alCambiarEmail,
  alEnviar,
}: Readonly<{
  email: string;
  ocupado: boolean;
  aviso: string | null;
  error: string | null;
  alCambiarEmail: (email: string) => void;
  alEnviar: (evento: React.SubmitEvent) => void;
}>) {
  const cambiar = (e: React.ChangeEvent<HTMLInputElement>) =>
    alCambiarEmail(e.target.value);
  return (
    <div className="mx-auto max-w-md space-y-6 py-16">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl text-dex-ink">Mantenedor de Minecraft</h1>
        <p className="text-sm text-dex-muted">
          Estado del servidor en vivo, plugins y configuración. El acceso se
          abre con un enlace de un solo uso enviado al correo del mantenedor.
        </p>
      </header>
      <section className={`${CLASE_TARJETA} space-y-4`}>
        <h2 className="text-lg text-dex-ink">Entrar con enlace mágico</h2>
        <form onSubmit={alEnviar} className="space-y-3">
          <label className="block text-sm">
            <span className="sr-only">Correo</span>
            <input
              type="email"
              required
              value={email}
              onChange={cambiar}
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
        <Mensajes aviso={aviso} error={error} />
      </section>
    </div>
  );
}

/** El aviso (verde) y el error (rojo, con rol de alerta) de la última operación. */
function Mensajes({
  aviso,
  error,
}: Readonly<{ aviso: string | null; error: string | null }>) {
  return (
    <>
      {aviso ? <p className="text-sm text-emerald-400">{aviso}</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-400">
          {error}
        </p>
      ) : null}
    </>
  );
}

/** Un botón de la lista de pestañas. */
function BotonDePestana({
  id,
  titulo,
  activa,
  alElegir,
}: Readonly<{
  id: Pestana;
  titulo: string;
  activa: boolean;
  alElegir: (id: Pestana) => void;
}>) {
  const elegir = () => alElegir(id);
  const clase = activa
    ? "bg-dex-accent/15 text-dex-accent"
    : "text-dex-muted hover:bg-dex-panel-soft hover:text-dex-ink";
  return (
    <button
      type="button"
      role="tab"
      aria-selected={activa}
      onClick={elegir}
      className={`flex-1 whitespace-nowrap rounded-xl px-4 py-2 text-left text-sm transition lg:flex-none ${clase}`}
    >
      {titulo}
    </button>
  );
}

/** Columna izquierda: título, estado del servidor, pestañas y reinicio. */
function BarraLateral({
  panorama,
  esAdmin,
  pestana,
  ocupado,
  cuentaReinicio,
  alElegirPestana,
  alReiniciar,
  alCancelarReinicio,
}: Readonly<{
  panorama: Panorama | null;
  esAdmin: boolean;
  pestana: Pestana;
  ocupado: boolean;
  cuentaReinicio: number | null;
  alElegirPestana: (id: Pestana) => void;
  alReiniciar: () => void;
  alCancelarReinicio: () => void;
}>) {
  const estadoServidor = estadoDelServidor(panorama);
  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <div className="mb-4 space-y-2">
        <h1 className="text-2xl leading-tight text-dex-ink">
          Mantenedor de Minecraft
        </h1>
        <Pildora tono={estadoServidor.tono}>{estadoServidor.texto}</Pildora>
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
        {PESTANAS.filter(
          (p) => esAdmin || (p.id !== "experiencia" && p.id !== "eventos"),
        ).map((p) => (
          <BotonDePestana
            key={p.id}
            id={p.id}
            titulo={p.titulo}
            activa={pestana === p.id}
            alElegir={alElegirPestana}
          />
        ))}
      </div>
      <div className="mt-4 space-y-2 rounded-2xl border border-dex-line bg-dex-panel/60 p-3">
        <p className="text-xs text-dex-muted">
          Los cambios de plugins y configuración se aplican al reiniciar.
        </p>
        {cuentaReinicio === null ? (
          <button
            type="button"
            disabled={ocupado}
            onClick={alReiniciar}
            className={`${CLASE_BOTON.peligro} w-full`}
          >
            Reiniciar servidor
          </button>
        ) : (
          <button
            type="button"
            onClick={alCancelarReinicio}
            className={`${CLASE_BOTON.secundario} w-full`}
          >
            Cancelar ({cuentaReinicio} s)
          </button>
        )}
      </div>
    </aside>
  );
}

export function PanelMinecraftAdmin() {
  const [estado, setEstado] = useState<Estado>(ESTADO_VACIO);
  const [sesion, setSesion] = useState<Sesion>("comprobando");
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const esAdmin = estado.rol === "admin";
  const [pestana, setPestana] = useState<Pestana>("servidor");
  const [anuncio, setAnuncio] = useState("");
  const [jugador, setJugador] = useState("");
  const [motivo, setMotivo] = useState("");
  const [consola, setConsola] = useState<LineaDeConsola[]>([]);
  /** Contador de las líneas del registro: su clave estable. */
  const siguienteLinea = useRef(0);

  const [panorama, setPanorama] = useState<Panorama | null>(null);
  const [historial, setHistorial] = useState<Historial>({
    tps: [],
    jugadores: [],
    mspt: [],
  });
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
      return undefined;
    }
    let activo = true;
    const consultar = async () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      try {
        const p = await pedirPanorama();
        if (!activo || p === null) {
          return;
        }
        if (p === "fuera") {
          setSesion("fuera");
          return;
        }
        setPanorama(p);
        setHace(0);
        setHistorial((h) => sumarAlHistorial(h, p));
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

  // Los manejadores van en `useCallback`: se pasan a las pestañas y, recreados en cada render (el
  // panorama se refresca cada pocos segundos), obligaban a repintar todos sus hijos sin motivo.

  /** Pide una acción al servidor y la anota en el registro con su respuesta (o su error). */
  const ejecutar = useCallback(
    async (
      accion: string,
      datos: Record<string, string> = {},
      etiqueta: string = accion,
    ) => {
      setError(null);
      setAviso(null);
      setOcupado(true);
      try {
        const resultado = await pedirAccion(accion, datos);
        if (resultado === "fuera") {
          setSesion("fuera");
          return;
        }
        const id = siguienteLinea.current;
        siguienteLinea.current += 1;
        setConsola((c) => [...c, { id, comando: etiqueta, ...resultado }]);
      } finally {
        setOcupado(false);
      }
    },
    [],
  );
  const ejecutarSinEsperar = useCallback(
    (accion: string, datos?: Record<string, string>, etiqueta?: string) =>
      void ejecutar(accion, datos, etiqueta),
    [ejecutar],
  );

  // Cuenta atrás del reinicio: da 15 s a los jugadores tras el aviso y luego manda `stop` (acción
  // fija `reiniciar`). El servicio de systemd lo vuelve a levantar solo (`Restart=always`).
  useEffect(() => {
    if (cuentaReinicio === null) {
      return undefined;
    }
    if (cuentaReinicio <= 0) {
      setCuentaReinicio(null);
      void ejecutar("reiniciar", {}, "reiniciar el servidor");
      return undefined;
    }
    const t = setTimeout(() => setCuentaReinicio((c) => (c ?? 1) - 1), 1000);
    return () => clearTimeout(t);
    // `ejecutar` es estable (`useCallback` sin dependencias): la cuenta solo depende de sí misma.
  }, [cuentaReinicio, ejecutar]);

  // El enlace mágico llega en el fragmento (`#t=...`): no viaja al servidor, y aquí se canjea.
  useEffect(() => {
    const trozo = /t=([A-Za-z0-9_-]+)/.exec(window.location.hash);
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

  /**
   * Las operaciones con formulario comparten la misma envoltura: limpian los mensajes, bloquean los
   * botones mientras dura y muestran el error de la API (o el de respaldo) si algo falla.
   */
  const operar = useCallback(
    async (tarea: () => Promise<void>, porDefecto: string) => {
      setError(null);
      setAviso(null);
      setOcupado(true);
      try {
        await tarea();
      } catch (e) {
        setError(mensajeDe(e, porDefecto));
      } finally {
        setOcupado(false);
      }
    },
    [],
  );

  const iniciarReinicio = useCallback(() => {
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
  }, [ejecutar]);
  const cancelarReinicio = useCallback(() => setCuentaReinicio(null), []);

  const anunciar = useCallback(
    (evento: React.SubmitEvent) => {
      evento.preventDefault();
      const limpio = anuncio.trim();
      if (!limpio) {
        return;
      }
      setAnuncio("");
      void ejecutar("anunciar", { mensaje: limpio }, `anunciar: ${limpio}`);
    },
    [anuncio, ejecutar],
  );

  const sobreJugador = useCallback(
    (accion: string, etiqueta: string) => {
      const nombre = jugador.trim();
      if (!/^[A-Za-z0-9_.]{1,20}$/.test(nombre)) {
        setError(
          "escribe el nombre exacto del jugador (letras, números, _ o .)",
        );
        return;
      }
      setError(null);
      const razon = motivo.trim();
      const conMotivo = razon ? ` (${razon})` : "";
      void ejecutar(
        accion,
        { jugador: nombre, motivo: razon },
        `${etiqueta} ${nombre}${conMotivo}`,
      );
    },
    [jugador, motivo, ejecutar],
  );

  const pedirEnlace = useCallback(
    (evento: React.SubmitEvent) => {
      evento.preventDefault();
      return operar(async () => {
        await exigirOk(
          await fetch("/api/minecraft-admin/enlace", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email }),
          }),
          "no se pudo enviar el enlace",
        );
        setAviso(
          "Si el correo puede administrar el servidor, el enlace va en camino.",
        );
      }, "no se pudo enviar el enlace");
    },
    [email, operar],
  );

  // Una vista por pestaña en una tabla (y no seis ternarios en el JSX): crear los elementos no
  // monta nada, solo se pinta el de la pestaña elegida.
  const vistas: Record<Pestana, React.ReactNode> = {
    servidor: (
      <>
        <PestanaServidor
          panorama={panorama}
          historial={historial}
          hace={hace}
          ocupado={ocupado}
          esAdmin={esAdmin}
          jugador={jugador}
          motivo={motivo}
          anuncio={anuncio}
          consola={consola}
          alCambiarJugador={setJugador}
          alCambiarMotivo={setMotivo}
          alCambiarAnuncio={setAnuncio}
          alAnunciar={anunciar}
          alModerar={sobreJugador}
          ejecutar={ejecutarSinEsperar}
        />
        <SeccionConsola esAdmin={esAdmin} />
      </>
    ),
    archivos: <EspacioArchivos />,
    experiencia: esAdmin ? <SeccionExperiencia /> : null,
    eventos: esAdmin ? <SeccionEventos /> : null,
  };

  if (sesion === "comprobando") {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        <p className="py-24 text-center text-sm text-dex-muted">
          Comprobando la sesión…
        </p>
      </main>
    );
  }

  if (sesion === "fuera") {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-6">
        <FormularioDeEntrada
          email={email}
          ocupado={ocupado}
          aviso={aviso}
          error={error}
          alCambiarEmail={setEmail}
          alEnviar={pedirEnlace}
        />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6">
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <BarraLateral
          panorama={panorama}
          esAdmin={esAdmin}
          pestana={pestana}
          ocupado={ocupado}
          cuentaReinicio={cuentaReinicio}
          alElegirPestana={setPestana}
          alReiniciar={iniciarReinicio}
          alCancelarReinicio={cancelarReinicio}
        />

        <div className="min-w-0 space-y-6">
          {vistas[pestana]}

          <Mensajes aviso={aviso} error={error} />
        </div>
      </div>
    </main>
  );
}
