'use client';
/**
 * Cola de SOLICITUDES del mantenedor: las inscripciones y bajas que llegaron por los formularios
 * públicos y esperan revisión.
 *
 *   · Inscripción → «Aprobar» crea la ficha en BORRADOR (hay que publicarla aparte, desde «Fichas»)
 *     y «Rechazar» la cierra.
 *   · Baja → «Marcar procesada» la cierra y «Rechazar» la descarta (p. ej. no se acreditó la
 *     titularidad). Procesar NO toca la ficha: aplicar la cláusula de salida (degradarla) es un
 *     paso manual aparte, y el aviso lo dice para que nadie crea que ya está hecho.
 *
 * Aquí SÍ se ve el contacto confidencial (correo, nombre civil): es para lo que existe. Se borra
 * solo al cerrar una baja o rechazar una solicitud.
 */
import { useCallback, useEffect, useState } from 'react';

import { api, type SolicitudAdmin } from '@/lib/api';
import { ghostButton, inputClass, primaryButton } from '@/components/admin/ui';

type Notify = (kind: 'ok' | 'error', text: string) => void;
type Filtro = 'pendiente' | 'aprobada' | 'procesada' | 'rechazada' | 'todas';

const FILTROS: Array<{ id: Filtro; label: string }> = [
  { id: 'pendiente', label: 'Pendientes' },
  { id: 'aprobada', label: 'Aprobadas' },
  { id: 'procesada', label: 'Procesadas' },
  { id: 'rechazada', label: 'Rechazadas' },
  { id: 'todas', label: 'Todas' },
];

const texto = (valor: unknown) => (typeof valor === 'string' ? valor : '');

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
  const [filtro, setFiltro] = useState<Filtro>('pendiente');
  const [items, setItems] = useState<SolicitudAdmin[]>([]);
  const [pendientes, setPendientes] = useState({ inscripcion: 0, baja: 0 });
  const [cargada, setCargada] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupada, setOcupada] = useState<number | null>(null);
  const [notas, setNotas] = useState<Record<number, string>>({});

  const cargar = useCallback(async () => {
    try {
      const respuesta = await api.solicitudes(token, filtro);
      setItems(respuesta.items);
      setPendientes(respuesta.pendientes);
      setError(null);
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No se pudo leer la cola');
    } finally {
      setCargada(true);
    }
  }, [token, filtro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const resolver = async (solicitud: SolicitudAdmin, accion: 'aprobar' | 'rechazar' | 'procesar') => {
    setOcupada(solicitud.id);
    try {
      await api.resolverSolicitud(token, solicitud.id, accion, notas[solicitud.id] ?? '');
      notify?.('ok', accion === 'aprobar' ? 'Ficha creada en borrador' : accion === 'procesar' ? 'Baja marcada como procesada' : 'Solicitud rechazada');
      await cargar();
      if (accion === 'aprobar') onChanged?.();
    } catch (causa) {
      notify?.('error', causa instanceof Error ? causa.message : 'No se pudo resolver la solicitud');
    } finally {
      setOcupada(null);
    }
  };

  return (
    <section className="space-y-4" data-testid="solicitudes-manager">
      <div className="flex flex-wrap items-center gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            aria-pressed={filtro === f.id}
            className={`rounded-full border px-3 py-1 text-xs ${
              filtro === f.id ? 'border-dex-accent bg-dex-accent/15 text-dex-ink' : 'border-dex-line text-dex-muted hover:text-dex-ink'
            }`}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-dex-muted" data-testid="solicitudes-contador">
          En espera: {pendientes.inscripcion} inscripciones · {pendientes.baja} bajas
        </span>
      </div>

      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {cargada && !error && items.length === 0 && <p className="text-sm text-dex-muted">No hay solicitudes en esta vista.</p>}

      <ul className="space-y-3">
        {items.map((s) => {
          const esInscripcion = s.tipo === 'inscripcion';
          const redes = Array.isArray(s.datos.socials) ? (s.datos.socials as Array<{ platform: string; url: string }>) : [];
          return (
            <li key={s.id} className="rounded-2xl border border-dex-line bg-dex-panel/70 p-4" data-testid={`solicitud-${s.id}`}>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded px-2 py-0.5 font-bold uppercase ${esInscripcion ? 'bg-dex-accent/20 text-dex-accent' : 'bg-amber-300/20 text-amber-200'}`}>
                  {esInscripcion ? 'Inscripción' : 'Baja'}
                </span>
                <span className="text-dex-muted">#{s.id} · {new Date(s.creado).toLocaleString('es-CL')} · estado: {s.estado}</span>
                <span className="ml-auto text-dex-muted" title="Versión de los términos aceptada">términos {s.terminosVersion}</span>
              </div>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {esInscripcion ? (
                  <>
                    <Dato k="Nombre" v={texto(s.datos.name)} />
                    <Dato k="País" v={texto(s.datos.country)} />
                    <Dato k="Idiomas" v={Array.isArray(s.datos.languages) ? (s.datos.languages as string[]).join(', ') : ''} />
                    <Dato k="Color" v={texto(s.datos.themeColor)} />
                    <Dato k="Frase" v={texto(s.datos.phrase)} ancho />
                    <Dato k="Lore" v={texto(s.datos.cardText)} ancho />
                    <Dato k="Signo" v={texto(s.datos.zodiac)} />
                    <Dato k="Estatura" v={texto(s.datos.height)} />
                    <Dato k="Cumpleaños" v={texto(s.datos.birthday)} />
                    <Dato k="Color favorito" v={texto(s.datos.favoriteColor)} />
                    <Dato k="Comida favorita" v={texto(s.datos.favoriteFood)} />
                    <Dato k="Comida que desagrada" v={texto(s.datos.dislikedFood)} />
                    <Dato k="Videojuego" v={texto(s.datos.favoriteGame)} />
                    <Dato k="Serie" v={texto(s.datos.favoriteSeries)} />
                    <Dato k="Música" v={texto(s.datos.favoriteMusic)} />
                    <Dato k="Anime" v={texto(s.datos.favoriteAnime)} />
                    <Dato k="Animal" v={texto(s.datos.favoriteAnimal)} />
                    <Dato k="Modelo (autoría)" v={texto(s.datos.modeler)} />
                    <Dato k="Hashtag de arte" v={texto(s.datos.hashtag)} />
                    <Dato k="Avatar" v={texto(s.datos.imageUrl)} ancho enlace />
                    <Dato k="Logo" v={texto(s.datos.logoUrl)} ancho enlace />
                    {redes.map((r, i) => (
                      <Dato key={i} k={r.platform} v={r.url} ancho enlace />
                    ))}
                  </>
                ) : (
                  <>
                    <Dato k="Ficha" v={texto(s.datos.ficha)} ancho />
                    <Dato k="Comprobación de titularidad" v={texto(s.datos.prueba)} ancho />
                    <Dato k="Motivo" v={texto(s.datos.motivo)} ancho />
                  </>
                )}
              </dl>

              {s.contacto && (
                <p className="mt-3 rounded-lg border border-dex-line bg-dex-void/60 px-3 py-2 text-xs text-dex-muted" data-testid="solicitud-contacto">
                  <strong className="text-dex-ink">Contacto confidencial (no publicar):</strong> {s.contacto.email}
                  {s.contacto.realName ? ` · ${s.contacto.realName}` : ''}
                </p>
              )}

              {!esInscripcion && s.estado === 'pendiente' && (
                <p className="mt-3 text-xs text-amber-200">
                  «Marcar procesada» solo cierra la solicitud: la degradación de la ficha (cláusula de salida) se aplica aparte, desde «Fichas».
                </p>
              )}
              {s.vtuberSlug && <p className="mt-3 text-xs text-dex-muted">Ficha creada: /v/{s.vtuberSlug} (en borrador)</p>}
              {s.nota && s.estado !== 'pendiente' && <p className="mt-2 text-xs text-dex-muted">Nota: {s.nota}</p>}

              {s.estado === 'pendiente' && (
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <input
                    className={`${inputClass} mt-0 max-w-xs`}
                    placeholder="Nota interna (opcional)"
                    aria-label={`Nota de la solicitud ${s.id}`}
                    value={notas[s.id] ?? ''}
                    onChange={(e) => setNotas((actuales) => ({ ...actuales, [s.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className={primaryButton}
                    disabled={ocupada === s.id}
                    onClick={() => void resolver(s, esInscripcion ? 'aprobar' : 'procesar')}
                  >
                    {esInscripcion ? 'Aprobar (crear borrador)' : 'Marcar procesada'}
                  </button>
                  <button type="button" className={ghostButton} disabled={ocupada === s.id} onClick={() => void resolver(s, 'rechazar')}>
                    Rechazar
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Dato({ k, v, ancho = false, enlace = false }: { k: string; v: string; ancho?: boolean; enlace?: boolean }) {
  if (!v) return null;
  const esUrl = enlace && /^https?:\/\//i.test(v);
  return (
    <div className={ancho ? 'sm:col-span-2' : ''}>
      <dt className="inline text-xs uppercase tracking-[0.12em] text-dex-muted">{k}: </dt>
      <dd className="inline break-words text-dex-ink">
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
