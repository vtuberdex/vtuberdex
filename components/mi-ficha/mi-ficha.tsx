'use client';

/**
 * «Mi ficha» (`/mi-ficha#t=<token>`): donde un VTuber reparte los puntos de habilidad que ganó al subir de nivel.
 *
 * Pensada para quien no es técnico: un número grande («Puntos para repartir»), una lista de habilidades con
 * su rango en puntitos y UN botón «Subir» por habilidad. Nada se escribe ni se paga: cada clic gasta un
 * punto y el rango se ve al instante. Si algo falla, el mensaje dice qué hacer.
 *
 * El token (el enlace mágico del correo) vive en el FRAGMENTO de la URL: no llega a nginx ni a los logs, y
 * se queda en la barra para que recargar la página o guardarla en favoritos siga funcionando. NO se gasta al
 * abrir: dura 7 días y se puede volver a él. Sin token, la pantalla ofrece pedir el enlace con el correo.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { Aviso, claseBoton, claseInput, claseEtiqueta } from '@/components/solicitudes/campos';
import { ApiError, api, type EstadoDeStats, type HabilidadMejorable, type RespuestaMiFicha, type VistaMiFicha } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { Clave } from '@/lib/i18n/mensajes';

const CATEGORIAS: Array<HabilidadMejorable['category']> = ['active', 'passive', 'ultimate', 'other'];

/** Pide el enlace con el correo. Responde igual para cualquiera: no dice si el correo está inscrito. */
export function PedirEnlace({ aviso }: { aviso?: string }) {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      await api.pedirEnlaceDeMiFicha(email.trim());
      setListo(true);
    } catch (causa) {
      setError(causa instanceof ApiError ? causa.message : t('mificha.pedirError'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/70 p-5" data-testid="mificha-pedir">
      {aviso && <Aviso tipo="error">{aviso}</Aviso>}
      <div>
        <h2 className="text-base font-bold text-dex-ink">{t('mificha.pedirTitulo')}</h2>
        <p className="mt-1 text-sm text-dex-muted">{t('mificha.pedirTexto')}</p>
      </div>
      {listo ? (
        <Aviso tipo="ok">{t('mificha.pedirListo')}</Aviso>
      ) : (
        <>
          <label className={claseEtiqueta}>
            {t('ficha.correo')}
            <input type="email" required maxLength={200} autoComplete="email" className={claseInput} value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <Aviso tipo="error">{error}</Aviso>}
          <button type="submit" disabled={enviando} className={claseBoton}>
            {enviando ? t('mificha.pedirEnviando') : t('mificha.pedirBoton')}
          </button>
        </>
      )}
    </form>
  );
}

/** Los puntitos del rango: llenos los que ya tiene, vacíos los que faltan. */
function Rango({ n, max, etiqueta }: { n: number; max: number; etiqueta: string }) {
  return (
    <span className="flex items-center gap-1" role="img" aria-label={etiqueta}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < n ? 'bg-dex-accent' : 'border border-dex-line'}`} />
      ))}
    </span>
  );
}

/**
 * Los stats de «Mi ficha»: su propia bolsa de puntos (aparte de las habilidades) y la lista de los que se suben
 * gastándolos, más los que crecen solos con los niveles (solo lectura).
 */
function SeccionStats({
  estado,
  ocupada,
  confirmando,
  alSubir,
  alReiniciar,
  alConfirmar,
}: {
  estado: EstadoDeStats;
  ocupada: string | null;
  confirmando: boolean;
  alSubir: (slug: string, nombre: string) => void;
  alReiniciar: () => void;
  alConfirmar: (abierto: boolean) => void;
}) {
  const { t } = useI18n();
  return (
    <section className="space-y-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-5" data-testid="mificha-stats">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">{t('mificha.statsTitulo')}</h3>
        <p className="mt-2 text-4xl font-extrabold text-dex-ink" data-testid="mificha-stats-disponibles">{estado.disponibles}</p>
        <p className="mt-1 text-xs text-dex-muted">{t('mificha.statsTexto', { por: estado.puntosPorNivel })}</p>
        <p className="mt-1 text-xs text-dex-muted">{t('mificha.statsDisponibles', { n: estado.disponibles, a: estado.repartidos, b: estado.ganados })}</p>
      </div>
      <ul className="space-y-2">
        {estado.stats.map((s) => (
          <li key={s.slug} className="flex items-center gap-3 rounded-xl border border-dex-line/80 bg-black/25 px-4 py-3" data-testid="mificha-stat">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-bold text-dex-ink">{s.label}</span>
              <span className="block font-mono text-xs text-dex-muted">
                {s.valor.toLocaleString()} <span className="opacity-70">({t('mificha.statsPaso', { paso: s.paso })})</span>
              </span>
            </span>
            <button
              type="button"
              disabled={estado.disponibles < 1 || !s.puedeSubir || ocupada !== null}
              onClick={() => alSubir(s.slug, s.label)}
              className="rounded-lg border border-dex-accent px-3 py-1.5 text-xs font-bold text-dex-accent hover:bg-dex-accent/15 disabled:cursor-not-allowed disabled:border-dex-line disabled:text-dex-muted disabled:hover:bg-transparent"
              aria-label={`${t('mificha.subir')}: ${s.label}`}
            >
              {!s.puedeSubir ? t('mificha.maximo') : ocupada === s.slug ? t('mificha.subiendo') : `+ ${t('mificha.subir')}`}
            </button>
          </li>
        ))}
      </ul>
      {estado.repartidos > 0 &&
        (confirmando ? (
          <div className="space-y-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-dex-ink">
            <p>{t('mificha.statsReiniciarConfirma', { n: estado.repartidos })}</p>
            <div className="flex gap-2">
              <button type="button" disabled={ocupada !== null} onClick={() => alReiniciar()} className={claseBoton}>{t('mificha.reiniciarSi')}</button>
              <button type="button" onClick={() => alConfirmar(false)} className="rounded-xl border border-dex-line px-4 py-2 text-sm text-dex-muted hover:text-dex-ink">{t('mificha.reiniciarNo')}</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => alConfirmar(true)} className="rounded-xl border border-dex-line px-4 py-2 text-sm text-dex-muted hover:text-dex-ink">{t('mificha.statsReiniciar')}</button>
        ))}
      {estado.automaticos.length > 0 && (
        <div data-testid="mificha-stats-auto">
          <h4 className="text-xs font-bold uppercase tracking-[0.14em] text-dex-muted">{t('mificha.statsAutoTitulo')}</h4>
          <p className="mt-1 text-xs text-dex-muted">{t('mificha.statsAutoTexto')}</p>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {estado.automaticos.map((a) => (
              <li key={a.slug} className="rounded-xl border border-dex-line/80 bg-black/25 px-4 py-2">
                <span className="block text-sm font-bold text-dex-ink">{a.label}</span>
                <span className="block font-mono text-xs text-dex-muted">
                  {a.valor.toLocaleString()} · {t('mificha.statsAutoCada', { suma: a.suma, cada: a.cada })}
                  {a.tope !== null && <> · {t('mificha.statsAutoTope', { tope: a.tope })}</>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export function MiFicha() {
  const { t } = useI18n();
  const [token, setToken] = useState<string | null>(null);
  const [listo, setListo] = useState(false);
  const [datos, setDatos] = useState<RespuestaMiFicha | null>(null);
  const [error, setError] = useState<{ tipo: 'caducado' | 'sin_fichas' | 'otro'; texto?: string } | null>(null);
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [confirmandoStats, setConfirmandoStats] = useState(false);

  const cargar = useCallback(async (tk: string, slug?: string) => {
    try {
      setDatos(await api.miFicha(tk, slug));
      setError(null);
    } catch (causa) {
      const estado = causa instanceof ApiError ? causa.status : 0;
      setError({ tipo: estado === 410 ? 'caducado' : estado === 404 ? 'sin_fichas' : 'otro' });
    }
  }, []);

  useEffect(() => {
    const m = window.location.hash.match(/(?:^#|&)t=([^&]+)/);
    const tk = m ? decodeURIComponent(m[1]) : null;
    setToken(tk);
    setListo(true);
    if (tk) void cargar(tk);
  }, [cargar]);

  const aplicar = async (accion: 'subir' | 'reiniciar' | 'subir-stat' | 'reiniciar-stats', ficha: VistaMiFicha, clave?: string, nombre?: string) => {
    if (!token) return;
    setOcupada(clave ?? 'reiniciar');
    setAviso(null);
    try {
      const r = await api.repartirPuntos(token, ficha.slug, accion, clave);
      setDatos((actual) => (actual ? { ...actual, ficha: r.ficha } : actual));
      if (accion === 'subir' && clave) {
        const nuevo = r.ficha.puntos.habilidades.find((h) => h.clave === clave);
        setAviso({ tipo: 'ok', texto: t('mificha.subioA', { nombre: nombre ?? '', n: nuevo?.rango ?? 0 }) });
      } else if (accion === 'subir-stat' && clave) {
        const nuevo = r.ficha.statsPuntos?.stats.find((s) => s.slug === clave);
        setAviso({ tipo: 'ok', texto: t('mificha.statsSubioA', { nombre: nombre ?? '', valor: nuevo?.valor ?? 0 }) });
      } else {
        setConfirmando(false);
        setConfirmandoStats(false);
      }
    } catch (causa) {
      if (causa instanceof ApiError && causa.status === 410) setError({ tipo: 'caducado' });
      else setAviso({ tipo: 'error', texto: causa instanceof ApiError ? causa.message : t('mificha.errorGeneral') });
    } finally {
      setOcupada(null);
    }
  };

  if (!listo) return <p className="text-sm text-dex-muted">{t('mificha.cargando')}</p>;
  if (!token) return <PedirEnlace />;
  if (error?.tipo === 'caducado') return <PedirEnlace aviso={t('mificha.enlaceCaducado')} />;
  if (error?.tipo === 'sin_fichas') return <Aviso tipo="error">{t('mificha.sinFichas')}</Aviso>;
  if (error) return <Aviso tipo="error">{t('mificha.error')}</Aviso>;
  if (!datos) return <p className="text-sm text-dex-muted" data-testid="mificha-cargando">{t('mificha.cargando')}</p>;

  return (
    <MiFichaVista
      datos={datos}
      ocupada={ocupada}
      aviso={aviso}
      confirmando={confirmando}
      confirmandoStats={confirmandoStats}
      alSubirStat={(slug, nombre) => void aplicar('subir-stat', datos.ficha, slug, nombre)}
      alReiniciarStats={() => void aplicar('reiniciar-stats', datos.ficha)}
      alConfirmarStats={setConfirmandoStats}
      alElegirFicha={(slug) => token && void cargar(token, slug)}
      alSubir={(clave, nombre) => void aplicar('subir', datos.ficha, clave, nombre)}
      alReiniciar={() => void aplicar('reiniciar', datos.ficha)}
      alConfirmar={setConfirmando}
    />
  );
}

/**
 * La pantalla de «Mi ficha», sin lógica: recibe los datos y avisa de lo que se pulsa. Así la usa también la página
 * explicativa `/niveles` como MAQUETA real (mismo código, datos de ejemplo): lo que se explica es lo que se verá.
 */
export function MiFichaVista({
  datos,
  ocupada = null,
  aviso = null,
  confirmando = false,
  confirmandoStats = false,
  alSubirStat = () => {},
  alReiniciarStats = () => {},
  alConfirmarStats = () => {},
  alElegirFicha = () => {},
  alSubir = () => {},
  alReiniciar = () => {},
  alConfirmar = () => {},
}: {
  datos: RespuestaMiFicha;
  ocupada?: string | null;
  aviso?: { tipo: 'ok' | 'error'; texto: string } | null;
  confirmando?: boolean;
  confirmandoStats?: boolean;
  alSubirStat?: (slug: string, nombre: string) => void;
  alReiniciarStats?: () => void;
  alConfirmarStats?: (abierto: boolean) => void;
  alElegirFicha?: (slug: string) => void;
  alSubir?: (clave: string, nombre: string) => void;
  alReiniciar?: () => void;
  alConfirmar?: (abierto: boolean) => void;
}) {
  const { t } = useI18n();
  const { ficha, fichas } = datos;
  const { puntos } = ficha;
  const falta = Math.max(0, ficha.experience.max - ficha.experience.current);
  const porcentaje = Math.min(100, Math.round((ficha.experience.current / Math.max(1, ficha.experience.max)) * 100));

  return (
    <div className="space-y-6" data-testid="mificha">
      {fichas.length > 1 && (
        <label className={claseEtiqueta}>
          {t('mificha.queFicha')}
          <select className={claseInput} value={ficha.slug} onChange={(e) => alElegirFicha(e.target.value)}>
            {fichas.map((f) => (
              <option key={f.slug} value={f.slug}>{f.name}</option>
            ))}
          </select>
        </label>
      )}

      <section className="rounded-2xl border border-dex-line bg-dex-panel/70 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-extrabold text-dex-ink">{ficha.name}</h2>
          <span className="rounded-lg border border-dex-line px-2 py-0.5 font-mono text-xs text-dex-ink">{t('mificha.nivel', { n: ficha.level })}</span>
        </div>
        <div className="mt-3 flex justify-between text-[11px] uppercase tracking-[0.12em] text-dex-muted">
          <span>{t('atributos.experiencia')}</span>
          <span className="font-mono">{ficha.experience.current} / {ficha.experience.max}</span>
        </div>
        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label={t('atributos.experiencia')} aria-valuemin={0} aria-valuemax={ficha.experience.max} aria-valuenow={ficha.experience.current}>
          <div className="h-full rounded-full bg-dex-accent transition-[width] duration-500" style={{ width: `${porcentaje}%` }} />
        </div>
        <p className="mt-1.5 flex justify-between text-[11px] uppercase tracking-[0.12em] text-dex-muted">
          <span>{t('atributos.expTotal')}</span>
          <span className="font-mono" data-testid="mificha-total">{ficha.experience.total.toLocaleString()}</span>
        </p>
        <p className="mt-3 text-xs text-dex-muted">{t('mificha.siguienteNivel', { n: falta, sig: ficha.level + 1 })}</p>
      </section>

      <section className="rounded-2xl border border-dex-accent/40 bg-dex-accent/10 p-5" aria-live="polite">
        <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">{t('mificha.puntosTitulo')}</p>
        <p className="mt-1 text-5xl font-extrabold text-dex-ink" data-testid="mificha-disponibles">{puntos.disponibles}</p>
        <p className="mt-2 text-sm text-dex-ink/85">
          {puntos.disponibles === 0
            ? t('mificha.puntosCero', { por: puntos.puntosPorNivel })
            : puntos.disponibles === 1
              ? t('mificha.puntosUno')
              : t('mificha.puntosVarios', { n: puntos.disponibles })}
        </p>
        <p className="mt-1 text-xs text-dex-muted">{t('mificha.resumen', { a: puntos.repartidos, b: puntos.ganados })}</p>
      </section>

      {aviso && <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso>}

      {ficha.statsPuntos && (
        <SeccionStats
          estado={ficha.statsPuntos}
          ocupada={ocupada}
          confirmando={confirmandoStats}
          alSubir={alSubirStat}
          alReiniciar={alReiniciarStats}
          alConfirmar={alConfirmarStats}
        />
      )}

      {puntos.habilidades.length === 0 ? (
        <p className="text-sm text-dex-muted">{t('mificha.sinHabilidades')}</p>
      ) : (
        CATEGORIAS.map((categoria) => {
          const lista = puntos.habilidades.filter((h) => h.category === categoria);
          if (!lista.length) return null;
          return (
            <section key={categoria} className="rounded-2xl border border-dex-line bg-dex-panel/60 p-5">
              <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">{t(`mificha.categoria.${categoria}` as Clave)}</h3>
              <ul className="mt-3 space-y-2">
                {lista.map((h) => {
                  const enMaximo = h.rango >= puntos.rangoMaximo;
                  const puede = puntos.disponibles > 0 && !enMaximo;
                  return (
                    <li key={h.clave} className="flex items-center gap-3 rounded-xl border border-dex-line/80 bg-black/25 px-4 py-3" data-testid="mificha-habilidad">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-bold text-dex-ink">{h.name}</span>
                        <span className="mt-1 block"><Rango n={h.rango} max={puntos.rangoMaximo} etiqueta={t('mificha.rango', { n: h.rango, max: puntos.rangoMaximo })} /></span>
                      </span>
                      <button
                        type="button"
                        disabled={!puede || ocupada !== null}
                        onClick={() => alSubir(h.clave, h.name)}
                        className="rounded-lg border border-dex-accent px-3 py-1.5 text-xs font-bold text-dex-accent hover:bg-dex-accent/15 disabled:cursor-not-allowed disabled:border-dex-line disabled:text-dex-muted disabled:hover:bg-transparent"
                        aria-label={`${t('mificha.subir')}: ${h.name}`}
                      >
                        {enMaximo ? t('mificha.maximo') : ocupada === h.clave ? t('mificha.subiendo') : `+ ${t('mificha.subir')}`}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}

      {puntos.repartidos > 0 && (
        <div className="space-y-2">
          {confirmando ? (
            <div className="space-y-3 rounded-xl border border-amber-300/40 bg-amber-300/10 p-4 text-sm text-dex-ink">
              <p>{t('mificha.reiniciarConfirma', { n: puntos.repartidos })}</p>
              <div className="flex gap-2">
                <button type="button" disabled={ocupada !== null} onClick={() => alReiniciar()} className={claseBoton}>{t('mificha.reiniciarSi')}</button>
                <button type="button" onClick={() => alConfirmar(false)} className="rounded-xl border border-dex-line px-4 py-2 text-sm text-dex-muted hover:text-dex-ink">{t('mificha.reiniciarNo')}</button>
              </div>
            </div>
          ) : (
            <>
              <button type="button" onClick={() => alConfirmar(true)} className="rounded-xl border border-dex-line px-4 py-2 text-sm text-dex-muted hover:text-dex-ink">{t('mificha.reiniciar')}</button>
              <p className="text-xs text-dex-muted">{t('mificha.reiniciarAyuda')}</p>
            </>
          )}
        </div>
      )}

      <Link href={`/v/${ficha.slug}`} className="inline-block text-sm text-dex-accent underline underline-offset-2">
        {t('mificha.verFicha')}
      </Link>
    </div>
  );
}


export default MiFicha;
