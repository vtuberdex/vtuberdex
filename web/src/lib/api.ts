/**
 * Cliente de la API. Única puerta de salida a la red: el resto de la app
 * consume funciones tipadas y nunca arma URLs a mano.
 */
import type {
  ApiListResponse,
  ApiMetaResponse,
  Neighbors,
  UploadKind,
  VtuberDetail,
  SearchParams,
} from './types';
import { searchParamsToQuery } from './query';

const BASE = import.meta.env.VITE_API_BASE ?? '';

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
  meta(params: { language?: string | null; q?: string } = {}, signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (params.language) query.set('language', params.language);
    if (params.q) query.set('q', params.q);
    const suffix = query.toString() ? `?${query}` : '';
    return request<ApiMetaResponse>(`/api/meta${suffix}`, { signal });
  },
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
   */
  uploadImage(token: string, id: number, kind: UploadKind, file: Blob) {
    return request<{
      ok: true;
      kind: UploadKind;
      asset: { path: string; width: number; height: number; bytes: number; format: string; hasAlpha: boolean; alphaLost: boolean };
      vtuber: VtuberDetail;
    }>(`/api/admin/vtubers/${id}/image/${kind}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: file,
    });
  },
  deleteImage(token: string, id: number, kind: UploadKind) {
    return request<{ ok: true; kind: UploadKind; vtuber: VtuberDetail }>(
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

export { BASE as API_BASE };
