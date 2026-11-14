// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
/**
 * Cola de SOLICITUDES del mantenedor: las inscripciones, modificaciones y bajas que llegaron por los formularios
 * públicos y esperan revisión.
 *
 *   · Inscripción → «Aprobar» crea la ficha en BORRADOR (hay que publicarla aparte, desde «Fichas»)
 *     y «Rechazar» la cierra.
 *   · Modificación → «Aprobar» aplica los cambios a la ficha existente.
 *   · Baja → «Marcar procesada» la cierra y «Rechazar» la descarta (p. ej. no se acreditó la
 *     titularidad). Procesar NO toca la ficha: aplicar la cláusula de salida (degradarla) es un
 *     paso manual aparte, y el aviso lo dice para que nadie crea que ya está hecho.
 *
 * DISEÑO (por qué se ve así): antes cada solicitud era una tarjeta con TODOS sus campos en un muro de texto, sin un
 * resumen, y solo se sabía si se podía aprobar al pulsar «Aprobar». Ahora:
 *   · LISTA a la izquierda (una línea por solicitud, la más antigua primero: la cola se atiende en orden) y el
 *     DETALLE a la derecha, agrupado por secciones;
 *   · una VISTA PREVIA calculada por el servidor (`server/src/solicitud-vista.mjs`) dice ANTES de aprobar si se puede,
 *     qué ficha es y, en una modificación, qué cambia (antes → después). Si la ficha no se encuentra, se ELIGE a mano;
 *   · rechazar pide confirmación (borra el contacto y no se deshace).
 *
 * Aquí SÍ se ve el contacto confidencial (correo): es para lo que existe. Se borra
 * solo al cerrar una baja o rechazar una solicitud.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  DetalleDeSolicitud,
  ESTADO_CLASE,
  META,
  texto,
  tituloDe,
  type Accion,
} from "@/components/admin/solicitudes-detalle";
import {
  api,
  type ResumenRechazos,
  type SolicitudAdmin,
  type VistaPreviaSolicitud,
} from "@/lib/api";
import { haceCuanto } from "@/lib/tiempo-relativo";

export { tituloDe } from "@/components/admin/solicitudes-detalle";

type Notify = (kind: "ok" | "error", text: string) => void;
type Estado = "pendiente" | "aprobada" | "procesada" | "rechazada" | "todas";
type Tipo = SolicitudAdmin["tipo"] | "todos";
type Pendientes = Record<SolicitudAdmin["tipo"], number>;

const ESTADOS: Array<{ id: Estado; label: string }> = [
  { id: "pendiente", label: "Pendientes" },
  { id: "aprobada", label: "Aprobadas" },
  { id: "procesada", label: "Procesadas" },
  { id: "rechazada", label: "Rechazadas" },
  { id: "todas", label: "Todas" },
];

const TIPOS: Array<{ id: Tipo; label: string }> = [
  { id: "todos", label: "Todos los tipos" },
  { id: "inscripcion", label: "Inscripciones" },
  { id: "modificacion", label: "Modificaciones" },
  { id: "baja", label: "Bajas" },
];

/** Solo al aprobar una modificación viaja la ficha elegida a mano (si se eligió). */
function fichaParaResolver(
  accion: Accion,
  s: SolicitudAdmin,
  fichaElegida: string | null,
): string | undefined {
  if (accion !== "aprobar" || s.tipo !== "modificacion") {
    return undefined;
  }
  return fichaElegida ?? undefined;
}

/** Sin solicitudes: «al día» si se miran las pendientes de todos los tipos; si no, que esta vista está vacía. */
function ColaVacia({ estado, tipo }: Readonly<{ estado: Estado; tipo: Tipo }>) {
  return (
    <p
      className="rounded-2xl border border-dashed border-dex-line px-6 py-10 text-center text-sm text-dex-muted"
      data-testid="solicitudes-vacio"
    >
      {estado === "pendiente" && tipo === "todos"
        ? "No hay solicitudes pendientes. ¡Al día!"
        : "No hay solicitudes en esta vista."}
    </p>
  );
}

/** El aviso de éxito de cada acción (aprobar dice qué pasó con la ficha según el tipo). */
export function mensajeDeResolucion(
  accion: Accion,
  tipo: SolicitudAdmin["tipo"],
): string {
  if (accion === "procesar") {
    return "Baja marcada como procesada";
  }
  if (accion === "rechazar") {
    return "Solicitud rechazada";
  }
  return tipo === "modificacion"
    ? "Cambios aplicados a la ficha"
    : "Ficha creada en borrador";
}

/** Las imágenes que no se pudieron copiar a la ficha al aprobar (la aprobación sigue valiendo). */
function avisoDeImagenesFallidas(fallidas: Array<{ tipo: string }>): string {
  const cuales = fallidas
    .map((f) => (f.tipo === "character" ? "el avatar" : "el logo"))
    .join(" y ");
  return `La solicitud se aprobó, pero no se pudo copiar: ${cuales}. Súbelo desde «Imágenes» de la ficha.`;
}

/** El contador de cada tipo solo tiene sentido mirando las pendientes. */
function cuentaDeTipo(
  estado: Estado,
  t: Tipo,
  pendientes: Pendientes,
): number | null {
  if (estado !== "pendiente") {
    return null;
  }
  if (t === "todos") {
    return pendientes.inscripcion + pendientes.modificacion + pendientes.baja;
  }
  return pendientes[t];
}

/**
 * Rechazos de los formularios públicos de los últimos 7 días: qué formulario, qué código y qué campo. Sirve
 * para saber dónde se atasca la gente (una validación que falla no deja otro rastro). No lleva correos ni
 * contenido. Se pide al abrirlo, no al montar la cola.
 */
export function RechazosPanel({ token }: Readonly<{ token: string }>) {
  const [datos, setDatos] = useState<ResumenRechazos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abrir = (abierto: boolean) => {
    if (!abierto || datos) {
      return;
    }
    api
      .rechazosDeSolicitudes(token, 7)
      .then(setDatos)
      .catch((error_) =>
        setError(
          error_ instanceof Error
            ? error_.message
            : "No se pudo leer el resumen",
        ),
      );
  };
  return (
    <details
      className="rounded-xl border border-dex-line bg-dex-panel/50 px-4 py-2 text-sm"
      data-testid="rechazos-panel"
      onToggle={(e) => abrir(e.currentTarget.open)}
    >
      <summary className="cursor-pointer text-dex-muted hover:text-dex-ink">
        Envíos rechazados (últimos 7 días)
      </summary>
      <div className="mt-3 space-y-3">
        {error && <p className="text-rose-300">{error}</p>}
        {!error && !datos && <p className="text-dex-muted">Cargando…</p>}
        {datos?.total === 0 && (
          <p className="text-dex-muted">
            Ningún rechazo registrado: nada se atascó.
          </p>
        )}
        {datos && datos.total > 0 && (
          <>
            <p className="text-xs text-dex-muted">
              {datos.total} en total. Solo se guarda el formulario, el código de
              error y el campo: nunca el correo ni lo escrito.
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-dex-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Formulario</th>
                  <th className="pr-3 font-normal">Código</th>
                  <th className="text-right font-normal">Veces</th>
                </tr>
              </thead>
              <tbody>
                {datos.porCodigo.map((f) => (
                  <tr
                    key={`${f.formulario}/${f.codigo}`}
                    className="border-t border-dex-line/60"
                  >
                    <td className="py-1 pr-3 font-mono">{f.formulario}</td>
                    <td className="pr-3 font-mono">
                      {f.codigo}{" "}
                      <span className="text-dex-muted">({f.status})</span>
                    </td>
                    <td className="text-right font-mono">{f.n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {datos.porCampo.length > 0 && (
              <div>
                <p className="mb-1 text-xs text-dex-muted">
                  Campos que fallaron más
                </p>
                <ul className="flex flex-wrap gap-1.5">
                  {datos.porCampo.slice(0, 12).map((c) => (
                    <li
                      key={`${c.formulario}/${c.campo}`}
                      className="rounded-full border border-dex-line px-2 py-0.5 font-mono text-[11px]"
                    >
                      {c.formulario} · {c.campo} · {c.n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function FiltrosDeSolicitudes({
  estado,
  onEstado,
  tipo,
  onTipo,
  pendientes,
}: Readonly<{
  estado: Estado;
  onEstado: (estado: Estado) => void;
  tipo: Tipo;
  onTipo: (tipo: Tipo) => void;
  pendientes: Pendientes;
}>) {
  const totalPendientes = cuentaDeTipo("pendiente", "todos", pendientes) ?? 0;
  return (
    <header className="space-y-3">
      <fieldset
        className="flex min-w-0 flex-wrap items-center gap-2"
        aria-label="Estado de las solicitudes"
      >
        {ESTADOS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onEstado(f.id)}
            aria-pressed={estado === f.id}
            className={`rounded-full border px-3 py-1 text-xs ${
              estado === f.id
                ? "border-dex-accent bg-dex-accent/15 text-dex-ink"
                : "border-dex-line text-dex-muted hover:text-dex-ink"
            }`}
          >
            {f.label}
            {f.id === "pendiente" && totalPendientes > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-300/20 px-1.5 font-mono text-[11px] text-amber-200">
                {totalPendientes}
              </span>
            )}
          </button>
        ))}
      </fieldset>
      <fieldset
        className="flex min-w-0 flex-wrap items-center gap-2"
        aria-label="Tipo de solicitud"
        data-testid="solicitudes-contador"
      >
        {TIPOS.map((f) => {
          const n = cuentaDeTipo(estado, f.id, pendientes);
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onTipo(f.id)}
              aria-pressed={tipo === f.id}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                tipo === f.id
                  ? "border-dex-accent/60 bg-dex-accent/10 text-dex-ink"
                  : "border-dex-line text-dex-muted hover:text-dex-ink"
              }`}
            >
              {f.label}
              {n !== null && (
                <span className="ml-1.5 font-mono text-[11px] opacity-80">
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </fieldset>
    </header>
  );
}

function ItemDeSolicitud({
  s,
  activa,
  onElegir,
}: Readonly<{
  s: SolicitudAdmin;
  activa: boolean;
  onElegir: (id: number) => void;
}>) {
  const meta = META[s.tipo];
  const inscripcion = s.tipo === "inscripcion";
  const pais = inscripcion ? texto(s.datos.country) : "";
  const idiomas =
    inscripcion && Array.isArray(s.datos.languages)
      ? (s.datos.languages as string[])
      : null;
  return (
    <li>
      <button
        type="button"
        data-testid={`solicitud-${s.id}`}
        aria-current={activa ? "true" : undefined}
        onClick={() => onElegir(s.id)}
        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
          activa
            ? "border-dex-accent/60 bg-dex-accent/10"
            : "border-dex-line bg-dex-panel/50 hover:border-dex-accent/30"
        }`}
      >
        <span className="flex items-center gap-2 text-[11px]">
          <span
            className={`rounded px-1.5 py-0.5 font-bold uppercase ${meta.clase}`}
          >
            {meta.etiqueta}
          </span>
          <span className="font-mono text-dex-muted">#{s.id}</span>
          <span
            className="ml-auto text-dex-muted"
            title={new Date(s.creado).toLocaleString("es-CL")}
          >
            {haceCuanto(s.creado)}
          </span>
        </span>
        <span className="mt-1 block truncate text-sm font-bold text-dex-ink">
          {tituloDe(s)}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-dex-muted">
          {pais && <span>{pais}</span>}
          {idiomas && <span>{idiomas.join(", ")}</span>}
          {s.estado !== "pendiente" && (
            <span className={`ml-auto font-semibold ${ESTADO_CLASE[s.estado]}`}>
              {s.estado}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

/** ¿Hay que llevar la vista hasta el detalle? Solo en pantallas angostas, donde queda bajo la lista. */
function detalleQuedaAbajo(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.matchMedia?.("(max-width: 1023px)").matches)
  );
}

export function SolicitudesManager({
  token,
  notify,
  onChanged,
}: Readonly<{
  token: string;
  notify?: Notify;
  /** Aprobar crea una ficha: el padre refresca lista y métricas. */
  onChanged?: () => void;
}>) {
  const [estado, setEstado] = useState<Estado>("pendiente");
  const [tipo, setTipo] = useState<Tipo>("todos");
  const [items, setItems] = useState<SolicitudAdmin[]>([]);
  const [pendientes, setPendientes] = useState<Pendientes>({
    inscripcion: 0,
    baja: 0,
    modificacion: 0,
  });
  const [cargada, setCargada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionId, setSeleccionId] = useState<number | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [nota, setNota] = useState("");
  const [rechazando, setRechazando] = useState(false);
  const [vista, setVista] = useState<VistaPreviaSolicitud | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [fichaElegida, setFichaElegida] = useState<string | null>(null);
  const detalleRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await api.solicitudes(
        token,
        estado,
        tipo === "todos" ? undefined : tipo,
      );
      // La cola se atiende en orden (la más antigua primero); lo ya resuelto, lo más reciente primero.
      const ordenadas =
        estado === "pendiente"
          ? respuesta.items
          : [...respuesta.items].reverse();
      setItems(ordenadas);
      setPendientes(respuesta.pendientes);
      setError(null);
      setSeleccionId((actual) =>
        actual !== null && ordenadas.some((s) => s.id === actual)
          ? actual
          : (ordenadas[0]?.id ?? null),
      );
    } catch (error_) {
      setError(
        error_ instanceof Error ? error_.message : "No se pudo leer la cola",
      );
    } finally {
      setCargada(true);
    }
  }, [token, estado, tipo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const seleccionada = items.find((s) => s.id === seleccionId) ?? null;

  // Al cambiar de solicitud se empieza limpio: ni nota, ni confirmación, ni ficha elegida de la anterior.
  useEffect(() => {
    setNota("");
    setRechazando(false);
    setFichaElegida(null);
    setVista(null);
  }, [seleccionId]);

  // La vista previa: qué pasaría al aprobar. Si el servidor no la ofrece (versión antigua) la pantalla sigue
  // funcionando con los datos crudos y el botón habilitado.
  useEffect(() => {
    if (seleccionada?.estado !== "pendiente") {
      setVista(null);
      return undefined;
    }
    let vigente = true;
    setCargandoVista(true);
    api
      .vistaPreviaSolicitud(token, seleccionada.id, fichaElegida ?? undefined)
      .then((v) => vigente && setVista(v))
      .catch(() => vigente && setVista(null))
      .finally(() => vigente && setCargandoVista(false));
    return () => {
      vigente = false;
    };
  }, [token, seleccionada?.id, seleccionada?.estado, fichaElegida]);

  const elegir = useCallback((id: number) => {
    setSeleccionId(id);
    // En pantallas angostas el detalle queda bajo la lista: se lleva la vista hasta él.
    if (detalleQuedaAbajo()) {
      detalleRef.current?.scrollIntoView?.({
        block: "start",
        behavior: "smooth",
      });
    }
  }, []);

  const resolver = useCallback(
    async (s: SolicitudAdmin, accion: Accion) => {
      setOcupada(s.id);
      try {
        const { imagenes } = await api.resolverSolicitud(
          token,
          s.id,
          accion,
          nota,
          fichaParaResolver(accion, s, fichaElegida),
        );
        const fallidas = imagenes?.fallidas ?? [];
        if (fallidas.length) {
          notify?.("error", avisoDeImagenesFallidas(fallidas));
        } else {
          notify?.("ok", mensajeDeResolucion(accion, s.tipo));
        }
        await cargar();
        if (accion === "aprobar") {
          onChanged?.();
        }
      } catch (error_) {
        notify?.(
          "error",
          error_ instanceof Error
            ? error_.message
            : "No se pudo resolver la solicitud",
        );
      } finally {
        setOcupada(null);
        setRechazando(false);
      }
    },
    [token, nota, fichaElegida, notify, cargar, onChanged],
  );
  const alResolver = useCallback(
    (s: SolicitudAdmin, accion: Accion) => void resolver(s, accion),
    [resolver],
  );

  const vacia = cargada && !error && items.length === 0;

  return (
    <section className="space-y-4" data-testid="solicitudes-manager">
      <RechazosPanel token={token} />
      <FiltrosDeSolicitudes
        estado={estado}
        onEstado={setEstado}
        tipo={tipo}
        onTipo={setTipo}
        pendientes={pendientes}
      />

      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
      {vacia && <ColaVacia estado={estado} tipo={tipo} />}

      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <ul
            className="dex-scroll max-h-[70vh] space-y-2 overflow-y-auto pr-1"
            aria-label="Solicitudes"
          >
            {items.map((s) => (
              <ItemDeSolicitud
                key={s.id}
                s={s}
                activa={s.id === seleccionId}
                onElegir={elegir}
              />
            ))}
          </ul>

          <div ref={detalleRef} className="min-w-0 scroll-mt-4">
            {seleccionada && (
              <DetalleDeSolicitud
                token={token}
                s={seleccionada}
                vista={vista}
                cargandoVista={cargandoVista}
                fichaElegida={fichaElegida}
                onElegirFicha={setFichaElegida}
                ocupada={ocupada}
                nota={nota}
                onNota={setNota}
                rechazando={rechazando}
                onRechazando={setRechazando}
                onResolver={alResolver}
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default SolicitudesManager;
