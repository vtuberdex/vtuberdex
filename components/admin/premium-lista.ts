/**
 * Lógica de la LISTA de cartas premium del mantenedor: qué filtros hay, cómo se ordena y se pagina.
 * Pura (sin React) para poder probarla: la pantalla solo la pinta.
 *
 * POR QUÉ EXISTE: la lista era una tarjeta alta por carta, todas apiladas. Con decenas de premium eso es una
 * sábana donde no se encuentra nada. Aquí vive lo que la vuelve manejable: filtros por tramo CON contadores,
 * el filtro del trabajo mensual («por subir»), búsqueda local, orden y paginación.
 */
import { TODOS_LOS_GRADOS, esGradoDegradado, gradoSiguiente, mismoMes } from '@/lib/premium';
import type { VtuberCard } from '@/lib/types';

export type FiltroPremium = 'todas' | 'por-subir' | 'bajos' | 'medios' | 'diez' | 'bl' | 'deterioradas';
export type OrdenPremium = 'grado-desc' | 'grado-asc' | 'cambio-antiguo' | 'nombre' | 'dex';

export const FILTROS: ReadonlyArray<{ id: FiltroPremium; etiqueta: string; ayuda: string }> = [
  { id: 'todas', etiqueta: 'Todas', ayuda: 'Todas las cartas premium y deterioradas' },
  { id: 'por-subir', etiqueta: 'Por subir este mes', ayuda: 'Premium que aún no cambiaron de grado este mes y pueden subir' },
  { id: 'bajos', etiqueta: '6 – 7,5', ayuda: 'Grados de entrada: 6, 6.5, 7 y 7.5' },
  { id: 'medios', etiqueta: '8 – 9,5', ayuda: 'Grados 8, 8.5, 9 y 9.5' },
  { id: 'diez', etiqueta: '10', ayuda: 'Grado 10 (el siguiente es la Black Label)' },
  { id: 'bl', etiqueta: 'Black Label', ayuda: 'Black Label (grado máximo)' },
  { id: 'deterioradas', etiqueta: 'Deterioradas', ayuda: 'Cartas degradadas (grados 1 a 7) y bajas' },
];

export const ORDENES: ReadonlyArray<{ id: OrdenPremium; etiqueta: string }> = [
  { id: 'grado-desc', etiqueta: 'Grado: mayor primero' },
  { id: 'grado-asc', etiqueta: 'Grado: menor primero' },
  { id: 'cambio-antiguo', etiqueta: 'Último cambio: más antiguo primero' },
  { id: 'nombre', etiqueta: 'Nombre (A–Z)' },
  { id: 'dex', etiqueta: 'Número de dex' },
];

export const POR_PAGINA = 20;

const BAJOS = new Set(['6', '6.5', '7.5']).add('7');
const MEDIOS = new Set(['8', '8.5', '9', '9.5']);

/**
 * El «gesto mensual»: una carta premium (no deteriorada) que aún puede subir y que NO cambió de grado este mes.
 * El mantenedor no calcula las donaciones solas; esto solo le dice a quién le falta revisar.
 */
export function porSubir(row: VtuberCard, ahora?: string): boolean {
  const p = row.premium;
  if (!p || esGradoDegradado(p.grade)) return false;
  return gradoSiguiente(p.grade) !== null && !mismoMes(p.gradedAt, ahora);
}

export function perteneceAlFiltro(row: VtuberCard, filtro: FiltroPremium, ahora?: string): boolean {
  const g = row.premium?.grade;
  if (!g) return false;
  switch (filtro) {
    case 'todas':
      return true;
    case 'por-subir':
      return porSubir(row, ahora);
    case 'bajos':
      return BAJOS.has(g);
    case 'medios':
      return MEDIOS.has(g);
    case 'diez':
      return g === '10';
    case 'bl':
      return g === 'BL';
    case 'deterioradas':
      return esGradoDegradado(g);
  }
}

/** Minúsculas y sin tildes: «Papá» se encuentra escribiendo «papa». */
const limpio = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Búsqueda local en la lista: por nombre, slug, número de dex (con o sin `#`) o certificado `VTD-…`. */
export function coincideConTexto(row: VtuberCard, texto: string): boolean {
  const t = limpio(texto.trim());
  if (!t) return true;
  const campos = [row.name, row.slug, `#${row.dexNumber}`, String(row.dexNumber).padStart(3, '0'), row.premium?.cert ?? ''];
  const sinAlmohadilla = t.replace(/^#/, '');
  return campos.some((c) => limpio(String(c)).includes(sinAlmohadilla));
}

export function contarPorFiltro(rows: VtuberCard[], ahora?: string): Record<FiltroPremium, number> {
  const cuenta = Object.fromEntries(FILTROS.map((f) => [f.id, 0])) as Record<FiltroPremium, number>;
  for (const row of rows) for (const f of FILTROS) if (perteneceAlFiltro(row, f.id, ahora)) cuenta[f.id] += 1;
  return cuenta;
}

const rangoDeGrado = (row: VtuberCard) => TODOS_LOS_GRADOS.indexOf((row.premium?.grade ?? '1') as never);

export function ordenar(rows: VtuberCard[], orden: OrdenPremium): VtuberCard[] {
  const copia = [...rows];
  const porNombre = (a: VtuberCard, b: VtuberCard) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
  switch (orden) {
    case 'grado-desc':
      return copia.sort((a, b) => rangoDeGrado(b) - rangoDeGrado(a) || porNombre(a, b));
    case 'grado-asc':
      return copia.sort((a, b) => rangoDeGrado(a) - rangoDeGrado(b) || porNombre(a, b));
    case 'cambio-antiguo':
      return copia.sort((a, b) => String(a.premium?.gradedAt).localeCompare(String(b.premium?.gradedAt)) || porNombre(a, b));
    case 'nombre':
      return copia.sort(porNombre);
    case 'dex':
      return copia.sort((a, b) => a.dexNumber - b.dexNumber);
  }
}

export function paginar<T>(items: T[], pagina: number, porPagina = POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(items.length / porPagina));
  const actual = Math.min(Math.max(1, pagina), paginas);
  const desde = (actual - 1) * porPagina;
  return { items: items.slice(desde, desde + porPagina), pagina: actual, paginas, desde: items.length ? desde + 1 : 0, hasta: Math.min(items.length, desde + porPagina), total: items.length };
}
