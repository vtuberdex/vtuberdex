'use client';

/**
 * Gráficos y maquetas de la página `/niveles`. Ninguno es una imagen suelta: los dibujos salen de la MISMA regla
 * que usa el servidor (`experienciaConLikes`, `umbralDeNivel`) y las maquetas son los componentes REALES de la
 * ficha (`StatBars`, `SkillList`, `MiFichaVista`) con datos de ejemplo. Así no se desfasan si cambia la curva o el
 * diseño, y se traducen solos.
 */
import type { ReactNode } from 'react';

import { MiFichaVista } from '@/components/mi-ficha/mi-ficha';
import { SkillList } from '@/components/skill-list';
import { StatBars } from '@/components/stat-bars';
import type { RespuestaMiFicha } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { SkillRow, StatRow } from '@/lib/types';
import { PUNTOS_POR_NIVEL, RANGO_MAXIMO, experienciaConLikes, umbralDeNivel } from '@/server/src/experiencia.mjs';

/** Marco común: título, explicación y el dibujo. */
export function Figura({ titulo, texto, ejemplo = false, children }: { titulo: string; texto: string; ejemplo?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  return (
    <figure className="space-y-3">
      <figcaption>
        <p className="flex items-center gap-2 text-sm font-bold text-dex-ink">
          {titulo}
          {ejemplo && <span className="rounded-md border border-dex-line px-1.5 py-0.5 text-[10px] font-normal uppercase tracking-[0.1em] text-dex-muted">{t('niveles.ejemplo')}</span>}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-dex-muted">{texto}</p>
      </figcaption>
      {children}
    </figure>
  );
}

/** Una maqueta no se toca: se mira. `inert` la saca del foco y de los lectores (la explica el pie de la figura). */
function Maqueta({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none select-none overflow-hidden rounded-xl border border-dex-line bg-dex-void/60 p-3" {...{ inert: true }} aria-hidden>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ pasos */

export function PasosDelCamino() {
  const { t } = useI18n();
  const pasos = [
    { icono: '❤️', t: t('niveles.flujo.1.t'), d: t('niveles.flujo.1.d') },
    { icono: '📈', t: t('niveles.flujo.2.t'), d: t('niveles.flujo.2.d') },
    { icono: '✉️', t: t('niveles.flujo.3.t'), d: t('niveles.flujo.3.d') },
    { icono: '🎯', t: t('niveles.flujo.4.t'), d: t('niveles.flujo.4.d') },
  ];
  return (
    <section aria-labelledby="niveles-camino">
      <h2 id="niveles-camino" className="text-lg font-bold text-dex-ink">{t('niveles.flujo.titulo')}</h2>
      <ol className="mt-3 grid gap-3 sm:grid-cols-4" data-testid="niveles-camino">
        {pasos.map((p, i) => (
          <li key={p.t} className="relative rounded-2xl border border-dex-line bg-dex-panel/60 p-4 text-center">
            <span className="absolute left-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-dex-accent text-[11px] font-extrabold text-black">{i + 1}</span>
            <span className="block text-3xl" aria-hidden>{p.icono}</span>
            <span className="mt-2 block text-sm font-bold text-dex-ink">{p.t}</span>
            <span className="mt-1 block text-xs leading-snug text-dex-muted">{p.d}</span>
            {i < pasos.length - 1 && <span className="absolute -right-2.5 top-1/2 z-10 hidden -translate-y-1/2 text-dex-accent sm:block" aria-hidden>▶</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------- barra que se vacía / total */

const W = 520;
const IZQ = 44;
const DER = 12;
/** Cuántos likes dibuja el ejemplo: lo justo para ver tres subidas de nivel. */
const LIKES_DEL_EJEMPLO = 50;

export function GraficoBarraYTotal() {
  const { t } = useI18n();
  const ancho = W - IZQ - DER;
  const x = (likes: number) => IZQ + (likes / LIKES_DEL_EJEMPLO) * ancho;

  const puntos = Array.from({ length: LIKES_DEL_EJEMPLO + 1 }, (_, likes) => experienciaConLikes({}, likes));
  const totalMax = puntos[puntos.length - 1].total;

  // Barra: al cambiar de nivel sube hasta el tope y cae a cero en el mismo like (diente de sierra).
  const barra: string[] = [];
  const subidas: Array<{ likes: number; nivel: number }> = [];
  puntos.forEach((p, i) => {
    const alto = p.current / p.max;
    const yb = (f: number) => 78 - f * 62;
    if (i > 0 && p.level !== puntos[i - 1].level) {
      barra.push(`${x(p.likes)},16`, `${x(p.likes)},${yb(alto)}`);
      subidas.push({ likes: p.likes, nivel: p.level });
    } else {
      barra.push(`${x(p.likes)},${yb(alto)}`);
    }
  });
  const total = puntos.map((p) => `${x(p.likes)},${212 - (p.total / totalMax) * 62}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} 250`} className="h-auto w-full" role="img" aria-label={t('niveles.g1.titulo')} data-testid="grafico-barra-total">
      {/* ejes */}
      <g className="text-dex-line" stroke="currentColor" strokeWidth="1">
        <line x1={IZQ} y1="16" x2={IZQ} y2="78" />
        <line x1={IZQ} y1="78" x2={W - DER} y2="78" />
        <line x1={IZQ} y1="150" x2={IZQ} y2="212" />
        <line x1={IZQ} y1="212" x2={W - DER} y2="212" />
      </g>
      {/* una guía vertical por cada subida de nivel */}
      <g className="text-dex-line" stroke="currentColor" strokeDasharray="3 4">
        {subidas.map((s) => (
          <line key={s.nivel} x1={x(s.likes)} y1="16" x2={x(s.likes)} y2="212" />
        ))}
      </g>
      <polyline points={barra.join(' ')} fill="none" className="text-dex-accent" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      <polyline points={total} fill="none" className="text-amber-300" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      {subidas.map((s) => (
        <g key={s.nivel}>
          <circle cx={x(s.likes)} cy="16" r="3.5" className="fill-dex-accent" />
          <text x={x(s.likes)} y="10" textAnchor="middle" className="fill-dex-ink" fontSize="11" fontWeight="700">
            {t('niveles.g1.nivel', { n: s.nivel })}
          </text>
        </g>
      ))}
      <text x="6" y="48" className="fill-dex-accent" fontSize="11" fontWeight="700">{t('niveles.g1.barra')}</text>
      <text x="6" y="60" className="fill-dex-muted" fontSize="10">0 → 100 %</text>
      <text x="6" y="176" className="fill-amber-300" fontSize="11" fontWeight="700">{t('niveles.g1.total')}</text>
      <text x="6" y="188" className="fill-dex-muted" fontSize="10">{totalMax.toLocaleString()}</text>
      <text x={IZQ + ancho / 2} y="240" textAnchor="middle" className="fill-dex-muted" fontSize="11">{t('niveles.g1.likes')}</text>
      {[0, 10, 20, 30, 40, 50].map((n) => (
        <text key={n} x={x(n)} y="226" textAnchor="middle" className="fill-dex-muted" fontSize="10">{n}</text>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------- curva por nivel */

const NIVELES_DE_LA_CURVA = 10;

export function GraficoCurva() {
  const { t } = useI18n();
  const niveles = Array.from({ length: NIVELES_DE_LA_CURVA }, (_, i) => ({ nivel: i + 1, exp: umbralDeNivel(i + 1) }));
  const maximo = niveles[niveles.length - 1].exp;
  const base = 168;
  const alto = 130;
  const paso = (W - IZQ - DER) / NIVELES_DE_LA_CURVA;
  return (
    <svg viewBox={`0 0 ${W} 200`} className="h-auto w-full" role="img" aria-label={t('niveles.g2.titulo')} data-testid="grafico-curva">
      <text x="6" y="14" className="fill-dex-muted" fontSize="10">{t('niveles.g2.eje')}</text>
      <line x1={IZQ} y1={base} x2={W - DER} y2={base} className="text-dex-line" stroke="currentColor" />
      {niveles.map((n, i) => {
        const h = (n.exp / maximo) * alto;
        const bx = IZQ + i * paso + paso * 0.15;
        return (
          <g key={n.nivel}>
            <rect x={bx} y={base - h} width={paso * 0.7} height={h} rx="3" className="fill-dex-accent" opacity={0.35 + 0.65 * (n.exp / maximo)} />
            <text x={bx + paso * 0.35} y={base - h - 5} textAnchor="middle" className="fill-dex-ink" fontSize="10" fontWeight="700">{n.exp}</text>
            <text x={bx + paso * 0.35} y={base + 14} textAnchor="middle" className="fill-dex-muted" fontSize="10">{n.nivel}</text>
          </g>
        );
      })}
      <text x={IZQ + (W - IZQ - DER) / 2} y="194" textAnchor="middle" className="fill-dex-muted" fontSize="10">
        {t('niveles.tabla.nivel')} →
      </text>
    </svg>
  );
}

/* -------------------------------------------------------------- maquetas */

const PALETA = { accent: '#5eead4', secondary: '#818cf8' };

function habilidades(t: ReturnType<typeof useI18n>['t']): SkillRow[] {
  const base = { section: null, type: null, effect: null, effectHtml: null, factions: [] };
  return [
    { ...base, category: 'active', name: t('niveles.ej.hab1'), position: 0, rank: 3 },
    { ...base, category: 'passive', name: t('niveles.ej.hab2'), position: 1, rank: 1 },
    { ...base, category: 'ultimate', name: t('niveles.ej.hab3'), position: 2, rank: 0 },
  ];
}

const STATS: StatRow[] = [
  { label: 'HP', slug: 'hp', value: 240, valueText: null, max: 400, position: 0 },
  { label: 'MP', slug: 'mp', value: 180, valueText: null, max: 400, position: 1 },
];

/** La ficha pública: nivel, barra, EXP total y rangos en las habilidades. */
export function MaquetaFichaPublica() {
  const { t } = useI18n();
  const exp = experienciaConLikes({}, 62);
  return (
    <Maqueta>
      <div className="space-y-4">
        <StatBars stats={STATS} palette={PALETA} level={exp.level} experience={{ current: exp.current, max: exp.max, total: exp.total }} />
        <SkillList skills={habilidades(t)} palette={PALETA} />
      </div>
    </Maqueta>
  );
}

/** «Mi ficha» con puntos para repartir. */
export function MaquetaMiFicha() {
  const { t } = useI18n();
  const exp = experienciaConLikes({}, 62);
  const lista = habilidades(t);
  const datos: RespuestaMiFicha = {
    ok: true,
    fichas: [{ slug: 'ejemplo', name: t('niveles.ej.nombre') }],
    ficha: {
      slug: 'ejemplo',
      name: t('niveles.ej.nombre'),
      level: exp.level,
      levelsGained: exp.nivelesGanados,
      likes: 62,
      experience: { current: exp.current, max: exp.max, total: exp.total },
      puntos: {
        ganados: exp.nivelesGanados * PUNTOS_POR_NIVEL,
        repartidos: 4,
        disponibles: exp.nivelesGanados * PUNTOS_POR_NIVEL - 4,
        rangoMaximo: RANGO_MAXIMO,
        puntosPorNivel: PUNTOS_POR_NIVEL,
        habilidades: lista.map((s) => ({ clave: `${s.category}:${s.name}`, name: s.name ?? '', category: s.category, type: null, effect: null, rango: s.rank ?? 0 })),
      },
    },
  };
  return (
    <Maqueta>
      <MiFichaVista datos={datos} />
    </Maqueta>
  );
}

/** Los puntitos de rango, del 0 al máximo. */
export function EscalaDeRangos() {
  const { t } = useI18n();
  return (
    <ul className="grid gap-2 sm:grid-cols-3" data-testid="escala-rangos">
      {Array.from({ length: RANGO_MAXIMO + 1 }, (_, n) => (
        <li key={n} className="flex items-center justify-between gap-3 rounded-xl border border-dex-line bg-black/25 px-3 py-2">
          <span className="text-xs text-dex-muted">{t('mificha.rango', { n, max: RANGO_MAXIMO })}</span>
          <span className="flex gap-1" aria-hidden>
            {Array.from({ length: RANGO_MAXIMO }, (_, i) => (
              <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < n ? 'bg-dex-accent' : 'border border-dex-line'}`} />
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

