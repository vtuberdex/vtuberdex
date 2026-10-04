/**
 * Cliente de la API. Única puerta de salida a la red: el resto de la app
 * consume funciones tipadas y nunca arma URLs a mano.
 */
import type {
  AdminListResponse,
  AdminStatusFilter,
  ApiListResponse,
  FactionRow,
  Neighbors,
  UploadKind,
  VtuberCreate,
  VtuberDetail,
  VtuberPatch,
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

/** Estado de los likes de una ficha para el visitante que consulta (ver `app/api/vtubers/[slug]/like`). */
export interface LikeResumen {
  likes: number;
  /** ¿Ya le dio like HOY? */
  liked: boolean;
  level: number;
  experience: { current: number; max: number };
  /** Experiencia que suma cada like. */
  xpPorLike: number;
}

/** Una solicitud de la cola del mantenedor (inscripción, baja o modificación). El contacto es confidencial: solo llega con sesión. */
export interface SolicitudAdmin {
  id: number;
  tipo: 'inscripcion' | 'baja' | 'modificacion';
  estado: 'pendiente' | 'aprobada' | 'rechazada' | 'procesada';
  datos: Record<string, unknown>;
  contacto: { email?: string; realName?: string } | null;
  terminosVersion: string;
  terminosAceptadosEn: string;
  creado: string;
  resuelto: string | null;
  resueltoPor: string | null;
  nota: string | null;
  vtuberSlug: string | null;
}

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

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export const api = {
  list(params: SearchParams, signal?: AbortSignal): Promise<ApiListResponse> {
    return request<ApiListResponse>(`/api/vtubers?${searchParamsToQuery(params)}`, { signal });
  },
  detail(slug: string, signal?: AbortSignal): Promise<VtuberDetail & { neighbors: Neighbors }> {
    return request(`/api/vtubers/${encodeURIComponent(slug)}`, { signal });
  },
  likeEstado(slug: string, signal?: AbortSignal): Promise<LikeResumen> {
    return request<LikeResumen>(`/api/vtubers/${encodeURIComponent(slug)}/like`, { signal });
  },
  /** Da el like de hoy. Un segundo intento el mismo día responde 409 (`ApiError.status`). */
  darLike(slug: string): Promise<LikeResumen> {
    return request<LikeResumen>(`/api/vtubers/${encodeURIComponent(slug)}/like`, { method: 'POST' });
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
  updateVtuber(token: string, id: number, patch: VtuberPatch) {
    return request<VtuberDetail>(`/api/admin/vtubers/${id}`, {
      method: 'PATCH',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify(patch),
    });
  },
  /**
   * Listado del mantenedor: a diferencia de `list`, INCLUYE borradores y ocultos
   * (la ruta pública solo devuelve lo publicado).
   */
  adminList(
    token: string,
    params: { q?: string; status?: AdminStatusFilter; premium?: boolean; page?: number; perPage?: number },
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    query.set('status', params.status ?? 'all');
    if (params.premium) query.set('premium', '1');
    if (params.page) query.set('page', String(params.page));
    if (params.perPage) query.set('perPage', String(params.perPage));
    return request<AdminListResponse>(`/api/admin/vtubers?${query}`, { headers: bearer(token), signal });
  },
  /** Detalle por id, sin filtrar por estado: `detail(slug)` da 404 en borradores. */
  adminDetail(token: string, id: number) {
    return request<VtuberDetail>(`/api/admin/vtubers/${id}`, { headers: bearer(token) });
  },
  /** Crea una ficha; nace en BORRADOR y al final de la dex. */
  createVtuber(token: string, body: VtuberCreate) {
    return request<VtuberDetail>('/api/admin/vtubers', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify(body),
    });
  },
  /** Número que recibiría una ficha mandada «al final» de la dex. */
  dexNext(token: string) {
    return request<{ next: number }>('/api/admin/dex/next', { headers: bearer(token) });
  },
  factions(token: string) {
    return request<{ items: FactionRow[] }>('/api/admin/factions', { headers: bearer(token) });
  },
  createFaction(token: string, body: { label: string; icon?: string | null }) {
    return request<{ faction: FactionRow; items: FactionRow[] }>('/api/admin/factions', {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify(body),
    });
  },
  updateFaction(token: string, id: number, body: { label?: string; icon?: string | null }) {
    return request<{ faction: FactionRow; items: FactionRow[] }>(`/api/admin/factions/${id}`, {
      method: 'PATCH',
      headers: bearer(token),
      body: JSON.stringify(body),
    });
  },
  /** Con `mergeInto` las fichas pasan a esa facción; sin él pierden la facción. */
  deleteFaction(token: string, id: number, mergeInto?: number) {
    const query = mergeInto ? `?mergeInto=${mergeInto}` : '';
    return request<{ ok: boolean; items: FactionRow[] }>(`/api/admin/factions/${id}${query}`, {
      method: 'DELETE',
      headers: bearer(token),
    });
  },
  /**
   * Sube el emblema (PNG) de una facción. Binario crudo, como las imágenes de las fichas;
   * el servidor valida por contenido (máx. 2 MB en producción) y versiona la URL (`?v=`).
   */
  uploadFactionEmblem(token: string, id: number, file: Blob) {
    return request<{ faction: FactionRow; items: FactionRow[]; asset: unknown }>(`/api/admin/factions/${id}/image`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: file,
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
  /** Formulario público de inscripción: deja una solicitud pendiente, no crea la ficha. */
  enviarInscripcion(body: Record<string, unknown>) {
    return request<{ ok: true; estado: 'pendiente'; id: number | null }>('/api/inscripciones', { method: 'POST', body: JSON.stringify(body) });
  },
  /** Formulario público de baja. Mismos términos que la inscripción. */
  enviarBaja(body: Record<string, unknown>) {
    return request<{ ok: true; estado: 'pendiente'; id: number | null }>('/api/bajas', { method: 'POST', body: JSON.stringify(body) });
  },
  /** Formulario público para pedir cambios en una ficha ya registrada. Mismos términos y misma cola. */
  enviarModificacion(body: Record<string, unknown>) {
    return request<{ ok: true; estado: 'pendiente'; id: number | null }>('/api/modificaciones', { method: 'POST', body: JSON.stringify(body) });
  },
  solicitudes(token: string, estado: string = 'pendiente', tipo?: 'inscripcion' | 'baja' | 'modificacion') {
    const query = new URLSearchParams({ estado, ...(tipo ? { tipo } : {}) });
    return request<{ items: SolicitudAdmin[]; pendientes: { inscripcion: number; baja: number; modificacion: number } }>(`/api/admin/solicitudes?${query}`, {
      headers: bearer(token),
    });
  },
  resolverSolicitud(token: string, id: number, accion: 'aprobar' | 'rechazar' | 'procesar', nota = '') {
    return request<{ solicitud: SolicitudAdmin }>(`/api/admin/solicitudes/${id}/resolver`, {
      method: 'POST',
      headers: bearer(token),
      body: JSON.stringify({ accion, nota }),
    });
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
