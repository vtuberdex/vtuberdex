'use client';
/** Hook de búsqueda: estado en URL, fetch cancelable y facetas. */
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { RETRASO_PRECARGA_MS, guardarPagina, imagenesDeCartas, leerPagina, precargarVecinas } from '@/lib/cache-paginas';
import { DEFAULT_PER_PAGE, DEFAULT_SEARCH, searchParamsFromUrl, searchParamsToUrl } from '@/lib/query';
import type { ApiListResponse, SearchParams, VtuberCard } from '@/lib/types';
import { loadImage } from '@/components/card-texture/imagen';

/**
 * El tamaño de página lo decide el LIBRO, no la URL: 8 cartas (dos hojas de 4) en
 * escritorio y 4 (una hoja) en celular (`useSingleSheet`). Un `perPage` que venga en la
 * URL (enlaces antiguos) se ignora: pedir 24 y mostrar 8 descartaría trabajo del
 * servidor; pedir menos dejaría fundas vacías.
 */
const pedirPagina = (params: SearchParams, signal?: AbortSignal) => api.list(params, signal);

export interface UseVtuberSearchOptions {
  /** Cartas por página que el libro puede mostrar (8 o 4). */
  perPage?: number;
}

/** Deja las imágenes de unas cartas en la memoria de `loadImage` antes de que hagan falta. */
const calentarImagenes = (items: VtuberCard[]) => {
  if (typeof Image === 'undefined') return;
  for (const src of imagenesDeCartas(items)) void loadImage(src);
};

export interface UseVtuberSearchResult {
  params: SearchParams;
  data: ApiListResponse | null;
  loading: boolean;
  error: string | null;
  setParams: (patch: Partial<SearchParams>) => void;
  reset: () => void;
  goToPage: (page: number) => void;
}

/**
 * Única fuente de verdad de la búsqueda: la URL. Así un resultado se puede
 * compartir por enlace (algo imposible en el origen, que es 100% cliente).
 */
export function useVtuberSearch({ perPage = DEFAULT_PER_PAGE }: UseVtuberSearchOptions = {}): UseVtuberSearchResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryString = searchParams.toString();
  const params = useMemo(() => ({ ...searchParamsFromUrl(queryString), perPage }), [queryString, perPage]);
  const [data, setData] = useState<ApiListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const id = requestId.current + 1;
    requestId.current = id;
    setError(null);

    /**
     * Tras mostrar una página se piden sus VECINAS en segundo plano y se calientan sus
     * imágenes (ver `lib/cache-paginas.ts`): la siguiente y la anterior ya están en
     * memoria cuando el usuario pasa de hoja, así que el giro no espera a la red.
     */
    let precarga: ReturnType<typeof setTimeout> | undefined;
    const programarPrecarga = (response: ApiListResponse) => {
      precarga = setTimeout(() => {
        void precargarVecinas(params, response.pageCount, (vecina) => pedirPagina(vecina), calentarImagenes);
      }, RETRASO_PRECARGA_MS);
    };

    // Página ya en caché (visitada o precargada): se muestra sin tocar la red.
    const enCache = leerPagina(params);
    if (enCache) {
      setData(enCache);
      setLoading(false);
      calentarImagenes(enCache.items);
      programarPrecarga(enCache);
      return () => clearTimeout(precarga);
    }

    setLoading(true);
    pedirPagina(params, controller.signal)
      .then((response) => {
        if (requestId.current !== id) return;
        guardarPagina(params, response);
        setData(response);
        programarPrecarga(response);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setError(cause instanceof Error ? cause.message : 'error desconocido');
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });

    return () => {
      controller.abort();
      clearTimeout(precarga);
    };
  }, [params]);

  /**
   * La navegación de Next con `scroll: false` replica el comportamiento de
   * react-router: cambia el querystring sin recargar y sin dar un salto de
   * scroll, porque el SPA ya decidirá si subir (ver `goToPage`).
   */
  const pushQuery = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.push(query ? `?${query}` : '?', { scroll: false });
    },
    [router],
  );

  const setParams = useCallback(
    (patch: Partial<SearchParams>) => {
      // El `perPage` del libro (8 o 4) NO viaja en la URL: lo decide el viewport de quien
      // mira, y un enlace compartido no debe arrastrar el tamaño de hoja de otro equipo.
      const next = { ...params, ...patch, perPage: DEFAULT_PER_PAGE };
      pushQuery(new URLSearchParams(searchParamsToUrl(next).split('?')[1] ?? ''));
    },
    [params, pushQuery],
  );

  const reset = useCallback(() => {
    pushQuery(new URLSearchParams());
  }, [pushQuery]);

  const goToPage = useCallback(
    (page: number) => {
      setParams({ page });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    [setParams],
  );

  return { params, data, loading, error, setParams, reset, goToPage };
}

export { DEFAULT_SEARCH };
