// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"use client";
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
import { useCallback, useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { dexDeCodigo } from "@/lib/donar";
import {
  GRADOS,
  GRADOS_DEGRADADOS,
  GRADO_DE_BAJA,
  GRADO_INICIAL,
  nombreDeGrado,
} from "@/lib/premium";
import type { PremiumGrade, VtuberCard } from "@/lib/types";
import {
  ghostButton,
  inputClass,
  labelClass,
  primaryButton,
} from "@/components/admin/ui";
import {
  COLUMNAS,
  dexTexto,
  Fila,
  type Guardar,
} from "@/components/admin/premium-fila";
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
} from "@/components/admin/premium-lista";

type Notify = (kind: "ok" | "error", text: string) => void;

/** Tamaño de página que se pide a la API; se pide página tras página hasta traerlas TODAS (antes se cortaba en 100). */
const PEDIDO_POR_PAGINA = 100;
const MAX_PAGINAS_PEDIDAS = 30;

async function cargarTodas(
  token: string,
  signal: AbortSignal,
): Promise<VtuberCard[]> {
  const todas: VtuberCard[] = [];
  for (let page = 1; page <= MAX_PAGINAS_PEDIDAS; page += 1) {
    const response = await api.adminList(
      token,
      { premium: true, perPage: PEDIDO_POR_PAGINA, page },
      signal,
    );
    todas.push(...response.items);
    if (page >= (response.pageCount ?? 1)) {
      break;
    }
  }
  return todas;
}

/** Color del filtro: el activo, «Por subir» con trabajo pendiente (resaltado) o uno cualquiera. */
function claseDeFiltro(activo: boolean, importante: boolean): string {
  if (activo) {
    return "border-dex-accent bg-dex-accent/15 text-dex-ink";
  }
  return importante
    ? "border-amber-300/50 text-amber-200 hover:bg-amber-300/10"
    : "border-dex-line text-dex-muted hover:text-dex-ink";
}

type Conteo = ReturnType<typeof contarPorFiltro>;

function CabeceraDePremium({
  total,
  porSubir,
  altaVisible,
  onAlternarAlta,
}: Readonly<{
  total: number;
  /** `null` mientras no ha cargado. */
  porSubir: number | null;
  altaVisible: boolean;
  onAlternarAlta: () => void;
}>) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-dex-muted">
          Cartas premium <span className="font-mono text-dex-ink">{total}</span>
        </h2>
        {porSubir !== null && porSubir > 0 && (
          <p className="mt-0.5 text-xs text-amber-200">
            {porSubir}{" "}
            {porSubir === 1 ? "carta pendiente" : "cartas pendientes"} de
            revisar este mes.
          </p>
        )}
      </div>
      <button
        type="button"
        className={altaVisible ? ghostButton : primaryButton}
        aria-expanded={altaVisible}
        onClick={onAlternarAlta}
      >
        {altaVisible && total > 0 ? "Cerrar" : "+ Nueva premium"}
      </button>
    </header>
  );
}

function AltaDePremium({
  query,
  onQuery,
  grade,
  onGrade,
  gradeDeterioro,
  onGradeDeterioro,
  candidates,
  busyId,
  save,
}: Readonly<{
  query: string;
  onQuery: (query: string) => void;
  grade: PremiumGrade;
  onGrade: (grade: PremiumGrade) => void;
  gradeDeterioro: PremiumGrade;
  onGradeDeterioro: (grade: PremiumGrade) => void;
  candidates: VtuberCard[];
  busyId: number | null;
  save: Guardar;
}>) {
  return (
    <section
      className="space-y-3 rounded-2xl border border-dex-accent/40 bg-dex-panel/60 p-4"
      data-testid="premium-alta"
    >
      <p className="text-xs text-dex-muted">
        Escribe el nombre, el número o el código{" "}
        <span className="font-mono">VTD-016</span> que el donante puso en la
        nota de PayPal. Lo normal es entrar con el {GRADO_INICIAL}; sube medio
        punto por mes.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
        <label className={labelClass}>
          Buscar ficha{" "}
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            className={inputClass}
            placeholder="nombre, número o código VTD-…"
            aria-label="Buscar ficha para hacerla premium"
          />
        </label>
        <label className={labelClass}>
          Grado inicial{" "}
          <select
            aria-label="Grado inicial"
            value={grade}
            onChange={(event) => onGrade(event.target.value as PremiumGrade)}
            className={inputClass}
          >
            {GRADOS.map((item) => (
              <option key={item} value={item}>
                {item === "BL" ? "BL · Black Label" : item}
              </option>
            ))}
          </select>
        </label>
      </div>
      <ul
        className="dex-scroll max-h-64 space-y-1 overflow-y-auto"
        data-testid="premium-candidates"
      >
        {candidates.map((candidate) => (
          <li
            key={candidate.id}
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-dex-muted hover:bg-white/5"
          >
            <span className="font-mono text-[11px]">
              {dexTexto(candidate.dexNumber)}
            </span>
            <span className="min-w-0 flex-1 truncate text-dex-ink">
              {candidate.name}
            </span>
            <button
              type="button"
              className={primaryButton}
              disabled={busyId === candidate.id}
              onClick={() =>
                save(
                  candidate,
                  { grade },
                  `${candidate.name} ya es premium (${grade}).`,
                )
              }
            >
              Hacer premium
            </button>
            <button
              type="button"
              className={ghostButton}
              disabled={busyId === candidate.id}
              onClick={() =>
                save(
                  candidate,
                  { grade: gradeDeterioro },
                  `${candidate.name} queda degradada (${gradeDeterioro}).`,
                )
              }
            >
              Degradar
            </button>
          </li>
        ))}
        {query.trim().length >= 2 && candidates.length === 0 && (
          <li className="px-2 py-2 text-xs text-dex-muted">
            Ninguna ficha sin premium coincide.
          </li>
        )}
      </ul>
      <details className="text-xs text-dex-muted">
        <summary className="cursor-pointer select-none">
          Opciones de deterioro (bajas)
        </summary>
        <label className={`${labelClass} mt-2 max-w-xs`}>
          Grado de deterioro{" "}
          <select
            aria-label="Grado de deterioro"
            value={gradeDeterioro}
            onChange={(event) =>
              onGradeDeterioro(event.target.value as PremiumGrade)
            }
            className={inputClass}
          >
            {GRADOS_DEGRADADOS.map((item) => (
              <option key={item} value={item}>
                {item === GRADO_DE_BAJA ? "1 · ilegible (baja)" : item} ·{" "}
                {nombreDeGrado(item)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] normal-case tracking-normal text-dex-muted">
            «Degradar» deja la carta rota en una placa: el 7 apenas se nota, el
            1 solo deja ver el número. Las bajas van al 1.
          </span>
        </label>
      </details>
    </section>
  );
}

function FiltrosDePremium({
  filtro,
  conteo,
  onFiltro,
}: Readonly<{
  filtro: FiltroPremium;
  conteo: Conteo;
  onFiltro: (filtro: FiltroPremium) => void;
}>) {
  return (
    <nav aria-label="Filtrar cartas premium" className="flex flex-wrap gap-2">
      {FILTROS.map((f) => {
        const activo = filtro === f.id;
        const importante = f.id === "por-subir" && conteo[f.id] > 0;
        return (
          <button
            key={f.id}
            type="button"
            aria-pressed={activo}
            title={f.ayuda}
            onClick={() => onFiltro(f.id)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${claseDeFiltro(activo, importante)}`}
          >
            {f.etiqueta}{" "}
            <span className="ml-1 font-mono text-[11px] opacity-80">
              {conteo[f.id]}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function Paginacion({
  pag,
  hayFiltros,
  total,
  onPagina,
}: Readonly<{
  pag: ReturnType<typeof paginar<VtuberCard>>;
  hayFiltros: boolean;
  total: number;
  onPagina: (pagina: number) => void;
}>) {
  return (
    <footer
      className="flex flex-wrap items-center justify-between gap-3 text-xs text-dex-muted"
      data-testid="premium-paginacion"
    >
      <span>
        Mostrando {pag.desde}–{pag.hasta} de {pag.total}
        {hayFiltros && ` (de ${total} en total)`}
      </span>
      {pag.paginas > 1 && (
        <span className="flex items-center gap-2">
          <button
            type="button"
            className={ghostButton}
            disabled={pag.pagina <= 1}
            onClick={() => onPagina(pag.pagina - 1)}
          >
            ‹ Anterior
          </button>
          <span className="font-mono text-dex-ink">
            {pag.pagina} / {pag.paginas}
          </span>
          <button
            type="button"
            className={ghostButton}
            disabled={pag.pagina >= pag.paginas}
            onClick={() => onPagina(pag.pagina + 1)}
          >
            Siguiente ›
          </button>
        </span>
      )}
    </footer>
  );
}

export function PremiumManager({
  token,
  notify,
  onChanged,
}: Readonly<{
  token: string;
  notify?: Notify;
  /** Cambiar el premium cambia lo que se ve de la ficha: el padre refresca lista y métricas. */
  onChanged?: () => void;
}>) {
  const [rows, setRows] = useState<VtuberCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [version, setVersion] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [abiertaId, setAbiertaId] = useState<number | null>(null);

  const [filtro, setFiltro] = useState<FiltroPremium>("todas");
  const [orden, setOrden] = useState<OrdenPremium>("grado-desc");
  const [texto, setTexto] = useState("");
  const [pagina, setPagina] = useState(1);

  const [altaAbierta, setAltaAbierta] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<VtuberCard[]>([]);
  const [grade, setGrade] = useState<PremiumGrade>(GRADO_INICIAL);
  /** Grado con el que se DEGRADA una ficha que no era premium (por defecto el de las bajas). */
  const [gradeDeterioro, setGradeDeterioro] =
    useState<PremiumGrade>(GRADO_DE_BAJA);

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
      return undefined;
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
        .adminList(
          token,
          { q: String(dexPorCodigo), perPage: 20 },
          controller.signal,
        )
        .then((response) =>
          setCandidates(
            response.items.filter(
              (item) => item.dexNumber === dexPorCodigo && !item.premium,
            ),
          ),
        )
        .catch(() => setCandidates([]));
      return () => controller.abort();
    }
    api
      .adminList(token, { q: term, perPage: 8 }, controller.signal)
      .then((response) =>
        setCandidates(response.items.filter((item) => !item.premium)),
      )
      .catch(() => undefined);
    return () => controller.abort();
  }, [token, query, version, altaVisible]);

  const save = useCallback<Guardar>(
    async (row, premium, okText) => {
      setBusyId(row.id);
      try {
        await api.updateVtuber(token, row.id, { premium });
        notify?.("ok", okText);
        setVersion((current) => current + 1);
        onChanged?.();
      } catch (cause) {
        notify?.(
          "error",
          cause instanceof Error
            ? cause.message
            : "No se pudo guardar el premium.",
        );
      } finally {
        setBusyId(null);
        setConfirmingId(null);
      }
    },
    [token, notify, onChanged],
  );

  const conteo = useMemo(() => contarPorFiltro(rows), [rows]);
  const visibles = useMemo(
    () =>
      ordenar(
        rows.filter(
          (row) =>
            perteneceAlFiltro(row, filtro) && coincideConTexto(row, texto),
        ),
        orden,
      ),
    [rows, filtro, texto, orden],
  );
  const pag = paginar(visibles, pagina);
  const hayFiltros = filtro !== "todas" || texto.trim() !== "";

  const elegirFiltro = useCallback((valor: FiltroPremium) => {
    setFiltro(valor);
    setPagina(1);
  }, []);
  const limpiarFiltros = () => {
    setFiltro("todas");
    setTexto("");
    setPagina(1);
  };
  const alternarAlta = useCallback(() => setAltaAbierta((v) => !v), []);
  // Abrir otra fila cierra la confirmación de «Quitar» que hubiera en la anterior.
  const alternarFila = useCallback((id: number) => {
    setAbiertaId((actual) => (actual === id ? null : id));
    setConfirmingId(null);
  }, []);
  const confirmarQuitar = useCallback(
    (id: number, valor: boolean) => setConfirmingId(valor ? id : null),
    [],
  );

  return (
    <div className="space-y-4" data-testid="premium-manager">
      <CabeceraDePremium
        total={rows.length}
        porSubir={loaded ? conteo["por-subir"] : null}
        altaVisible={altaVisible}
        onAlternarAlta={alternarAlta}
      />

      {altaVisible && (
        <AltaDePremium
          query={query}
          onQuery={setQuery}
          grade={grade}
          onGrade={setGrade}
          gradeDeterioro={gradeDeterioro}
          onGradeDeterioro={setGradeDeterioro}
          candidates={candidates}
          busyId={busyId}
          save={save}
        />
      )}

      {rows.length > 0 && (
        <>
          <FiltrosDePremium
            filtro={filtro}
            conteo={conteo}
            onFiltro={elegirFiltro}
          />

          <div className="flex flex-wrap items-end gap-3">
            <label className={`${labelClass} min-w-[14rem] flex-1`}>
              Buscar en la lista{" "}
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
              Ordenar por{" "}
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

          <div
            className={`hidden px-3 text-[10px] uppercase tracking-[0.14em] text-dex-muted md:grid md:items-center md:gap-x-3 ${COLUMNAS}`}
            aria-hidden
          >
            <span>N.º</span>
            <span>Nombre</span>
            <span>Grado</span>
            <span>Último cambio</span>
            <span className="text-right">Acciones</span>
          </div>

          {visibles.length === 0 ? (
            <p
              className="rounded-2xl border border-dashed border-dex-line px-6 py-8 text-center text-sm text-dex-muted"
              data-testid="premium-sin-resultados"
            >
              Ninguna carta coincide con este filtro.{" "}
              {hayFiltros && (
                <button
                  type="button"
                  className="text-dex-accent hover:underline"
                  onClick={limpiarFiltros}
                >
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
                  onAlternar={alternarFila}
                  busy={busyId === row.id}
                  guardar={save}
                  confirmando={confirmingId === row.id}
                  onConfirmar={confirmarQuitar}
                />
              ))}
            </ul>
          )}

          {visibles.length > 0 && (
            <Paginacion
              pag={pag}
              hayFiltros={hayFiltros}
              total={rows.length}
              onPagina={setPagina}
            />
          )}
        </>
      )}

      {loaded && rows.length === 0 && (
        <p className="rounded-2xl border border-dashed border-dex-line px-6 py-8 text-center text-sm text-dex-muted">
          Aún no hay cartas premium. Busca una ficha arriba para hacer la
          primera.
        </p>
      )}
    </div>
  );
}

export default PremiumManager;
