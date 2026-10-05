'use client';
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
 * Aquí SÍ se ve el contacto confidencial (correo, nombre civil): es para lo que existe. Se borra
 * solo al cerrar una baja o rechazar una solicitud.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type FichaResumen, type SolicitudAdmin, type VistaPreviaSolicitud } from '@/lib/api';
import { haceCuanto } from '@/lib/tiempo-relativo';
import { ghostButton, inputClass, primaryButton } from '@/components/admin/ui';

type Notify = (kind: 'ok' | 'error', text: string) => void;
type Estado = 'pendiente' | 'aprobada' | 'procesada' | 'rechazada' | 'todas';
type Tipo = SolicitudAdmin['tipo'] | 'todos';
type Accion = 'aprobar' | 'rechazar' | 'procesar';

const ESTADOS: Array<{ id: Estado; label: string }> = [
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'aprobada', label: 'Aprobadas' },
  { id: 'procesada', label: 'Procesadas' },
  { id: 'rechazada', label: 'Rechazadas' },
  { id: 'todas', label: 'Todas' },
];

const TIPOS: Array<{ id: Tipo; label: string }> = [
  { id: 'todos', label: 'Todos los tipos' },
  { id: 'inscripcion', label: 'Inscripciones' },
  { id: 'modificacion', label: 'Modificaciones' },
  { id: 'baja', label: 'Bajas' },
];

const META: Record<SolicitudAdmin['tipo'], { etiqueta: string; clase: string; aprobar: string }> = {
  inscripcion: { etiqueta: 'Inscripción', clase: 'bg-dex-accent/20 text-dex-accent', aprobar: 'Aprobar y crear borrador' },
  modificacion: { etiqueta: 'Modificación', clase: 'bg-violet-400/20 text-violet-200', aprobar: 'Aprobar y aplicar cambios' },
  baja: { etiqueta: 'Baja', clase: 'bg-amber-300/20 text-amber-200', aprobar: 'Marcar procesada' },
};

const ESTADO_CLASE: Record<SolicitudAdmin['estado'], string> = {
  pendiente: 'text-amber-200',
  aprobada: 'text-emerald-300',
  procesada: 'text-emerald-300',
  rechazada: 'text-rose-300',
};

const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '');

/** El nombre con que se reconoce una solicitud de un vistazo. */
export function tituloDe(s: SolicitudAdmin): string {
  return (s.tipo === 'inscripcion' ? texto(s.datos.name) : texto(s.datos.ficha)) || `Solicitud #${s.id}`;
}

function Veredicto({ vista, cargando, solicitud }: { vista: VistaPreviaSolicitud | null; cargando: boolean; solicitud: SolicitudAdmin }) {
  if (solicitud.estado !== 'pendiente') return null;
  if (cargando && !vista) return <p className="rounded-xl border border-dex-line px-3 py-2 text-xs text-dex-muted">Comprobando si se puede aprobar…</p>;
  if (!vista) return null;
  return (
    <div className="space-y-2" data-testid="solicitud-veredicto">
      {vista.problema ? (
        <div role="alert" className="rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
          <strong>No se puede aprobar todavía.</strong> {vista.problema.mensaje}
          {vista.problema.detalles && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {vista.problema.detalles.map((d, i) => (
                <li key={i}>
                  {d.path}: {d.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
          {vista.creara && (
            <>
              <strong>Lista para aprobar.</strong> Creará la ficha «{vista.creara.name}» en <strong>borrador</strong>, en{' '}
              <span className="font-mono">/v/{vista.creara.slug}</span>.
            </>
          )}
          {vista.tipo === 'modificacion' && vista.ficha && (
            <>
              <strong>Lista para aprobar.</strong>{' '}
              {vista.cambios && vista.cambios.length > 0
                ? `Aplicará ${vista.cambios.length} ${vista.cambios.length === 1 ? 'cambio' : 'cambios'} a «${vista.ficha.name}».`
                : `No hay nada que cambiar en «${vista.ficha.name}».`}
            </>
          )}
          {vista.tipo === 'baja' && (
            <>
              <strong>Lista para cerrar.</strong> Cerrar la solicitud no toca la ficha.
            </>
          )}
        </div>
      )}
      {vista.avisos.map((aviso) => (
        <p key={aviso} className="rounded-xl border border-amber-300/30 bg-amber-300/5 px-3 py-2 text-xs text-amber-100">
          {aviso}
        </p>
      ))}
    </div>
  );
}

/** Cuando lo escrito en el formulario no se resuelve solo: se ELIGE la ficha (candidatas o búsqueda). */
function ElegirFicha({
  token,
  candidatas,
  elegida,
  onElegir,
}: {
  token: string;
  candidatas: FichaResumen[];
  elegida: string | null;
  onElegir: (slug: string | null) => void;
}) {
  const [consulta, setConsulta] = useState('');
  const [resultados, setResultados] = useState<FichaResumen[]>([]);
  useEffect(() => {
    const q = consulta.trim();
    if (q.length < 2) {
      setResultados([]);
      return;
    }
    const controller = new AbortController();
    api
      .adminList(token, { q, perPage: 6 }, controller.signal)
      .then((r) => setResultados(r.items.map((i) => ({ id: i.id, slug: i.slug, name: i.name, dexNumber: i.dexNumber, status: i.status, grado: i.premium?.grade ?? null }))))
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, consulta]);

  const opciones = consulta.trim().length >= 2 ? resultados : candidatas;
  return (
    <section className="space-y-2 rounded-xl border border-dex-line bg-dex-void/50 p-3" data-testid="solicitud-elegir-ficha">
      <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">¿De qué ficha se trata?</h4>
      <input
        className={`${inputClass} mt-0`}
        placeholder="Busca por nombre o número…"
        aria-label="Buscar la ficha de esta solicitud"
        value={consulta}
        onChange={(e) => setConsulta(e.target.value)}
      />
      <ul className="space-y-1">
        {opciones.map((f) => (
          <li key={f.slug} className="flex items-center gap-2 text-sm">
            <span className="font-mono text-[11px] text-dex-muted">#{String(f.dexNumber).padStart(3, '0')}</span>
            <span className="min-w-0 flex-1 truncate text-dex-ink">{f.name}</span>
            <button type="button" className={elegida === f.slug ? primaryButton : ghostButton} aria-pressed={elegida === f.slug} onClick={() => onElegir(elegida === f.slug ? null : f.slug)}>
              {elegida === f.slug ? 'Elegida ✓' : 'Es esta'}
            </button>
          </li>
        ))}
        {opciones.length === 0 && <li className="text-xs text-dex-muted">{consulta.trim().length >= 2 ? 'Ninguna ficha coincide.' : 'Escribe para buscar la ficha.'}</li>}
      </ul>
    </section>
  );
}

function Seccion({ titulo, children, abierta = true }: { titulo: string; children: React.ReactNode; abierta?: boolean }) {
  return (
    <details open={abierta} className="group rounded-xl border border-dex-line bg-dex-panel/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">{titulo}</summary>
      <div className="border-t border-dex-line/60 px-3 py-3">{children}</div>
    </details>
  );
}

function Dato({ k, v, ancho = false, enlace = false }: { k: string; v: string; ancho?: boolean; enlace?: boolean }) {
  if (!v) return null;
  const esUrl = enlace && /^https?:\/\//i.test(v);
  return (
    <div className={ancho ? 'sm:col-span-2' : ''}>
      <dt className="text-[11px] uppercase tracking-[0.12em] text-dex-muted">{k}</dt>
      <dd className="break-words text-sm text-dex-ink">
        {esUrl ? (
          <a href={v} target="_blank" rel="noopener noreferrer" className="text-dex-accent underline underline-offset-2">
            {v}
          </a>
        ) : (
          v
        )}
      </dd>
    </div>
  );
}

/** Los campos de perfil de una inscripción (o todo lo enviado en una modificación), en una rejilla. */
function CamposDeFicha({ s }: { s: SolicitudAdmin }) {
  const d = s.datos;
  return (
    <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      <Dato k="Signo" v={texto(d.zodiac)} />
      <Dato k="Estatura" v={texto(d.height)} />
      <Dato k="Cumpleaños" v={texto(d.birthday)} />
      <Dato k="Color favorito" v={texto(d.favoriteColor)} />
      <Dato k="Comida favorita" v={texto(d.favoriteFood)} />
      <Dato k="Comida que desagrada" v={texto(d.dislikedFood)} />
      <Dato k="Videojuego" v={texto(d.favoriteGame)} />
      <Dato k="Serie" v={texto(d.favoriteSeries)} />
      <Dato k="Música" v={texto(d.favoriteMusic)} />
      <Dato k="Anime" v={texto(d.favoriteAnime)} />
      <Dato k="Animal" v={texto(d.favoriteAnimal)} />
      <Dato k="Modelo (autoría)" v={texto(d.modeler)} />
      <Dato k="Hashtag de arte" v={texto(d.hashtag)} />
    </dl>
  );
}

function Redes({ s }: { s: SolicitudAdmin }) {
  const redes = Array.isArray(s.datos.socials) ? (s.datos.socials as Array<{ platform: string; url: string }>) : [];
  if (!redes.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {redes.map((r, i) => (
        <li key={i}>
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-full border border-dex-line px-3 py-1 text-xs text-dex-accent hover:bg-dex-accent/10">
            {r.platform} <span aria-hidden>↗</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function SolicitudesManager({
  token,
  notify,
  onChanged,
}: {
  token: string;
  notify?: Notify;
  /** Aprobar crea una ficha: el padre refresca lista y métricas. */
  onChanged?: () => void;
}) {
  const [estado, setEstado] = useState<Estado>('pendiente');
  const [tipo, setTipo] = useState<Tipo>('todos');
  const [items, setItems] = useState<SolicitudAdmin[]>([]);
  const [pendientes, setPendientes] = useState({ inscripcion: 0, baja: 0, modificacion: 0 });
  const [cargada, setCargada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seleccionId, setSeleccionId] = useState<number | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [nota, setNota] = useState('');
  const [rechazando, setRechazando] = useState(false);
  const [vista, setVista] = useState<VistaPreviaSolicitud | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [fichaElegida, setFichaElegida] = useState<string | null>(null);
  const detalleRef = useRef<HTMLDivElement>(null);

  const cargar = useCallback(async () => {
    try {
      const respuesta = await api.solicitudes(token, estado, tipo === 'todos' ? undefined : tipo);
      // La cola se atiende en orden (la más antigua primero); lo ya resuelto, lo más reciente primero.
      const ordenadas = estado === 'pendiente' ? respuesta.items : [...respuesta.items].reverse();
      setItems(ordenadas);
      setPendientes(respuesta.pendientes);
      setError(null);
      setSeleccionId((actual) => (actual !== null && ordenadas.some((s) => s.id === actual) ? actual : (ordenadas[0]?.id ?? null)));
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No se pudo leer la cola');
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
    setNota('');
    setRechazando(false);
    setFichaElegida(null);
    setVista(null);
  }, [seleccionId]);

  // La vista previa: qué pasaría al aprobar. Si el servidor no la ofrece (versión antigua) la pantalla sigue
  // funcionando con los datos crudos y el botón habilitado.
  useEffect(() => {
    if (!seleccionada || seleccionada.estado !== 'pendiente') {
      setVista(null);
      return;
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
  }, [token, seleccionada?.id, seleccionada?.estado, fichaElegida]); // eslint-disable-line react-hooks/exhaustive-deps

  const elegir = (id: number) => {
    setSeleccionId(id);
    // En pantallas angostas el detalle queda bajo la lista: se lleva la vista hasta él.
    if (typeof window !== 'undefined' && window.matchMedia?.('(max-width: 1023px)').matches) {
      detalleRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
  };

  const resolver = async (s: SolicitudAdmin, accion: Accion) => {
    setOcupada(s.id);
    try {
      await api.resolverSolicitud(token, s.id, accion, nota, accion === 'aprobar' && s.tipo === 'modificacion' ? (fichaElegida ?? undefined) : undefined);
      notify?.(
        'ok',
        accion === 'aprobar'
          ? s.tipo === 'modificacion'
            ? 'Cambios aplicados a la ficha'
            : 'Ficha creada en borrador'
          : accion === 'procesar'
            ? 'Baja marcada como procesada'
            : 'Solicitud rechazada',
      );
      await cargar();
      if (accion === 'aprobar') onChanged?.();
    } catch (causa) {
      notify?.('error', causa instanceof Error ? causa.message : 'No se pudo resolver la solicitud');
    } finally {
      setOcupada(null);
      setRechazando(false);
    }
  };

  const totalPendientes = pendientes.inscripcion + pendientes.modificacion + pendientes.baja;
  const cuenta = (t: Tipo) => (estado !== 'pendiente' ? null : t === 'todos' ? totalPendientes : pendientes[t]);

  return (
    <section className="space-y-4" data-testid="solicitudes-manager">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Estado de las solicitudes">
          {ESTADOS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setEstado(f.id)}
              aria-pressed={estado === f.id}
              className={`rounded-full border px-3 py-1 text-xs ${
                estado === f.id ? 'border-dex-accent bg-dex-accent/15 text-dex-ink' : 'border-dex-line text-dex-muted hover:text-dex-ink'
              }`}
            >
              {f.label}
              {f.id === 'pendiente' && totalPendientes > 0 && <span className="ml-1.5 rounded-full bg-amber-300/20 px-1.5 font-mono text-[11px] text-amber-200">{totalPendientes}</span>}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Tipo de solicitud" data-testid="solicitudes-contador">
          {TIPOS.map((f) => {
            const n = cuenta(f.id);
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setTipo(f.id)}
                aria-pressed={tipo === f.id}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  tipo === f.id ? 'border-dex-accent/60 bg-dex-accent/10 text-dex-ink' : 'border-dex-line text-dex-muted hover:text-dex-ink'
                }`}
              >
                {f.label}
                {n !== null && <span className="ml-1.5 font-mono text-[11px] opacity-80">{n}</span>}
              </button>
            );
          })}
        </div>
      </header>

      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {cargada && !error && items.length === 0 && (
        <p className="rounded-2xl border border-dashed border-dex-line px-6 py-10 text-center text-sm text-dex-muted" data-testid="solicitudes-vacio">
          {estado === 'pendiente' && tipo === 'todos' ? 'No hay solicitudes pendientes. ¡Al día!' : 'No hay solicitudes en esta vista.'}
        </p>
      )}

      {items.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-[21rem_minmax(0,1fr)]">
          <ul className="dex-scroll max-h-[70vh] space-y-2 overflow-y-auto pr-1" aria-label="Solicitudes">
            {items.map((s) => {
              const meta = META[s.tipo];
              const activa = s.id === seleccionId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    data-testid={`solicitud-${s.id}`}
                    aria-current={activa ? 'true' : undefined}
                    onClick={() => elegir(s.id)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      activa ? 'border-dex-accent/60 bg-dex-accent/10' : 'border-dex-line bg-dex-panel/50 hover:border-dex-accent/30'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-[11px]">
                      <span className={`rounded px-1.5 py-0.5 font-bold uppercase ${meta.clase}`}>{meta.etiqueta}</span>
                      <span className="font-mono text-dex-muted">#{s.id}</span>
                      <span className="ml-auto text-dex-muted" title={new Date(s.creado).toLocaleString('es-CL')}>
                        {haceCuanto(s.creado)}
                      </span>
                    </span>
                    <span className="mt-1 block truncate text-sm font-bold text-dex-ink">{tituloDe(s)}</span>
                    <span className="mt-0.5 flex items-center gap-2 text-[11px] text-dex-muted">
                      {s.tipo === 'inscripcion' && texto(s.datos.country) && <span>{texto(s.datos.country)}</span>}
                      {s.tipo === 'inscripcion' && Array.isArray(s.datos.languages) && <span>{(s.datos.languages as string[]).join(', ')}</span>}
                      {s.estado !== 'pendiente' && <span className={`ml-auto font-semibold ${ESTADO_CLASE[s.estado]}`}>{s.estado}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div ref={detalleRef} className="min-w-0 scroll-mt-4">
            {seleccionada && (
              <article className="space-y-3 rounded-2xl border border-dex-line bg-dex-panel/60 p-4" data-testid="solicitud-detalle">
                <header className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded px-2 py-0.5 font-bold uppercase ${META[seleccionada.tipo].clase}`}>{META[seleccionada.tipo].etiqueta}</span>
                    <span className="font-mono text-dex-muted">#{seleccionada.id}</span>
                    <span className={`font-semibold ${ESTADO_CLASE[seleccionada.estado]}`}>{seleccionada.estado}</span>
                    <span className="ml-auto text-dex-muted" title="Versión de los términos aceptada">
                      términos {seleccionada.terminosVersion}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-dex-ink">{tituloDe(seleccionada)}</h3>
                  <p className="text-xs text-dex-muted">
                    Recibida {haceCuanto(seleccionada.creado)} · {new Date(seleccionada.creado).toLocaleString('es-CL')}
                  </p>
                </header>

                <Veredicto vista={vista} cargando={cargandoVista} solicitud={seleccionada} />

                {seleccionada.estado === 'pendiente' && seleccionada.tipo === 'modificacion' && vista?.problema?.codigo === 'ficha_no_encontrada' && (
                  <ElegirFicha token={token} candidatas={vista.candidatas ?? []} elegida={fichaElegida} onElegir={setFichaElegida} />
                )}

                {seleccionada.estado === 'pendiente' && (
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dex-line bg-dex-void/50 p-3" data-testid="solicitud-acciones">
                    <input
                      className={`${inputClass} mt-0 w-full sm:max-w-xs sm:flex-1`}
                      placeholder="Nota interna (opcional)"
                      aria-label={`Nota de la solicitud ${seleccionada.id}`}
                      value={nota}
                      onChange={(e) => setNota(e.target.value)}
                    />
                    <button
                      type="button"
                      className={primaryButton}
                      disabled={ocupada === seleccionada.id || cargandoVista || (vista !== null && !vista.puedeAprobar)}
                      onClick={() => void resolver(seleccionada, seleccionada.tipo === 'baja' ? 'procesar' : 'aprobar')}
                    >
                      {META[seleccionada.tipo].aprobar}
                    </button>
                    {rechazando ? (
                      <span className="flex flex-wrap items-center gap-2 text-xs text-dex-muted" data-testid="solicitud-confirmar-rechazo">
                        ¿Rechazar? Se borrará el contacto y no se puede deshacer.
                        <button type="button" className={ghostButton} disabled={ocupada === seleccionada.id} onClick={() => void resolver(seleccionada, 'rechazar')}>
                          Sí, rechazar
                        </button>
                        <button type="button" className={ghostButton} onClick={() => setRechazando(false)}>
                          No
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={ghostButton} disabled={ocupada === seleccionada.id} onClick={() => setRechazando(true)}>
                        Rechazar
                      </button>
                    )}
                  </div>
                )}

                {/* ── contenido, según el tipo ───────────────────────────────────────── */}
                {seleccionada.tipo === 'inscripcion' && (
                  <>
                    <Seccion titulo="La ficha propuesta">
                      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                        <Dato k="Nombre" v={texto(seleccionada.datos.name)} />
                        <Dato k="País" v={texto(seleccionada.datos.country)} />
                        <Dato k="Idiomas" v={Array.isArray(seleccionada.datos.languages) ? (seleccionada.datos.languages as string[]).join(', ') : ''} />
                        <div>
                          <dt className="text-[11px] uppercase tracking-[0.12em] text-dex-muted">Color</dt>
                          <dd className="flex items-center gap-2 text-sm text-dex-ink">
                            {/^#[0-9a-f]{3,8}$/i.test(texto(seleccionada.datos.themeColor)) && (
                              <span aria-hidden className="h-4 w-4 rounded border border-white/20" style={{ background: texto(seleccionada.datos.themeColor) }} />
                            )}
                            {texto(seleccionada.datos.themeColor)}
                          </dd>
                        </div>
                        <Dato k="Frase" v={texto(seleccionada.datos.phrase)} ancho />
                      </dl>
                    </Seccion>
                    <Seccion titulo="Historia (lore)">
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-dex-ink">{texto(seleccionada.datos.cardText)}</p>
                    </Seccion>
                    <Seccion titulo="Perfil y gustos" abierta={false}>
                      <CamposDeFicha s={seleccionada} />
                    </Seccion>
                    <Seccion titulo="Redes y canales">
                      <Redes s={seleccionada} />
                    </Seccion>
                    <Seccion titulo="Imágenes (enlaces)">
                      <dl className="grid gap-2">
                        <Dato k="Avatar" v={texto(seleccionada.datos.imageUrl)} ancho enlace />
                        <Dato k="Logo" v={texto(seleccionada.datos.logoUrl)} ancho enlace />
                      </dl>
                      <p className="mt-2 text-xs text-dex-muted">Llegan como enlace: se descargan y suben desde «Imágenes» (no se aplican solos).</p>
                    </Seccion>
                  </>
                )}

                {seleccionada.tipo === 'modificacion' && (
                  <>
                    <Seccion titulo={vista?.cambios ? `Qué cambia${vista.ficha ? ` en «${vista.ficha.name}»` : ''}` : 'Cambios pedidos'}>
                      {vista?.cambios && vista.cambios.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-sm" data-testid="solicitud-cambios">
                            <thead className="text-[11px] uppercase tracking-[0.12em] text-dex-muted">
                              <tr>
                                <th className="py-1 pr-3 font-semibold">Campo</th>
                                <th className="py-1 pr-3 font-semibold">Ahora</th>
                                <th className="py-1 font-semibold">Propuesto</th>
                              </tr>
                            </thead>
                            <tbody>
                              {vista.cambios.map((c) => (
                                <tr key={c.campo} className="border-t border-dex-line/50 align-top">
                                  <td className="py-1.5 pr-3 text-dex-muted">{c.campo}</td>
                                  <td className="max-w-[18rem] break-words py-1.5 pr-3 text-rose-200/80">{c.nuevo ? <em className="text-dex-muted">(vacío)</em> : c.antes}</td>
                                  <td className="max-w-[22rem] break-words py-1.5 text-emerald-200">{c.despues}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : vista?.cambios ? (
                        <p className="text-sm text-dex-muted">Ningún valor cambia.</p>
                      ) : (
                        <CamposDeFicha s={seleccionada} />
                      )}
                      {vista?.ficha && (
                        <p className="mt-3 text-xs text-dex-muted">
                          Ficha: <span className="font-mono text-dex-ink">#{String(vista.ficha.dexNumber).padStart(3, '0')}</span> {vista.ficha.name} ·{' '}
                          <a href={`/v/${vista.ficha.slug}`} target="_blank" rel="noopener noreferrer" className="text-dex-accent underline underline-offset-2">
                            /v/{vista.ficha.slug}
                          </a>
                        </p>
                      )}
                    </Seccion>
                    <Seccion titulo="Quién la pide">
                      <dl className="grid gap-2">
                        <Dato k="Ficha que escribió" v={texto(seleccionada.datos.ficha)} ancho />
                        <Dato k="Comprobación de titularidad" v={texto(seleccionada.datos.prueba)} ancho />
                        <Dato k="Nota de quien la envía" v={texto(seleccionada.datos.nota)} ancho />
                      </dl>
                    </Seccion>
                    <Seccion titulo="Todo lo que envió" abierta={false}>
                      <CamposDeFicha s={seleccionada} />
                      <div className="mt-3">
                        <Redes s={seleccionada} />
                      </div>
                    </Seccion>
                  </>
                )}

                {seleccionada.tipo === 'baja' && (
                  <Seccion titulo="La baja">
                    <dl className="grid gap-2">
                      <Dato k="Ficha que escribió" v={texto(seleccionada.datos.ficha)} ancho />
                      <Dato k="Comprobación de titularidad" v={texto(seleccionada.datos.prueba)} ancho />
                      <Dato k="Motivo" v={texto(seleccionada.datos.motivo)} ancho />
                    </dl>
                    {vista?.ficha && (
                      <p className="mt-3 text-xs text-dex-muted">
                        Ficha encontrada: <span className="font-mono text-dex-ink">#{String(vista.ficha.dexNumber).padStart(3, '0')}</span> {vista.ficha.name} ·{' '}
                        <a href={`/v/${vista.ficha.slug}`} target="_blank" rel="noopener noreferrer" className="text-dex-accent underline underline-offset-2">
                          /v/{vista.ficha.slug}
                        </a>
                        {vista.ficha.grado && ` · grado ${vista.ficha.grado}`}
                      </p>
                    )}
                  </Seccion>
                )}

                {seleccionada.contacto && (
                  <section className="rounded-xl border border-dex-line bg-dex-void/60 px-3 py-2 text-xs text-dex-muted" data-testid="solicitud-contacto">
                    <strong className="text-dex-ink">Contacto confidencial (no publicar):</strong>{' '}
                    {seleccionada.contacto.email && (
                      <a href={`mailto:${seleccionada.contacto.email}`} className="text-dex-accent underline underline-offset-2">
                        {seleccionada.contacto.email}
                      </a>
                    )}
                    {seleccionada.contacto.realName ? ` · ${seleccionada.contacto.realName}` : ''}
                  </section>
                )}

                {seleccionada.estado !== 'pendiente' && (
                  <p className="rounded-xl border border-dex-line px-3 py-2 text-xs text-dex-muted" data-testid="solicitud-resuelta">
                    {seleccionada.estado} {seleccionada.resuelto ? haceCuanto(seleccionada.resuelto) : ''}
                    {seleccionada.resueltoPor ? ` por ${seleccionada.resueltoPor}` : ''}
                    {seleccionada.vtuberSlug && (
                      <>
                        {' · '}
                        {seleccionada.tipo === 'modificacion' ? 'Ficha modificada: ' : 'Ficha creada (en borrador): '}
                        <a href={`/v/${seleccionada.vtuberSlug}`} target="_blank" rel="noopener noreferrer" className="text-dex-accent underline underline-offset-2">
                          /v/{seleccionada.vtuberSlug}
                        </a>
                      </>
                    )}
                    {seleccionada.nota ? ` · Nota: ${seleccionada.nota}` : ''}
                  </p>
                )}
              </article>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default SolicitudesManager;
