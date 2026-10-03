/**
 * Gráfico de telaraña (radar) de los atributos: la matemática, sin React ni DOM.
 *
 * QUÉ ENTRA Y POR QUÉ
 * -------------------
 * Los atributos de combate tienen escalas muy distintas (la Suerte ronda 9 y el Ataque Mágico
 * 230), así que dibujarlos con un mismo eje reduciría la Suerte a un punto. Cada eje se
 * normaliza contra su propia REFERENCIA: un valor alto típico de ese atributo en el catálogo
 * (medido sobre las 211 fichas con atributos: Suerte 6-16, Crítico 31-116, Evasión 43-100,
 * Precisión 65-200, el resto hasta ~300-400 salvo valores atípicos). Un vértice en el borde
 * significa «de lo mejor del catálogo en ese atributo».
 *
 * HP, MP, Nivel y EXP NO van en la telaraña: son contadores con su propia escala (miles) que
 * aplastarían el resto; se siguen mostrando como barras.
 */
import type { StatRow } from '@/lib/types';

export interface EjeDeRadar {
  slug: string;
  /** Etiqueta corta, cabe junto al vértice. */
  corto: string;
  /** Valor que ocupa el borde del gráfico. */
  ref: number;
}

/** El orden es el del gráfico, en el sentido de las agujas del reloj desde arriba. */
export const EJES_DE_RADAR: readonly EjeDeRadar[] = [
  { slug: 'attack', corto: 'ATQ', ref: 400 },
  { slug: 'magicAttack', corto: 'ATQ MÁG', ref: 400 },
  { slug: 'critic', corto: 'CRÍT', ref: 120 },
  { slug: 'accuracy', corto: 'PREC', ref: 200 },
  { slug: 'speed', corto: 'VEL', ref: 300 },
  { slug: 'luck', corto: 'SUERTE', ref: 16 },
  { slug: 'evasion', corto: 'EVA', ref: 100 },
  { slug: 'magicDefense', corto: 'DEF MÁG', ref: 300 },
  { slug: 'defense', corto: 'DEF', ref: 300 },
];

/** Mínimo de ejes para que sea un polígono y no una línea. */
export const MIN_EJES = 3;

/** Un vértice nunca baja de aquí: un atributo bajo debe verse, no desaparecer en el centro. */
const PISO = 0.06;

export interface VerticeDeRadar {
  slug: string;
  corto: string;
  /** Etiqueta completa del dato (`Ataque Mágico`), para accesibilidad. */
  label: string;
  value: number;
  /** 0-1: fracción del radio. */
  ratio: number;
}

/**
 * Los vértices que la ficha SÍ tiene, en el orden del gráfico. Un atributo ausente se omite
 * (en vez de dibujarse en 0): una ficha con 5 atributos da un pentágono, no una forma rota.
 */
export function verticesDeRadar(stats: readonly StatRow[]): VerticeDeRadar[] {
  const porSlug = new Map(stats.filter((s) => typeof s.value === 'number').map((s) => [s.slug, s]));
  return EJES_DE_RADAR.flatMap((eje) => {
    const stat = porSlug.get(eje.slug);
    if (!stat || typeof stat.value !== 'number') return [];
    const bruto = Math.max(0, stat.value) / eje.ref;
    return [{ slug: eje.slug, corto: eje.corto, label: stat.label, value: stat.value, ratio: Math.min(1, Math.max(PISO, bruto)) }];
  });
}

/** Posición de un eje: el primero apunta ARRIBA y se avanza en el sentido de las agujas del reloj. */
export function puntoDeEje(indice: number, total: number, radio: number, cx: number, cy: number): { x: number; y: number } {
  const angulo = -Math.PI / 2 + (2 * Math.PI * indice) / total;
  return { x: cx + radio * Math.cos(angulo), y: cy + radio * Math.sin(angulo) };
}

/** El atributo `points` de un `<polygon>` para una lista de fracciones (una por eje). */
export function poligono(ratios: readonly number[], radio: number, cx: number, cy: number): string {
  return ratios
    .map((ratio, i) => {
      const { x, y } = puntoDeEje(i, ratios.length, radio * ratio, cx, cy);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
