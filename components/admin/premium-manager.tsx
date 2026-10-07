'use client';
/**
 * Mantenedor de las cartas PREMIUM: quién la tiene, en qué grado y cuándo subió por última vez.
 *
 * El flujo es el del negocio. Un VTuber que dona recibe su carta gradeada partiendo del 6; cada mes que
 * sigue donando se le sube medio punto (… 9,5 → 10) y, después del 10, pasa a la Black Label. El
 * mantenedor NO calcula los meses solo: la donación es un dato que sabe una persona, así que el botón
 * «Subir a …» es el gesto mensual y el filtro «Por subir este mes» le dice a quién le falta revisar.
 *
 * DISEÑO (por qué se ve así): antes cada carta era una tarjeta alta con cuatro o cinco controles, todas
 * apiladas: con decenas de premium era una sábana donde no se encontraba nada. Ahora:
 *   · UNA LÍNEA por carta con lo que se mira siempre (número, nombre, grado, último cambio) y el único
 *     botón que se usa cada mes («Subir a …»);
 *   · lo raro (corregir el grado, degradar, quitar) vive en «Más», que se abre bajo la fila;
 *   · filtros por tramo CON contadores, búsqueda dentro de la lista, orden y paginación;
 *   · el alta es un panel que se abre con «+ Nueva premium», no media pantalla fija.
 *
 * La escala y sus reglas viven en `server/src/premium.mjs`; esto solo las presenta. La lógica de filtros,
 * orden y paginación está en `premium-lista.ts` (pura y probada).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import { api } from '@/lib/api';
import { dexDeCodigo } from '@/lib/donar';
import {
  GRADOS,
  GRADOS_DEGRADADOS,
  GRADO_DE_BAJA,
  GRADO_INICIAL,
  esGradoDegradado,
  gradoSiguiente,
  leyendaDePremium,
  mesesEntre,
  mismoMes,
  nombreDeGrado,
  textoDeRacha,
} from '@/lib/premium';
import type { PremiumGrade, VtuberCard } from '@/lib/types';
import { PremiumBadge } from '@/components/premium-badge';
import { Reason, ghostButton, inputClass, labelClass, primaryButton } from '@/components/admin/ui';
import {
  FILTROS,
  ORDENES,
  coincideConTexto,
  contarPorFiltro,
  ordenar,
  paginar,
  perteneceAlFiltro,
  type FiltroPremium,
  type OrdenPremium,
} from '@/components/admin/premium-lista';

type Notify = (kind: 'ok' | 'error', text: string) => void;
type Guardar = (row: VtuberCard, premium: { grade: PremiumGrade } | null, okText: string) => Promise<void>;

/** Tamaño de página que se pide a la API; se pide página tras página hasta traerlas TODAS (antes se cortaba en 100). */
const PEDIDO_POR_PAGINA = 100;
const MAX_PAGINAS_PEDIDAS = 30;

const dexTexto = (n: number) => `#${String(n).padStart(3, '0')}`;
/**
 * Columnas de la lista en pantallas anchas. La última es de ANCHO FIJO (no `auto`): con `auto` el encabezado y las
 * filas calculaban anchos distintos y los títulos quedaban desalineados de sus datos.
 */
const COLUMNAS = 'md:grid-cols-[3.5rem_minmax(0,1fr)_5rem_9rem_15rem]';

async function cargarTodas(token: string, signal: AbortSignal): Promise<VtuberCard[]> {
  const todas: VtuberCard[] = [];
  for (let page = 1; page <= MAX_PAGINAS_PEDIDAS; page += 1) {
    const response = await api.adminList(token, { premium: true, perPage: PEDIDO_POR_PAGINA, page }, signal);
    todas.push(...response.items);
    if (page >= (response.pageCount ?? 1)) break;
  }
  return todas;
}

/** Cuándo se cambió el grado por última vez y si toca revisarla este mes. */
function UltimoCambio({ row }: { row: VtuberCard }) {
  const premium = row.premium;
  if (!premium) return null;
  const siguiente = gradoSiguiente(premium.grade);
  let aviso: { texto: string; clase: string } | null = null;
  if (esGradoDegradado(premium.grade)) aviso = null;
  else if (siguiente === null) aviso = { texto: 'grado máximo', clase: 'text-dex-muted' };
  else if (mismoMes(premium.gradedAt)) aviso = { texto: '✓ subió este mes', clase: 'text-emerald-300' };
  else aviso = { texto: 'por revisar', clase: 'text-amber-200' };
  return (
    <span className="flex flex-col leading-tight">
      <span className="font-mono text-xs text-dex-ink">{premium.gradedAt}</span>
      {aviso && <span className={`text-[11px] ${aviso.clase}`}>{aviso.texto}</span>}
    </span>
  );
}

/** El panel «Más»: lo que no se usa cada mes. */
function PanelMas({
  row,
  busy,
  guardar,
  confirmando,
  setConfirmando,
}: {
  row: VtuberCard;
  busy: boolean;
  guardar: Guardar;
  confirmando: boolean;
  setConfirmando: (valor: boolean) => void;
}) {
  const premium = row.premium!;
  const degradada = esGradoDegradado(premium.grade);
  const siguiente = gradoSiguiente(premium.grade);
  // Arranca en el deterioro MÁS LEVE: el grado 1 (la baja) deja la ficha sin página pública y con el nombre oculto,
  // así que nunca debe ser el valor por defecto de un botón. Para el 1 se pide confirmación (ver abajo).
  const [gradoDeterioro, setGradoDeterioro] = useState<PremiumGrade>(GRADOS_DEGRADADOS[0]);
  const [confirmandoBaja, setConfirmandoBaja] = useState(false);
  const esBaja = gradoDeterioro === GRADO_DE_BAJA;

  return (
    <div className="grid gap-4 border-t border-dex-line/70 px-3 py-3 text-xs md:grid-cols-3" data-testid="premium-mas">
      <div className="space-y-1 text-dex-muted">
        <p className="font-bold uppercase tracking-[0.14em]">Detalles</p>
        <p>
          Certificado <span className="font-mono text-dex-ink">{premium.cert}</span>
        </p>
        <p>
          {degradada ? 'Degradada' : 'Premium'} desde {premium.since} ({mesesEntre(premium.since)} meses)
        </p>
        <p>Último cambio de grado: {premium.gradedAt}</p>
        {siguiente && mismoMes(premium.gradedAt) && !degradada && (
          <div className="pt-1">
            <Reason>Ya cambió de grado este mes ({premium.gradedAt}): sube otra vez solo si de verdad corresponde.</Reason>
          </div>
        )}
      </div>

      <div className="space-y-1">
        <label className={labelClass}>
          Fijar grado
          <select
            aria-label={`Grado de ${row.name}`}
            value={premium.grade}
            disabled={busy}
            onChange={(event) => guardar(row, { grade: event.target.value as PremiumGrade }, `${row.name}: grado ${event.target.value}.`)}
            className={`${inputClass} w-32`}
          >
            <optgroup label="Deterioro">
              {GRADOS_DEGRADADOS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
            <optgroup label="Premium">
              {GRADOS.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <p className="text-[11px] text-dex-muted">Para corregir un error o registrar a quien ya donaba.</p>
      </div>

      <div className="space-y-2">
        {degradada ? (
          <button
            type="button"
            className={ghostButton}
            disabled={busy || premium.grade === GRADO_DE_BAJA}
            onClick={() => guardar(row, { grade: GRADO_DE_BAJA }, `${row.name} queda ilegible (grado ${GRADO_DE_BAJA}).`)}
          >
            {premium.grade === GRADO_DE_BAJA ? 'Ya está en el grado 1' : 'Llevar al grado 1 (baja)'}
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Grado de deterioro de ${row.name}`}
              value={gradoDeterioro}
              onChange={(event) => {
                setGradoDeterioro(event.target.value as PremiumGrade);
                setConfirmandoBaja(false);
              }}
              className={`${inputClass} !mt-0 w-auto`}
            >
              {GRADOS_DEGRADADOS.map((item) => (
                <option key={item} value={item}>
                  {item === GRADO_DE_BAJA ? '1 · ilegible (baja)' : `${item} · ${nombreDeGrado(item)}`}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={ghostButton}
              disabled={busy}
              onClick={() => (esBaja ? setConfirmandoBaja(true) : guardar(row, { grade: gradoDeterioro }, `${row.name} queda degradada (${gradoDeterioro}).`))}
            >
              {esBaja ? 'Dar de baja (grado 1)' : 'Degradar'}
            </button>
          </div>
        )}
        {confirmandoBaja && !degradada && (
          <span className="flex flex-wrap items-center gap-2 text-amber-200" data-testid="premium-confirmar-baja">
            ¿Dar de baja a {row.name}? Su ficha dejará de tener página pública.
            <button
              type="button"
              className={ghostButton}
              disabled={busy}
              onClick={() => guardar(row, { grade: GRADO_DE_BAJA }, `${row.name} queda ilegible (grado ${GRADO_DE_BAJA}).`)}
            >
              Sí, dar de baja
            </button>
            <button type="button" className={ghostButton} onClick={() => setConfirmandoBaja(false)}>
              No
            </button>
          </span>
        )}
        {confirmando ? (
          <span className="flex flex-wrap items-center gap-2 text-dex-muted">
            ¿Quitar el premium a {row.name}?
            <button type="button" className={ghostButton} disabled={busy} onClick={() => guardar(row, null, `${row.name} vuelve a carta normal.`)}>
              Sí, quitar
            </button>
            <button type="button" className={ghostButton} onClick={() => setConfirmando(false)}>
              No
            </button>
          </span>
        ) : (
          <button type="button" className={`${ghostButton} block`} onClick={() => setConfirmando(true)}>
            Quitar premium
          </button>
        )}
      </div>
    </div>
  );
}

function Fila({
  row,
  abierta,
  alternar,
  busy,
  guardar,
  confirmando,
  setConfirmando,
}: {
  row: VtuberCard;
  abierta: boolean;
  alternar: () => void;
  busy: boolean;
  guardar: Guardar;
  confirmando: boolean;
  setConfirmando: (valor: boolean) => void;
}) {
  const premium = row.premium;
  if (!premium) return null;
  const degradada = esGradoDegradado(premium.grade);
  const siguiente = gradoSiguiente(premium.grade);
  const racha = textoDeRacha(premium);

  // El botón relleno es para el TRABAJO PENDIENTE: solo lo lleva quien está por revisar este mes. Quien ya subió se ve
  // en contorno, y el grado máximo en gris: si todos los botones son iguales de llamativos, ninguno destaca.
  const yaSubio = siguiente !== null && mismoMes(premium.gradedAt);
  const claseSubir = !siguiente
    ? `${ghostButton} !px-3`
    : yaSubio
      ? 'rounded-lg border border-dex-accent/40 px-3 py-1.5 text-xs font-semibold text-dex-accent hover:bg-dex-accent/10 disabled:opacity-50'
      : `${primaryButton} !px-3 !py-1.5 !text-xs`;

  return (
    <li
      data-testid="premium-row"
      className={`rounded-xl border bg-dex-panel/60 ${abierta ? 'border-dex-accent/50' : 'border-dex-line'}`}
    >
      {/*
        Móvil: DOS líneas (nombre y grado / estado y acciones). Escritorio: una fila de rejilla. Los `md:contents`
        hacen que los hijos de cada línea pasen a ser celdas de la rejilla grande.
      */}
      <div className={`flex flex-col gap-1.5 px-3 py-2.5 md:grid md:items-center md:gap-x-3 ${COLUMNAS}`}>
        <div className="flex min-w-0 items-center gap-2 md:contents">
          <span className="font-mono text-[11px] text-dex-muted">{dexTexto(row.dexNumber)}</span>
          <span className="flex min-w-0 flex-1 flex-col md:flex-none">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-sm font-bold text-dex-ink">{row.name}</span>
              {row.status !== 'published' && (
                <span className="shrink-0 rounded bg-amber-500/20 px-1.5 text-[10px] text-amber-200" title="No se ve en el catálogo público">
                  {row.status === 'draft' ? 'borrador' : 'oculto'}
                </span>
              )}
            </span>
            {racha && <span className="text-[11px] leading-tight text-dex-muted">{racha}</span>}
          </span>
          <span className="shrink-0">
            <PremiumBadge premium={premium} compacto />
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 md:contents">
          <UltimoCambio row={row} />
          <span className="flex items-center justify-end gap-2">
            {degradada ? (
              <span className="text-[11px] text-dex-muted">deteriorada</span>
            ) : (
              <button
                type="button"
                className={claseSubir}
                disabled={busy || siguiente === null}
                onClick={() => siguiente && guardar(row, { grade: siguiente }, `${row.name} sube a ${leyendaDePremium({ grade: siguiente })}.`)}
              >
                {siguiente ? `Subir a ${siguiente === 'BL' ? 'Black Label' : siguiente}` : 'Grado máximo'}
              </button>
            )}
            <button
              type="button"
              className={ghostButton}
              aria-expanded={abierta}
              aria-label={`Más opciones de ${row.name}`}
              onClick={alternar}
            >
              Más {abierta ? '▴' : '▾'}
            </button>
          </span>
        </div>
      </div>
      {abierta && <PanelMas row={row} busy={busy} guardar={guardar} confirmando={confirmando} setConfirmando={setConfirmando} />}
    </li>
  );
}

export function PremiumManager({
  token,
  notify,
  onChanged,
}: {
  token: string;
  notify?: Notify;
  /** Cambiar el premium cambia lo que se ve de la ficha: el padre refresca lista y métricas. */
  onChanged?: () => void;
}) {
  const [rows, setRows] = useState<VtuberCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [abiertaId, setAbiertaId] = useState<number | null>(null);

  const [filtro, setFiltro] = useState<FiltroPremium>('todas');
  const [orden, setOrden] = useState<OrdenPremium>('grado-desc');
  const [texto, setTexto] = useState('');
  const [pagina, setPagina] = useState(1);

  const [altaAbierta, setAltaAbierta] = useState(false);
  const [query, setQuery] = useState('');
  const [candidates, setCandidates] = useState<VtuberCard[]>([]);
  const [grade, setGrade] = useState<PremiumGrade>(GRADO_INICIAL);
  /** Grado con el que se DEGRADA una ficha que no era premium (por defecto el de las bajas). */
  const [gradeDeterioro, setGradeDeterioro] = useState<PremiumGrade>(GRADO_DE_BAJA);
  const say: Notify = (kind, text) => notify?.(kind, text);

  useEffect(() => {
    const controller = new AbortController();
    cargarTodas(token, controller.signal)
      .then((items) => {
        setRows(items);
        setLoaded(true);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, version]);

  // Sin ninguna premium el siguiente paso es obvio: el alta se muestra abierta.
  const altaVisible = altaAbierta || (loaded && rows.length === 0);

  // Candidatas al alta: las que coinciden con la búsqueda y todavía no son premium.
  useEffect(() => {
    const term = query.trim();
    if (!altaVisible || term.length < 2) {
      setCandidates([]);
      return;
    }
    const controller = new AbortController();
    /**
     * Un código `VTD-016` es lo que el donante escribe en la nota de PayPal (ver `lib/donar.ts`):
     * es el número de dex, así que se busca por número y se descartan las fichas cuyo dex no
     * coincide EXACTO (la búsqueda por número también encuentra textos que contienen esas cifras).
     */
    const dexPorCodigo = dexDeCodigo(term);
    if (dexPorCodigo !== null) {
      api
        .adminList(token, { q: String(dexPorCodigo), perPage: 20 }, controller.signal)
        .then((response) => setCandidates(response.items.filter((item) => item.dexNumber === dexPorCodigo && !item.premium)))
        .catch(() => setCandidates([]));
      return () => controller.abort();
    }
    api
      .adminList(token, { q: term, perPage: 8 }, controller.signal)
      .then((response) => setCandidates(response.items.filter((item) => !item.premium)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, query, version, altaVisible]);

  const save = useCallback<Guardar>(
    async (row, premium, okText) => {
      setBusyId(row.id);
      try {
        await api.updateVtuber(token, row.id, { premium });
        say('ok', okText);
        setVersion((current) => current + 1);
        onChanged?.();
      } catch (cause) {
        say('error', cause instanceof Error ? cause.message : 'No se pudo guardar el premium.');
      } finally {
        setBusyId(null);
        setConfirmingId(null);
      }
    },
    // `say` cierra sobre `notify`; basta con él.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token, notify, onChanged],
  );

  const conteo = useMemo(() => contarPorFiltro(rows), [rows]);
  const visibles = useMemo(
    () => ordenar(rows.filter((row) => perteneceAlFiltro(row, filtro) && coincideConTexto(row, texto)), orden),
    [rows, filtro, texto, orden],
  );
  const pag = paginar(visibles, pagina);
  const hayFiltros = filtro !== 'todas' || texto.trim() !== '';

  const elegirFiltro = (valor: FiltroPremium) => {
    setFiltro(valor);
    setPagina(1);
  };
  const limpiarFiltros = () => {
    setFiltro('todas');
    setTexto('');
    setPagina(1);
  };

  return (
    <div className="space-y-4" data-testid="premium-manager">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
            Cartas premium <span className="font-mono text-dex-ink">{rows.length}</span>
          </h2>
          {loaded && conteo['por-subir'] > 0 && (
            <p className="mt-0.5 text-xs text-amber-200">
              {conteo['por-subir']} {conteo['por-subir'] === 1 ? 'carta pendiente' : 'cartas pendientes'} de revisar este mes.
            </p>
          )}
        </div>
        <button type="button" className={altaVisible ? ghostButton : primaryButton} aria-expanded={altaVisible} onClick={() => setAltaAbierta((v) => !v)}>
          {altaVisible && rows.length > 0 ? 'Cerrar' : '+ Nueva premium'}
        </button>
      </header>

      {altaVisible && (
        <section className="space-y-3 rounded-2xl border border-dex-accent/40 bg-dex-panel/60 p-4" data-testid="premium-alta">
          <p className="text-xs text-dex-muted">
            Escribe el nombre, el número o el código <span className="font-mono">VTD-016</span> que el donante puso en la nota de PayPal.
            Lo normal es entrar con el {GRADO_INICIAL}; sube medio punto por mes.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
            <label className={labelClass}>
              Buscar ficha
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className={inputClass}
                placeholder="nombre, número o código VTD-…"
                aria-label="Buscar ficha para hacerla premium"
              />
            </label>
            <label className={labelClass}>
              Grado inicial
              <select aria-label="Grado inicial" value={grade} onChange={(event) => setGrade(event.target.value as PremiumGrade)} className={inputClass}>
                {GRADOS.map((item) => (
                  <option key={item} value={item}>
                    {item === 'BL' ? 'BL · Black Label' : item}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="dex-scroll max-h-64 space-y-1 overflow-y-auto" data-testid="premium-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-dex-muted hover:bg-white/5">
                <span className="font-mono text-[11px]">{dexTexto(candidate.dexNumber)}</span>
                <span className="min-w-0 flex-1 truncate text-dex-ink">{candidate.name}</span>
                <button
                  type="button"
                  className={primaryButton}
                  disabled={busyId === candidate.id}
                  onClick={() => save(candidate, { grade }, `${candidate.name} ya es premium (${grade}).`)}
                >
                  Hacer premium
                </button>
                <button
                  type="button"
                  className={ghostButton}
                  disabled={busyId === candidate.id}
                  onClick={() => save(candidate, { grade: gradeDeterioro }, `${candidate.name} queda degradada (${gradeDeterioro}).`)}
                >
                  Degradar
                </button>
              </li>
            ))}
            {query.trim().length >= 2 && candidates.length === 0 && (
              <li className="px-2 py-2 text-xs text-dex-muted">Ninguna ficha sin premium coincide.</li>
            )}
          </ul>
          <details className="text-xs text-dex-muted">
            <summary className="cursor-pointer select-none">Opciones de deterioro (bajas)</summary>
            <label className={`${labelClass} mt-2 max-w-xs`}>
              Grado de deterioro
              <select
                aria-label="Grado de deterioro"
                value={gradeDeterioro}
                onChange={(event) => setGradeDeterioro(event.target.value as PremiumGrade)}
                className={inputClass}
              >
                {GRADOS_DEGRADADOS.map((item) => (
                  <option key={item} value={item}>
                    {item === GRADO_DE_BAJA ? '1 · ilegible (baja)' : item} · {nombreDeGrado(item)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
                «Degradar» deja la carta rota en una placa: el 7 apenas se nota, el 1 solo deja ver el número. Las bajas van al 1.
              </span>
            </label>
          </details>
        </section>
      )}

      {rows.length > 0 && (
        <>
          <nav aria-label="Filtrar cartas premium" className="flex flex-wrap gap-2">
            {FILTROS.map((f) => {
              const activo = filtro === f.id;
              const importante = f.id === 'por-subir' && conteo[f.id] > 0;
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={activo}
                  title={f.ayuda}
                  onClick={() => elegirFiltro(f.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    activo
                      ? 'border-dex-accent bg-dex-accent/15 text-dex-ink'
                      : importante
                        ? 'border-amber-300/50 text-amber-200 hover:bg-amber-300/10'
                        : 'border-dex-line text-dex-muted hover:text-dex-ink'
                  }`}
                >
                  {f.etiqueta} <span className="ml-1 font-mono text-[11px] opacity-80">{conteo[f.id]}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex flex-wrap items-end gap-3">
            <label className={`${labelClass} min-w-[14rem] flex-1`}>
              Buscar en la lista
              <input
                value={texto}
                onChange={(event) => {
                  setTexto(event.target.value);
                  setPagina(1);
                }}
                className={inputClass}
                placeholder="nombre, número o VTD-…"
                aria-label="Buscar en la lista de premium"
              />
            </label>
            <label className={labelClass}>
              Ordenar por
              <select
                aria-label="Ordenar"
                value={orden}
                onChange={(event) => {
                  setOrden(event.target.value as OrdenPremium);
                  setPagina(1);
                }}
                className={`${inputClass} w-64`}
              >
                {ORDENES.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.etiqueta}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={`hidden px-3 text-[10px] uppercase tracking-[0.14em] text-dex-muted md:grid md:items-center md:gap-x-3 ${COLUMNAS}`} aria-hidden>
            <span>N.º</span>
            <span>Nombre</span>
            <span>Grado</span>
            <span>Último cambio</span>
            <span className="text-right">Acciones</span>
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-dex-line px-6 py-8 text-center text-sm text-dex-muted" data-testid="premium-sin-resultados">
              Ninguna carta coincide con este filtro.{' '}
              {hayFiltros && (
                <button type="button" className="text-dex-accent hover:underline" onClick={limpiarFiltros}>
                  Quitar filtros
                </button>
              )}
            </p>
          ) : (
            <ul className="space-y-2">
              {pag.items.map((row) => (
                <Fila
                  key={row.id}
                  row={row}
                  abierta={abiertaId === row.id}
                  alternar={() => {
                    setAbiertaId((actual) => (actual === row.id ? null : row.id));
                    setConfirmingId(null);
                  }}
                  busy={busyId === row.id}
                  guardar={save}
                  confirmando={confirmingId === row.id}
                  setConfirmando={(valor) => setConfirmingId(valor ? row.id : null)}
                />
              ))}
            </ul>
          )}

          {visibles.length > 0 && (
            <footer className="flex flex-wrap items-center justify-between gap-3 text-xs text-dex-muted" data-testid="premium-paginacion">
              <span>
                Mostrando {pag.desde}–{pag.hasta} de {pag.total}
                {hayFiltros && ` (de ${rows.length} en total)`}
              </span>
              {pag.paginas > 1 && (
                <span className="flex items-center gap-2">
                  <button type="button" className={ghostButton} disabled={pag.pagina <= 1} onClick={() => setPagina(pag.pagina - 1)}>
                    ‹ Anterior
                  </button>
                  <span className="font-mono text-dex-ink">
                    {pag.pagina} / {pag.paginas}
                  </span>
                  <button type="button" className={ghostButton} disabled={pag.pagina >= pag.paginas} onClick={() => setPagina(pag.pagina + 1)}>
                    Siguiente ›
                  </button>
                </span>
              )}
            </footer>
          )}
        </>
      )}

      {loaded && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-dex-line px-6 py-8 text-center text-sm text-dex-muted">
          Aún no hay cartas premium. Busca una ficha arriba para hacer la primera.
        </p>
      )}
    </div>
  );
}

export default PremiumManager;
