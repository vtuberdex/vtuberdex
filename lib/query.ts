// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/** Serialización de filtros a querystring y parseo inverso (URL = estado). */

import type { SearchParams, SortKey } from "@/lib/types";

/**
 * Cartas por página.
 *
 * 8 = las dos hojas del libro de cartas (`CardBinder`: 2 hojas x 4 fundas). Es el
 * único tamaño que el catálogo pide a la API (ver `use-vtuber-search.ts`): el
 * selector «por página» desapareció con la grilla, y un `perPage` distinto en la URL
 * se tolera al parsear pero no se usa. El número nació del límite de contextos WebGL
 * (una grilla con un canvas por carta no podía pasar de 8 sin que el navegador
 * destruyera contextos); hoy el libro dibuja las 8 en un solo canvas, y 8 sigue
 * siendo lo que cabe en un álbum abierto.
 */
export const DEFAULT_PER_PAGE = 8;

export const DEFAULT_SEARCH: SearchParams = {
  q: "",
  countries: [],
  languages: [],
  groups: [],
  artists: [],
  factions: [],
  language: null,
  sort: "dex",
  premium: false,
  page: 1,
  perPage: DEFAULT_PER_PAGE,
};

const SORTS: ReadonlySet<SortKey> = new Set<SortKey>([
  "dex",
  "dex-desc",
  "name",
  "power",
]);

const listOf = (values: string[] | undefined) =>
  (values ?? [])
    .flatMap((value) => String(value).split(","))
    .map((value) => value.trim())
    .filter(Boolean);

/** Query string para la API. Solo se envían los filtros activos. */
export function searchParamsToQuery(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q.trim()) {
    query.set("q", params.q.trim());
  }
  if (params.countries.length) {
    query.set("countries", params.countries.join(","));
  }
  if (params.languages.length) {
    query.set("languages", params.languages.join(","));
  }
  if (params.groups.length) {
    query.set("groups", params.groups.join(","));
  }
  if (params.artists.length) {
    query.set("artists", params.artists.join(","));
  }
  if (params.factions.length) {
    query.set("factions", params.factions.join(","));
  }
  if (params.language) {
    query.set("language", params.language);
  }
  if (params.premium) {
    query.set("premium", "1");
  }
  query.set("sort", params.sort);
  query.set("page", String(params.page));
  query.set("perPage", String(params.perPage));
  query.set("facet", "all");
  return query.toString();
}

/**
 * Validación del querystring, a mano y no con zod A PROPÓSITO: este módulo va en el JS del catálogo y
 * zod sumaba ~33 KB comprimidos (medido con `next analyze`, 2026-11-19) para ocho campos. La regla es
 * la misma que tenía el esquema: si un campo presente es inválido, TODA la búsqueda vuelve al defecto.
 * `URLSearchParams` solo da cadenas, así que no hay listas que comprobar aquí.
 */
type Crudo = Record<string, string>;
interface Validado {
  q?: string;
  countries?: string;
  languages?: string;
  groups?: string;
  artists?: string;
  factions?: string;
  language?: string;
  sort?: string;
  premium?: string;
  page?: number;
  perPage?: number;
}

/** Entero en [min, max] como lo leía `z.coerce.number().int()`: `""` es 0 y `"1.5"` no es entero. */
function entero(valor: string, min: number, max: number): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const ORDENES = new Set(["dex", "dex-desc", "name", "power"]);

function validarBusqueda(raw: Crudo): Validado | null {
  const salida: Validado = {};
  for (const campo of [
    "countries",
    "languages",
    "groups",
    "artists",
    "factions",
  ] as const) {
    if (raw[campo] !== undefined) {
      salida[campo] = raw[campo];
    }
  }
  if (raw.q !== undefined) {
    if (raw.q.length > 120) {
      return null;
    }
    salida.q = raw.q;
  }
  if (raw.language !== undefined) {
    if (raw.language.length > 10) {
      return null;
    }
    salida.language = raw.language;
  }
  if (raw.sort !== undefined) {
    if (!ORDENES.has(raw.sort)) {
      return null;
    }
    salida.sort = raw.sort;
  }
  if (raw.premium !== undefined) {
    if (raw.premium !== "1" && raw.premium !== "true") {
      return null;
    }
    salida.premium = raw.premium;
  }
  for (const [campo, max] of [
    ["page", 10_000],
    ["perPage", 100],
  ] as const) {
    if (raw[campo] !== undefined) {
      const n = entero(raw[campo], 1, max);
      if (n === null) {
        return null;
      }
      salida[campo] = n;
    }
  }
  return salida;
}

const asList = (value: string | string[] | undefined): string[] => {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
};

/** URL -> SearchParams (tolerante: valores inválidos caen al default). */
export function searchParamsFromUrl(search: string): SearchParams {
  const raw = Object.fromEntries(new URLSearchParams(search));
  const data = validarBusqueda(raw);
  if (!data) {
    return { ...DEFAULT_SEARCH };
  }
  return {
    q: data.q ?? "",
    countries: listOf(asList(data.countries)),
    languages: listOf(asList(data.languages)),
    groups: listOf(asList(data.groups)),
    artists: listOf(asList(data.artists)),
    factions: listOf(asList(data.factions)),
    language: data.language ?? null,
    sort: SORTS.has(data.sort as SortKey) ? (data.sort as SortKey) : "dex",
    premium: data.premium !== undefined,
    page: data.page ?? 1,
    perPage: data.perPage ?? DEFAULT_PER_PAGE,
  };
}

/** SearchParams -> URL (para navegación y enlaces compartibles). */
export function searchParamsToUrl(params: SearchParams): string {
  const query = new URLSearchParams();
  if (params.q.trim()) {
    query.set("q", params.q.trim());
  }
  const join = (values: string[]) => (values.length ? values.join(",") : null);
  for (const [key, value] of [
    ["countries", join(params.countries)],
    ["languages", join(params.languages)],
    ["groups", join(params.groups)],
    ["artists", join(params.artists)],
    ["factions", join(params.factions)],
  ] as const) {
    if (value) {
      query.set(key, value);
    }
  }
  if (params.language) {
    query.set("language", params.language);
  }
  if (params.sort !== "dex") {
    query.set("sort", params.sort);
  }
  if (params.premium) {
    query.set("premium", "1");
  }
  if (params.page > 1) {
    query.set("page", String(params.page));
  }
  if (params.perPage !== DEFAULT_PER_PAGE) {
    query.set("perPage", String(params.perPage));
  }
  const suffix = query.toString();
  return suffix ? `/?${suffix}` : "/";
}

/** Activa/desactiva un valor dentro de un filtro multivaluado. */
export function toggleValue(list: string[], value: string): string[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/** Cuenta de filtros activos (para el badge del panel móvil). */
export function activeFilterCount(params: SearchParams): number {
  return (
    params.countries.length +
    params.languages.length +
    params.groups.length +
    params.artists.length +
    params.factions.length +
    (params.premium ? 1 : 0) +
    (params.q.trim() ? 1 : 0)
  );
}
