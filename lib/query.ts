/** Serialización de filtros a querystring y parseo inverso (URL = estado). */
import { z } from 'zod';

import type { SearchParams, SortKey } from '@/lib/types';

/**
 * Cartas por página.
 *
 * 8, no 24: el navegador no sostiene más de 16 contextos WebGL y destruye los más
 * antiguos al pasarse. Con 24 cartas por página, en un viewport de escritorio 15
 * quedaban a la vista y el presupuesto no alcanzaba, así que las últimas de la
 * rejilla aparecían en 2D y solo pasaban a 3D al desplazarse (y al salir se
 * destruían). Con 8 caben todas en pantalla: nadie espera turno y ninguna carta se
 * queda sin su carta 3D.
 */
export const DEFAULT_PER_PAGE = 8;

export const DEFAULT_SEARCH: SearchParams = {
  q: '',
  countries: [],
  languages: [],
  groups: [],
  artists: [],
  factions: [],
  language: null,
  sort: 'dex',
  page: 1,
  perPage: DEFAULT_PER_PAGE,
};

const SORTS: SortKey[] = ['dex', 'dex-desc', 'name', 'power'];

const listOf = (values: string[] | undefined) =>
  (values ?? [])
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);

/** Query string para la API. Solo se envían los filtros activos. */
export function searchParamsToQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q.trim()) query.set('q', params.q.trim());
  if (params.countries.length) query.set('countries', params.countries.join(','));
  if (params.languages.length) query.set('languages', params.languages.join(','));
  if (params.groups.length) query.set('groups', params.groups.join(','));
  if (params.artists.length) query.set('artists', params.artists.join(','));
  if (params.factions.length) query.set('factions', params.factions.join(','));
  if (params.language) query.set('language', params.language);
  query.set('sort', params.sort);
  query.set('page', String(params.page));
  query.set('perPage', String(params.perPage));
  query.set('facet', 'all');
  return query.toString();
}

const searchParamsSchema = z.object({
  q: z.string().max(120).optional(),
  countries: z.union([z.string(), z.array(z.string())]).optional(),
  languages: z.union([z.string(), z.array(z.string())]).optional(),
  groups: z.union([z.string(), z.array(z.string())]).optional(),
  artists: z.union([z.string(), z.array(z.string())]).optional(),
  factions: z.union([z.string(), z.array(z.string())]).optional(),
  language: z.string().max(10).optional(),
  sort: z.enum(['dex', 'dex-desc', 'name', 'power']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  perPage: z.coerce.number().int().min(1).max(100).optional(),
});

const asList = (value: string | string[] | undefined) => (Array.isArray(value) ? value : value ? [value] : []);

/** URL -> SearchParams (tolerante: valores inválidos caen al default). */
export function searchParamsFromUrl(search: string): SearchParams {
  const raw = Object.fromEntries(new URLSearchParams(search));
  const parsed = searchParamsSchema.safeParse(raw);
  if (!parsed.success) return { ...DEFAULT_SEARCH };
  const data = parsed.data;
  return {
    q: data.q ?? '',
    countries: listOf(asList(data.countries)),
    languages: listOf(asList(data.languages)),
    groups: listOf(asList(data.groups)),
    artists: listOf(asList(data.artists)),
    factions: listOf(asList(data.factions)),
    language: data.language ?? null,
    sort: SORTS.includes(data.sort as SortKey) ? (data.sort as SortKey) : 'dex',
    page: data.page ?? 1,
    perPage: data.perPage ?? DEFAULT_PER_PAGE,
  };
}

/** SearchParams -> URL (para navegación y enlaces compartibles). */
export function searchParamsToUrl(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q.trim()) query.set('q', params.q.trim());
  const join = (values: string[]) => (values.length ? values.join(',') : null);
  for (const [key, value] of [
    ['countries', join(params.countries)],
    ['languages', join(params.languages)],
    ['groups', join(params.groups)],
    ['artists', join(params.artists)],
    ['factions', join(params.factions)],
  ] as const) {
    if (value) query.set(key, value);
  }
  if (params.language) query.set('language', params.language);
  if (params.sort !== 'dex') query.set('sort', params.sort);
  if (params.page > 1) query.set('page', String(params.page));
  if (params.perPage !== DEFAULT_PER_PAGE) query.set('perPage', String(params.perPage));
  const suffix = query.toString();
  return suffix ? `/?${suffix}` : '/';
}

/** Activa/desactiva un valor dentro de un filtro multivaluado. */
export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Cuenta de filtros activos (para el badge del panel móvil). */
export function activeFilterCount(params: SearchParams): number {
  return (
    params.countries.length +
    params.languages.length +
    params.groups.length +
    params.artists.length +
    params.factions.length +
    (params.q.trim() ? 1 : 0)
  );
}
