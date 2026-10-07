'use client';
/**
 * Panel del mantenedor: indicadores (medidores semicirculares) y gráficos del catálogo.
 *
 * Antes eran cuatro números sueltos y una fila de chips de calidad: no se veía de un vistazo qué
 * proporción del catálogo estaba lista, cuántas fichas tenían correo (sin él no hay avisos de nivel
 * ni «Mi ficha») ni cómo se repartían las premium. Los datos salen de `GET /api/admin/stats`
 * (`server/src/estadisticas-admin.mjs`); aquí solo se dibujan, en SVG/HTML sin librería de gráficos.
 *
 * Colores de serie validados con el validador de paletas de la skill dataviz contra la superficie
 * `dex-panel` (#0d1017): banda de luminosidad, croma y separación para daltonismo. Los tonos claros
 * del sistema (`dex-accent` #5eead4, ámbar-400) quedan fuera de la banda para marcas rellenas, por eso
 * aquí van un paso más oscuros. El texto nunca va del color de la serie: usa las tintas `dex-*`.
 */
import type { AdminStats } from '@/lib/types';
import { GRADOS_DEGRADADOS, TODOS_LOS_GRADOS } from '@/lib/premium';

const COLOR = {
  principal: '#0d9488',
  borrador: '#d97706',
  oculto: '#6366f1',
  degradada: '#e11d48',
} as const;

export const FLAG_LABELS: Record<string, string> = {
  'sin-imagen-carta': 'Sin imagen de carta',
  'sin-ficha': 'Sin ficha personal',
  'sin-stats': 'Sin atributos',
  'sin-skills': 'Sin habilidades',
  'sin-color': 'Sin color de marca',
  'sin-logo': 'Sin logo',
  'sin-redes': 'Sin redes sociales',
  'sin-historia': 'Sin frase ni historia',
};

const pct = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);
const fmt = (n: number) => n.toLocaleString('es-CL');

function Tarjeta({ titulo, children, className = '' }: { titulo: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-dex-line bg-dex-panel/60 p-4 ${className}`}>
      <h2 className="text-xs font-bold uppercase tracking-[0.16em] text-dex-muted">{titulo}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Medidor semicircular: la proporción `parte/total`. El arco usa `pathLength` 100, así el trazo es el %. */
export function Medidor({ titulo, parte, total, detalle }: { titulo: string; parte: number; total: number; detalle: string }) {
  const valor = pct(parte, total);
  return (
    <figure className="flex flex-col items-center rounded-2xl border border-dex-line bg-dex-panel/60 p-4" data-testid="medidor">
      <svg viewBox="0 0 120 68" className="w-full max-w-[180px]" role="img" aria-label={`${titulo}: ${valor}% (${fmt(parte)} de ${fmt(total)})`}>
        <title>{`${titulo}: ${fmt(parte)} de ${fmt(total)}`}</title>
        <path d="M 10 60 A 50 50 0 0 1 110 60" fill="none" stroke="var(--color-dex-line)" strokeWidth="10" strokeLinecap="round" pathLength={100} />
        {valor > 0 && (
          <path
            d="M 10 60 A 50 50 0 0 1 110 60"
            fill="none"
            stroke={COLOR.principal}
            strokeWidth="10"
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${valor} 100`}
          />
        )}
        <text x="60" y="56" textAnchor="middle" className="fill-dex-ink font-mono text-[20px] font-bold">
          {valor}%
        </text>
      </svg>
      <figcaption className="mt-1 text-center">
        <span className="block text-xs font-semibold uppercase tracking-[0.12em] text-dex-ink">{titulo}</span>
        <span className="block text-[11px] text-dex-muted">{detalle}</span>
      </figcaption>
    </figure>
  );
}

/** Barras horizontales de una serie con su valor escrito al lado (sirven también de tabla). */
function Barras({ filas, color = COLOR.principal }: { filas: Array<{ label: string; value: number }>; color?: string }) {
  const max = Math.max(1, ...filas.map((fila) => fila.value));
  if (filas.length === 0) return <p className="text-xs text-dex-muted">Sin datos.</p>;
  return (
    <ul className="space-y-1.5">
      {filas.map((fila) => (
        <li key={fila.label} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2 text-xs" title={`${fila.label}: ${fmt(fila.value)}`}>
          <span className="truncate text-dex-ink">{fila.label}</span>
          <span className="h-3 rounded-sm bg-dex-line/40">
            <span className="block h-full rounded-r" style={{ width: `${(fila.value / max) * 100}%`, background: color }} />
          </span>
          <span className="text-right font-mono text-dex-muted">{fmt(fila.value)}</span>
        </li>
      ))}
    </ul>
  );
}

function Leyenda({ items }: { items: Array<{ label: string; color: string; value: number }> }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5 text-dex-muted">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden />
          {item.label} <span className="font-mono text-dex-ink">{fmt(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Estado de las fichas: una barra apilada (con 2 px de separación entre tramos) + leyenda con los valores. */
function BarraDeEstados({ estados }: { estados: AdminStats['estados'] }) {
  const tramos = [
    { label: 'Publicadas', color: COLOR.principal, value: estados.published },
    { label: 'Borradores', color: COLOR.borrador, value: estados.draft },
    { label: 'Ocultas', color: COLOR.oculto, value: estados.hidden },
  ];
  const total = tramos.reduce((suma, tramo) => suma + tramo.value, 0);
  return (
    <>
      <div className="flex h-5 gap-[2px] overflow-hidden rounded" role="img" aria-label={tramos.map((t) => `${t.label} ${t.value}`).join(', ')}>
        {tramos
          .filter((tramo) => tramo.value > 0)
          .map((tramo) => (
            <span
              key={tramo.label}
              title={`${tramo.label}: ${fmt(tramo.value)} (${pct(tramo.value, total)}%)`}
              style={{ flexGrow: tramo.value, background: tramo.color, minWidth: 4 }}
            />
          ))}
      </div>
      <Leyenda items={tramos} />
    </>
  );
}

/** Columnas por grado, de la baja (1) a la Black Label; las degradadas en otro color y con leyenda. */
function ColumnasDeGrados({ grados }: { grados: AdminStats['grados'] }) {
  const cuenta = new Map(grados.map((fila) => [fila.grade, fila.count]));
  const max = Math.max(1, ...grados.map((fila) => fila.count));
  const degradadas = grados.filter((fila) => (GRADOS_DEGRADADOS as readonly string[]).includes(fila.grade)).reduce((s, f) => s + f.count, 0);
  const premium = grados.reduce((s, f) => s + f.count, 0) - degradadas;
  return (
    <>
      <div className="flex h-32 items-end gap-1.5" role="img" aria-label="Fichas por grado">
        {TODOS_LOS_GRADOS.map((grado) => {
          const n = cuenta.get(grado) ?? 0;
          const esDegradada = (GRADOS_DEGRADADOS as readonly string[]).includes(grado);
          return (
            <div key={grado} className="flex h-full flex-1 flex-col items-center justify-end" title={`Grado ${grado}: ${n}`}>
              {n > 0 && <span className="mb-0.5 font-mono text-[10px] text-dex-muted">{n}</span>}
              <span
                className="w-full rounded-t"
                style={{ height: n > 0 ? `${Math.max(4, (n / max) * 100)}%` : 2, background: n > 0 ? (esDegradada ? COLOR.degradada : COLOR.principal) : 'var(--color-dex-line)' }}
              />
              <span className="mt-1 font-mono text-[10px] text-dex-muted">{grado}</span>
            </div>
          );
        })}
      </div>
      <Leyenda
        items={[
          { label: 'Premium', color: COLOR.principal, value: premium },
          { label: 'Deterioradas', color: COLOR.degradada, value: degradadas },
        ]}
      />
    </>
  );
}

function Indicador({ label, value, nota }: { label: string; value: number | string; nota?: string }) {
  return (
    <div className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
      <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl font-bold text-dex-ink">{value}</p>
      {nota && <p className="mt-0.5 text-[11px] text-dex-muted">{nota}</p>}
    </div>
  );
}

/** Suma por bandera de calidad (una ficha puede tener varias). */
export function resumenDeCalidad(quality: AdminStats['quality']) {
  const suma: Record<string, number> = {};
  for (const bucket of quality) for (const flag of bucket.flags) suma[flag] = (suma[flag] ?? 0) + bucket.count;
  return Object.entries(suma)
    .map(([flag, value]) => ({ label: FLAG_LABELS[flag] ?? flag, value }))
    .sort((a, b) => b.value - a.value);
}

export function PanelEstadisticas({ stats, onVerSolicitudes }: { stats: AdminStats; onVerSolicitudes?: () => void }) {
  const { totals } = stats;
  const pendientes = stats.solicitudes
    ? stats.solicitudes.pendientes.inscripcion + stats.solicitudes.pendientes.modificacion + stats.solicitudes.pendientes.baja
    : null;
  const premium = stats.grados.filter((f) => !(GRADOS_DEGRADADOS as readonly string[]).includes(f.grade)).reduce((s, f) => s + f.count, 0);
  const calidad = resumenDeCalidad(stats.quality);

  return (
    <div className="mb-6 space-y-4" data-testid="panel-estadisticas">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Medidor titulo="Publicadas" parte={stats.estados.published} total={totals.total} detalle={`${fmt(stats.estados.published)} de ${fmt(totals.total)} fichas`} />
        <Medidor titulo="Ficha completa" parte={totals.withDetail} total={totals.total} detalle={`${fmt(totals.withDetail)} con ficha personal`} />
        <Medidor titulo="Datos sin fallos" parte={totals.sinProblemas} total={totals.total} detalle={`${fmt(totals.total - totals.sinProblemas)} con algo pendiente`} />
        {stats.correo ? (
          <Medidor titulo="Con correo" parte={stats.correo.con} total={totals.total} detalle={`${fmt(stats.correo.sin)} sin avisos de nivel`} />
        ) : (
          <Indicador label="Con correo" value="—" nota="Cola de solicitudes no disponible" />
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Indicador label="VTubers" value={fmt(totals.total)} />
        <Indicador label="Premium" value={fmt(premium)} nota="grados 6 a Black Label" />
        <Indicador label="Colores de marca" value={fmt(stats.themes)} />
        <div className="rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
          <p className="text-xs uppercase tracking-[0.14em] text-dex-muted">Solicitudes pendientes</p>
          <p className="mt-1 font-mono text-2xl font-bold text-dex-ink">{pendientes === null ? '—' : fmt(pendientes)}</p>
          {stats.solicitudes && (
            <p className="mt-0.5 text-[11px] text-dex-muted">
              {stats.solicitudes.pendientes.inscripcion} inscr. · {stats.solicitudes.pendientes.modificacion} modif. · {stats.solicitudes.pendientes.baja} bajas
              {onVerSolicitudes && pendientes ? (
                <>
                  {' '}
                  ·{' '}
                  <button type="button" className="underline hover:text-dex-ink" onClick={onVerSolicitudes}>
                    revisar
                  </button>
                </>
              ) : null}
            </p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Estado de las fichas">
          <BarraDeEstados estados={stats.estados} />
        </Tarjeta>
        <Tarjeta titulo="Premium y deterioradas por grado">
          <ColumnasDeGrados grados={stats.grados} />
        </Tarjeta>
        <Tarjeta titulo="Top 10 países">
          <Barras filas={stats.paises.map((p) => ({ label: `${p.flag ? `${p.flag} ` : ''}${p.name}`, value: p.count }))} />
        </Tarjeta>
        <Tarjeta titulo="Top 10 facciones">
          <Barras filas={stats.facciones.map((f) => ({ label: f.name, value: f.count }))} />
        </Tarjeta>
        <Tarjeta titulo="Calidad de datos (fichas afectadas)" className="lg:col-span-2">
          {calidad.length > 0 ? <Barras filas={calidad} color={COLOR.borrador} /> : <p className="text-xs text-dex-muted">Ninguna ficha con datos pendientes.</p>}
        </Tarjeta>
      </div>
    </div>
  );
}
