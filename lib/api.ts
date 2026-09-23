/**
 * Cliente de la API. Única puerta de salida a la red: el resto de la app
 * consume funciones tipadas y nunca arma URLs a mano.
 */
import type {
  ApiListResponse,
  Neighbors,
  UploadKind,
  VtuberDetail,
  SearchParams,
} from '@/lib/types';
import { searchParamsToQuery } from '@/lib/query';

/**
 * Base de la API.
 *
 * En Vite venía de `import.meta.env.VITE_API_BASE`. Para que este cliente siga
 * siendo PORTABLE (los tests lo montan fuera de Next y el servidor Express lo
 * usa en local), se lee de `globalThis` en vez de una API del bundler: vacío por
 * defecto, que es lo correcto tanto en el navegador (la app llama a su propio
 * `/api` por ruta relativa) como en los tests.
 */
const BASE = (globalThis as { __VTUBERDEX_API_BASE__?: string }).__VTUBERDEX_API_BASE__ ?? '';

export class ApiError extends Error {
  status: number;
  issues?: unknown;

  constructor(message: string, status: number, issues?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.issues = issues;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Los headers se COMBINAN, no se reemplazan: con `...init` después del objeto
  // de headers, pasar `headers: { authorization }` borraba el
  // `content-type: application/json` por defecto, `express.json` no parseaba el
  // cuerpo y el PATCH fallaba con "expected object, received undefined".
  // Al llamar SIEMPRE al cliente con cuerpo JSON, el valor por defecto es JSON y
  // solo lo sobreescribe un llamador que lo pida explícitamente.
  const { headers: extraHeaders, ...rest } = init ?? {};
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'content-type': 'application/json', ...(extraHeaders ?? {}) },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  if (!response.ok) {
    const detail = payload as { error?: string; detail?: string; issues?: unknown } | null;
    throw new ApiError(detail?.detail ?? detail?.error ?? `HTTP ${response.status}`, response.status, detail?.issues);
  }
  return payload as T;
}

export const api = {
  list(params: SearchParams, signal?: AbortSignal): Promise<ApiListResponse> {
    return request<ApiListResponse>(`/api/vtubers?${searchParamsToQuery(params)}`, { signal });
  },
  detail(slug: string, signal?: AbortSignal): Promise<VtuberDetail & { neighbors: Neighbors }> {
    return request(`/api/vtubers/${encodeURIComponent(slug)}`, { signal });
  },
  /**
   * `GET /api/meta` se retiró (ver `app/api/health/route.js`): las facetas viajan en
   * `api.list()` con `facet=all`, que es lo que el panel de filtros consume de verdad.
   */
  login(username: string, password: string) {
    return request<{ token: string; user: { username: string; role: string } }>('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  session(token: string) {
    return request<{ user: { username: string; role: string } }>('/api/admin/session', {
      headers: { authorization: `Bearer ${token}` },
    });
  },
  updateVtuber(token: string, id: number, patch: Record<string, unknown>) {
    return request<VtuberDetail>(`/api/admin/vtubers/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
  },
  /**
   * Sube o reemplaza una imagen de un VTuber. El archivo va como binario crudo
   * (el servidor lo valida por contenido y lo convierte a WebP optimizado), así
   * que NO se usa FormData: el `Content-Type` se deja genérico a propósito.
   *
   * La respuesta trae `vtuber`, el detalle ACTUALIZADO: el mantenedor lo usa como
   * ficha seleccionada (`setSelected(result.vtuber)`), así que si faltara la página
   * se quedaría con los datos del catálogo y volvería a pintar "sin imagen" sobre
   * la imagen recién subida. Los dos backends (Express y la ruta de producción)
   * devuelven esta misma forma.
   */
  uploadImage(token: string, id: number, kind: UploadKind, file: Blob) {
    return request<{
      ok: true;
      kind: UploadKind;
      asset: { path: string; width: number | null; height: number | null; bytes: number; format: string; hasAlpha: boolean; alphaLost: boolean };
      vtuber: VtuberDetail;
    }>(`/api/admin/vtubers/${id}/image/${kind}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: file,
    });
  },
  deleteImage(token: string, id: number, kind: UploadKind) {
    return request<{ ok: true; kind: UploadKind; slug: string; restaurado: string; vtuber: VtuberDetail }>(
      `/api/admin/vtubers/${id}/image/${kind}`,
      { method: 'DELETE', headers: { authorization: `Bearer ${token}` } },
    );
  },
  adminStats(token: string) {
    return request<{
      totals: { total: number; withDetail: number; notPublished: number };
      themes: number;
      quality: Array<{ flags: string[]; count: number }>;
    }>('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
  },
  audit(token: string) {
    return request<{
      items: Array<{ id: number; actor: string; entity: string; entityId: number | null; action: string; payload: string | null; createdAt: string }>;
    }>('/api/admin/audit', { headers: { authorization: `Bearer ${token}` } });
  },
};
