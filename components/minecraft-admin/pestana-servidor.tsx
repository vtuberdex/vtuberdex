// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";

/**
 * Pestaña «Servidor» del mantenedor de Minecraft: el resumen en vivo (jugadores, TPS, tiempo de tick y
 * máquina), quién está conectado, moderar a un jugador, las acciones de un clic y el registro.
 *
 * Es solo vista: el estado (panorama, historial, registro, formularios) y las llamadas a la API viven en
 * `panel-minecraft.tsx`. Se separó porque el panel entero era una sola función con decenas de ramas y
 * ningún cambio se podía leer de un vistazo.
 */
import {
  CLASE_BOTON,
  CLASE_CAMPO_MONO,
  Indicador,
  Seccion,
  type Tono,
} from "./ui";

export type Panorama = {
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

export type Historial = { tps: number[]; jugadores: number[]; mspt: number[] };

/** Una línea del registro. `id` es la clave de React: el texto se repite (dos «Guardar mundo» seguidos). */
export type LineaDeConsola = {
  id: number;
  comando: string;
  salida: string;
  ok: boolean;
};

/** Cada cuánto se repregunta al servidor mientras la pestaña está a la vista. */
export const REFRESCO_MS = 5000;

/** Sin dato = neutro; 19 o más es fluido y bajo 15 el juego ya se nota lento. */
export function tonoDeTps(panorama: Panorama | null): Tono {
  if (!panorama?.tps) {
    return "neutro";
  }
  if (panorama.tps[0] >= 19) {
    return "bien";
  }
  return panorama.tps[0] >= 15 ? "ojo" : "mal";
}

/** Un tick tiene 50 ms: por encima el servidor se atrasa; bajo 35 queda margen. */
export function tonoDeMspt(panorama: Panorama | null): Tono {
  if (!panorama?.mspt) {
    return "neutro";
  }
  if (panorama.mspt.promedio < 35) {
    return "bien";
  }
  return panorama.mspt.promedio < 50 ? "ojo" : "mal";
}

/** Carga por núcleo: sobre 1,5 la VPS está saturada y sobre 0,9 conviene mirar. */
export function tonoDeMaquina(panorama: Panorama | null): Tono {
  if (!panorama) {
    return "neutro";
  }
  if (panorama.sistema.cargaPorNucleo > 1.5) {
    return "mal";
  }
  return panorama.sistema.cargaPorNucleo > 0.9 ? "ojo" : "bien";
}

/** La píldora de la barra lateral: qué dice RCON del servidor. */
export function estadoDelServidor(panorama: Panorama | null): {
  tono: Tono;
  texto: string;
} {
  if (!panorama) {
    return { tono: "neutro", texto: "Consultando…" };
  }
  if (panorama.rcon === "ok") {
    return { tono: "bien", texto: "Servidor en línea" };
  }
  if (panorama.rcon === "sin_configurar") {
    return { tono: "ojo", texto: "RCON sin configurar" };
  }
  return { tono: "mal", texto: "Servidor sin respuesta" };
}

type Ejecutar = (
  accion: string,
  datos?: Record<string, string>,
  etiqueta?: string,
) => void;

/** Botones de moderación: título, acción, si es solo para admin y estilo. */
const MODERACION = [
  ["Expulsar", "expulsar", false, "peligro"],
  ["Vetar", "vetar", true, "peligro"],
  ["Quitar veto", "quitar-veto", true, "secundario"],
  ["Añadir a la lista blanca", "lista-blanca-anadir", false, "secundario"],
  ["Quitar de la lista blanca", "lista-blanca-quitar", false, "secundario"],
] as const;

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

/** Los cuatro indicadores grandes del resumen en vivo. */
function Indicadores({
  panorama,
  historial,
}: Readonly<{ panorama: Panorama | null; historial: Historial }>) {
  const jugadores = panorama?.jugadores;
  const tps = panorama?.tps;
  const mspt = panorama?.mspt;
  const sistema = panorama?.sistema;
  return (
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
      <Indicador
        titulo="Jugadores"
        valor={jugadores ? `${jugadores.enLinea}/${jugadores.maximo}` : "—"}
        detalle="conectados ahora"
        tono="acento"
        valores={historial.jugadores}
      />
      <Indicador
        titulo="TPS (1 min)"
        valor={tps ? tps[0].toFixed(1) : "—"}
        detalle={
          tps
            ? `5 min ${tps[1]?.toFixed(1) ?? "—"} · 15 min ${tps[2]?.toFixed(1) ?? "—"}`
            : "ticks por segundo (20 = fluido)"
        }
        tono={tonoDeTps(panorama)}
        valores={historial.tps}
      />
      <Indicador
        titulo="Tiempo de tick"
        valor={mspt ? `${mspt.promedio.toFixed(1)} ms` : "—"}
        detalle={
          mspt
            ? `mín ${mspt.minimo.toFixed(1)} · máx ${mspt.maximo.toFixed(1)} (límite 50 ms)`
            : "promedio de los últimos 5 s"
        }
        tono={tonoDeMspt(panorama)}
        valores={historial.mspt}
      />
      <Indicador
        titulo="Máquina"
        valor={
          sistema
            ? `${Math.round((sistema.memoriaUsadaMb / sistema.memoriaTotalMb) * 100)} %`
            : "—"
        }
        detalle={
          sistema
            ? `memoria ${sistema.memoriaUsadaMb}/${sistema.memoriaTotalMb} MB · carga ${sistema.cargaPorNucleo} por núcleo (${sistema.nucleos})`
            : "memoria y CPU de la VPS"
        }
        tono={tonoDeMaquina(panorama)}
      />
    </div>
  );
}

/** Una fila de «En línea ahora»: elegir al jugador (rellena el formulario) o expulsarlo. */
function JugadorEnLinea({
  nombre,
  ocupado,
  alElegir,
  ejecutar,
}: Readonly<{
  nombre: string;
  ocupado: boolean;
  alElegir: (nombre: string) => void;
  ejecutar: Ejecutar;
}>) {
  const elegir = () => alElegir(nombre);
  const expulsar = () =>
    ejecutar("expulsar", { jugador: nombre }, `expulsar ${nombre}`);
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <span className="flex items-center gap-2 font-[ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">
        <span aria-hidden="true" className="size-2 rounded-full bg-emerald-400" />
        {nombre}
      </span>
      <span className="flex gap-2">
        <button
          type="button"
          disabled={ocupado}
          onClick={elegir}
          className={CLASE_BOTON.secundario}
          aria-label={`Elegir a ${nombre}`}
        >
          Elegir
        </button>
        <button
          type="button"
          disabled={ocupado}
          onClick={expulsar}
          className={CLASE_BOTON.peligro}
          aria-label={`Expulsar a ${nombre}`}
        >
          Expulsar
        </button>
      </span>
    </li>
  );
}

/** Un botón de moderación: avisa con su acción y su título (el título va al registro). */
function BotonDeModeracion({
  titulo,
  accion,
  estilo,
  ocupado,
  alPulsar,
}: Readonly<{
  titulo: string;
  accion: string;
  estilo: keyof typeof CLASE_BOTON;
  ocupado: boolean;
  alPulsar: (accion: string, titulo: string) => void;
}>) {
  const pulsar = () => alPulsar(accion, titulo);
  return (
    <button
      type="button"
      disabled={ocupado}
      onClick={pulsar}
      className={CLASE_BOTON[estilo]}
    >
      {titulo}
    </button>
  );
}

/** Una acción de un clic: manda su nombre, nunca un comando. */
function BotonDeAccion({
  accion,
  ocupado,
  ejecutar,
}: Readonly<{
  accion: (typeof ACCIONES_RAPIDAS)[number];
  ocupado: boolean;
  ejecutar: Ejecutar;
}>) {
  const pulsar = () => ejecutar(accion.accion, {}, accion.titulo);
  return (
    <button
      type="button"
      title={accion.ayuda}
      aria-label={accion.titulo}
      disabled={ocupado}
      onClick={pulsar}
      className={`${CLASE_BOTON.secundario} py-3 text-left`}
    >
      <span className="block text-dex-ink">{accion.titulo}</span>
      <span className="block text-xs text-dex-muted">{accion.ayuda}</span>
    </button>
  );
}

export function PestanaServidor({
  panorama,
  historial,
  hace,
  ocupado,
  esAdmin,
  jugador,
  motivo,
  anuncio,
  consola,
  alCambiarJugador,
  alCambiarMotivo,
  alCambiarAnuncio,
  alAnunciar,
  alModerar,
  ejecutar,
}: Readonly<{
  panorama: Panorama | null;
  historial: Historial;
  hace: number;
  ocupado: boolean;
  esAdmin: boolean;
  jugador: string;
  motivo: string;
  anuncio: string;
  consola: LineaDeConsola[];
  alCambiarJugador: (nombre: string) => void;
  alCambiarMotivo: (motivo: string) => void;
  alCambiarAnuncio: (anuncio: string) => void;
  alAnunciar: (evento: React.SubmitEvent) => void;
  alModerar: (accion: string, titulo: string) => void;
  ejecutar: Ejecutar;
}>) {
  const nombres = panorama?.jugadores?.nombres ?? [];
  const cambiarJugador = (e: React.ChangeEvent<HTMLInputElement>) =>
    alCambiarJugador(e.target.value);
  const cambiarMotivo = (e: React.ChangeEvent<HTMLInputElement>) =>
    alCambiarMotivo(e.target.value);
  const cambiarAnuncio = (e: React.ChangeEvent<HTMLInputElement>) =>
    alCambiarAnuncio(e.target.value);
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl text-dex-ink">Resumen en vivo</h2>
        {panorama ? (
          <span className="text-xs text-dex-muted">
            actualizado hace {hace} s · cada {REFRESCO_MS / 1000} s
          </span>
        ) : null}
      </div>

      <Indicadores panorama={panorama} historial={historial} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          <Seccion
            titulo="En línea ahora"
            bajada="Elige a alguien para rellenar el formulario de abajo."
          >
            {nombres.length ? (
              <ul className="divide-y divide-dex-line text-sm">
                {nombres.map((nombre) => (
                  <JugadorEnLinea
                    key={nombre}
                    nombre={nombre}
                    ocupado={ocupado}
                    alElegir={alCambiarJugador}
                    ejecutar={ejecutar}
                  />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-dex-muted">
                {panorama ? "No hay nadie conectado." : "Consultando…"}
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
                onChange={cambiarJugador}
                placeholder="Nombre del jugador"
                aria-label="Nombre del jugador"
                className={CLASE_CAMPO_MONO}
              />
              <input
                type="text"
                value={motivo}
                onChange={cambiarMotivo}
                maxLength={120}
                placeholder="Motivo (expulsar y vetar)"
                aria-label="Motivo"
                className={CLASE_CAMPO_MONO}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {MODERACION.filter(([, , soloAdmin]) => !soloAdmin || esAdmin).map(
                ([titulo, accion, , estilo]) => (
                  <BotonDeModeracion
                    key={accion}
                    titulo={titulo}
                    accion={accion}
                    estilo={estilo}
                    ocupado={ocupado}
                    alPulsar={alModerar}
                  />
                ),
              )}
            </div>
          </Seccion>

          <Seccion
            titulo="Acciones rápidas"
            bajada="Comandos fijos: aquí no se escribe ningún comando."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ACCIONES_RAPIDAS.map((a) => (
                <BotonDeAccion
                  key={a.accion}
                  accion={a}
                  ocupado={ocupado}
                  ejecutar={ejecutar}
                />
              ))}
            </div>
            <form onSubmit={alAnunciar} className="flex gap-2">
              <input
                type="text"
                value={anuncio}
                onChange={cambiarAnuncio}
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
              : consola.map((linea) => (
                  <span key={linea.id} className={linea.ok ? "" : "text-red-400"}>
                    {`> ${linea.comando}\n${linea.salida}\n`}
                  </span>
                ))}
          </pre>
        </Seccion>
      </div>
    </>
  );
}
