/** Hook de búsqueda: estado en URL, fetch cancelable y facetas. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../../lib/api';
import { DEFAULT_SEARCH, searchParamsFromUrl, searchParamsToUrl } from '../../lib/query';
import type { ApiListResponse, SearchParams } from '../../lib/types';

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
export function useVtuberSearch(): UseVtuberSearchResult {
  const [urlParams, setUrlParams] = useSearchParams();
  const params = useMemo(() => searchParamsFromUrl(urlParams.toString()), [urlParams]);
  const [data, setData] = useState<ApiListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const id = requestId.current + 1;
    requestId.current = id;
    setLoading(true);
    setError(null);

    api
      .list({ ...params, perPage: params.perPage }, controller.signal)
      .then((response) => {
        if (requestId.current !== id) return;
        setData(response);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted || requestId.current !== id) return;
        setError(cause instanceof Error ? cause.message : 'error desconocido');
      })
      .finally(() => {
        if (requestId.current === id) setLoading(false);
      });

    return () => controller.abort();
  }, [params]);

  const setParams = useCallback(
    (patch: Partial<SearchParams>) => {
      const next = { ...params, ...patch };
      setUrlParams(new URLSearchParams(searchParamsToUrl(next).split('?')[1] ?? ''), { replace: false });
    },
    [params, setUrlParams],
  );

  const reset = useCallback(() => {
    setUrlParams(new URLSearchParams(), { replace: false });
  }, [setUrlParams]);

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
