/**
 * Cliente de la API. Única puerta de salida a la red: el resto de la app
 * consume funciones tipadas y nunca arma URLs a mano.
 */
import type {
  AdminStats,
  AdminCorreoFilter,
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
} from "@/lib/types";
import { searchParamsToQuery } from "@/lib/query";
import { asegurarSesion } from "@/lib/sesion-cliente";

/**
 * Base de la API.
 *
 * En Vite venía de `import.meta.env.VITE_API_BASE`. Para que este cliente siga
 * siendo PORTABLE (los tests lo montan fuera de Next y el servidor Express lo
 * usa en local), se lee de `globalThis` en vez de una API del bundler: vacío por
 * defecto, que es lo correcto tanto en el navegador (la app llama a su propio
 * `/api` por ruta relativa) como en los tests.
 */
const BASE =
  (globalThis as { __VTUBERDEX_API_BASE__?: string }).__VTUBERDEX_API_BASE__ ??
  "";

/** Estado de los likes de una ficha para el visitante que consulta (ver `app/api/vtubers/[slug]/like`). */
export interface LikeResumen {
  likes: number;
  /** ¿Ya le dio like HOY? */
  liked: boolean;
  level: number;
  experience: { current: number; max: number; total?: number };
  /** Experiencia que suma cada like. */
  xpPorLike: number;
}

/** Una solicitud de la cola del mantenedor (inscripción, baja o modificación). El contacto es confidencial: solo llega con sesión. */
export interface SolicitudAdmin {
  id: number;
  tipo: "inscripcion" | "baja" | "modificacion";
  estado: "pendiente" | "aprobada" | "rechazada" | "procesada";
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

/** Resumen de una ficha en la vista previa de una solicitud. */
export interface FichaResumen {
  id: number;
  slug: string;
  name: string;
  dexNumber: number;
  status: string;
  grado: string | null;
}

/** Lo que pasaría si se aprueba una solicitud (ver `server/src/solicitud-vista.mjs`). */
export interface VistaPreviaSolicitud {
  tipo: "inscripcion" | "baja" | "modificacion";
  estado: string;
  puedeAprobar: boolean;
  problema: {
    codigo: string;
    mensaje: string;
    detalles?: Array<{ path: string; message: string }>;
  } | null;
  avisos: string[];
  /** Inscripción: la ficha que nacería. */
  creara?: { name: string; slug: string; estado: string };
  /** Modificación y baja: la ficha afectada. */
  ficha?: FichaResumen | null;
  cambios?: Array<{
    campo: string;
    antes: string;
    despues: string;
    nuevo: boolean;
  }>;
  imagenes?: { imageId?: string; logoId?: string };
  /** Modificación sin ficha resuelta: fichas parecidas para elegir. */
  candidatas?: FichaResumen[];
}

/** Lo que el formulario de inscripción guarda como borrador (`server/src/borradores.mjs`): sus campos y el paso (3 a 5). */
export type BorradorDeInscripcion = Record<string, unknown> & {
  name: string;
  languages: string[];
  socials: Array<{ platform: string; url: string }>;
  paso: 3 | 4 | 5;
};

/** Lo que responde `POST /api/verificar`: `fichas` solo viene con `baja_aplicada` (las que se dieron de baja). */
export interface ResultadoDeVerificacion {
  ok: true;
  tipo: "inscripcion" | "baja" | "modificacion";
  resultado: "en_revision" | "baja_aplicada" | "sin_ficha";
  fichas?: string[];
}

export class ApiError extends Error {
  status: number;
  issues?: unknown;

  constructor(message: string, status: number, issues?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.issues = issues;
  }
}

/** Formularios públicos que suben imágenes y su carpeta en `/api`. */
export type FormularioConImagenes = "inscripcion" | "modificacion";
const RUTA_DE_FORMULARIO: Record<FormularioConImagenes, string> = {
  inscripcion: "inscripciones",
  modificacion: "modificaciones",
};

async function request<T>(
  path: string,
  init?: RequestInit,
  reintento = false,
): Promise<T> {
  // Los headers se COMBINAN, no se reemplazan: con `...init` después del objeto
  // de headers, pasar `headers: { authorization }` borraba el
  // `content-type: application/json` por defecto, `express.json` no parseaba el
  // cuerpo y el PATCH fallaba con "expected object, received undefined".
  // Al llamar SIEMPRE al cliente con cuerpo JSON, el valor por defecto es JSON y
  // solo lo sobreescribe un llamador que lo pida explícitamente.
  const { headers: extraHeaders, ...rest } = init ?? {};
  const response = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { "content-type": "application/json", ...(extraHeaders ?? {}) },
  });
  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;
  // La API pública del catálogo exige una sesión de visitante (prueba de trabajo): se abre sola
  // y la petición se repite UNA vez. Ver `lib/sesion-visitante.mjs`.
  if (
    response.status === 401 &&
    !reintento &&
    (payload as { error?: string } | null)?.error === "sesion_requerida"
  ) {
    await asegurarSesion();
    return request<T>(path, init, true);
  }
  if (!response.ok) {
    const detail = payload as {
      error?: string;
      detail?: string;
      issues?: unknown;
    } | null;
    // Un 400 de validación traía `issues` (qué campo y por qué) y se perdía: la pantalla solo decía
    // «payload_invalido» y nadie sabía qué corregir. Se añade el primero al mensaje.
    const primero = Array.isArray(detail?.issues)
      ? (detail.issues[0] as { path?: string; message?: string } | undefined)
      : undefined;
    const que = primero?.path
      ? ` (${primero.path}: ${primero.message ?? "no válido"})`
      : "";
    throw new ApiError(
      `${detail?.detail ?? detail?.error ?? `HTTP ${response.status}`}${detail?.detail ? "" : que}`,
      response.status,
      detail?.issues,
    );
  }
  return payload as T;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** «Mi ficha»: una habilidad mejorable y su rango. */
export interface HabilidadMejorable {
  clave: string;
  name: string;
  category: "active" | "passive" | "ultimate" | "other";
  type: string | null;
  effect: string | null;
  rango: number;
}

/** «Mi ficha»: un stat que se sube gastando puntos (HP, MP, ataques, defensas). */
export interface StatMejorable {
  slug: string;
  label: string;
  base: number;
  puntos: number;
  valor: number;
  paso: number;
  tope: number | null;
  puedeSubir: boolean;
}

/** Un stat que sube solo con los niveles ganados (velocidad, evasión, precisión, crítico, suerte). */
export interface StatAutomatico {
  slug: string;
  label: string;
  base: number;
  bono: number;
  valor: number;
  cada: number;
  suma: number;
  tope: number | null;
}

export interface EstadoDeStats {
  stats: StatMejorable[];
  automaticos: StatAutomatico[];
  ganados: number;
  repartidos: number;
  disponibles: number;
  puntosPorNivel: number;
}

export interface VistaMiFicha {
  slug: string;
  name: string;
  level: number;
  levelsGained: number;
  likes: number;
  experience: { current: number; max: number; total: number };
  puntos: {
    habilidades: HabilidadMejorable[];
    ganados: number;
    repartidos: number;
    disponibles: number;
    rangoMaximo: number;
    puntosPorNivel: number;
  };
  /** Puntos de stats (bolsa aparte de las habilidades). Opcional: la maqueta de /niveles no lo trae. */
  statsPuntos?: EstadoDeStats;
  /** Cuenta de Minecraft vinculada y XP traída del juego. Opcional: la maqueta de /niveles no lo trae. */
  minecraft?: EstadoMinecraft;
  /** Misiones de Minecraft con su progreso. `null` si el almacén falló; ausente en la maqueta de /niveles. */
  misiones?: MisionesDeFicha | null;
}

export interface MisionVista {
  id: string;
  tipo: "secundaria" | "grado";
  nombre: string;
  descripcion: string;
  xp: number;
  repetible: "diaria" | null;
  requisitos: Array<{ contador: string; etiqueta: string; meta: number; progreso: number }>;
  completada: boolean;
  /** Solo en las misiones de grado. */
  grado?: string;
  reclamada?: boolean;
  reclamable?: boolean;
  motivo?: "ya_tiene_igual_o_mayor" | "ficha_deteriorada" | "grado_no_ganable" | null;
}

export interface ReclamoDeMision {
  vtuberId: number;
  misionId: string;
  mision: string;
  slug: string | null;
  name: string;
  grado: string;
  gradoPrevio: string | null;
  gradoActual: string | null;
  reclamado: string;
  revocado: string | null;
}

export interface MisionesDeFicha {
  secundarias: MisionVista[];
  grado: MisionVista[];
}

/** «Mi ficha»: el vínculo con Minecraft (el UUID no se muestra; basta el nombre de jugador). */
export interface EstadoMinecraft {
  vinculado: boolean;
  jugador: string | null;
  desde: string | null;
  xpJuego: number;
}

export interface RespuestaMiFicha {
  ok: true;
  fichas: Array<{ slug: string; name: string }>;
  ficha: VistaMiFicha;
}

export interface ResumenRechazos {
  dias: number;
  total: number;
  porCodigo: Array<{
    formulario: string;
    codigo: string;
    status: number;
    n: number;
  }>;
  porCampo: Array<{ formulario: string; campo: string; n: number }>;
  ultimo: string | null;
}

/** Estado de un canal de directo (ver `app/api/vtubers/[slug]/directo` y `lib/directos.mjs`). Solo llegan los que respondieron. */
export interface CanalDirecto {
  plataforma: "twitch" | "youtube" | "kick";
  url: string;
  enVivo: boolean;
  titulo?: string;
  espectadores?: number | null;
  categoria?: string | null;
  inicio?: string | null;
  miniatura?: string | null;
  /** Enlace al directo en curso (YouTube); en las otras es el canal. */
  enlace?: string;
  estadisticas?: {
    suscriptores: number | null;
    vistas: number | null;
    videos: number | null;
  };
  videos?: Array<{
    id: string;
    titulo: string;
    publicado: string | null;
    miniatura: string | null;
    vistas: number | null;
    url: string;
  }>;
}

export const api = {
  list(params: SearchParams, signal?: AbortSignal): Promise<ApiListResponse> {
    return request<ApiListResponse>(
      `/api/vtubers?${searchParamsToQuery(params)}`,
      { signal },
    );
  },
  detail(
    slug: string,
    signal?: AbortSignal,
  ): Promise<VtuberDetail & { neighbors: Neighbors }> {
    return request(`/api/vtubers/${encodeURIComponent(slug)}`, { signal });
  },
  directo(slug: string, signal?: AbortSignal): Promise<{ canales: CanalDirecto[] }> {
    return request(`/api/vtubers/${encodeURIComponent(slug)}/directo`, {
      signal,
    });
  },
  likeEstado(slug: string, signal?: AbortSignal): Promise<LikeResumen> {
    return request<LikeResumen>(
      `/api/vtubers/${encodeURIComponent(slug)}/like`,
      { signal },
    );
  },
  /** Da el like de hoy. Un segundo intento el mismo día responde 409 (`ApiError.status`). */
  darLike(slug: string): Promise<LikeResumen> {
    return request<LikeResumen>(
      `/api/vtubers/${encodeURIComponent(slug)}/like`,
      { method: "POST" },
    );
  },
  /**
   * `GET /api/meta` se retiró (ver `app/api/health/route.js`): las facetas viajan en
   * `api.list()` con `facet=all`, que es lo que el panel de filtros consume de verdad.
   */
  /** Pide el enlace mágico del mantenedor: responde igual para cualquier correo bien formado. */
  pedirEnlaceDeAcceso(email: string) {
    return request<{ ok: true }>("/api/admin/enlace", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  /** Gasta el enlace mágico (el token viaja en el fragmento de la URL, nunca en la ruta) y abre la sesión. */
  entrarConEnlace(token: string) {
    return request<{ token: string; user: { username: string; role: string } }>(
      "/api/admin/enlace/entrar",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
    );
  },
  /** Gasta el token del correo de una solicitud. */
  verificarSolicitud(token: string) {
    return request<ResultadoDeVerificacion>("/api/verificar", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
  session(token: string) {
    return request<{ user: { username: string; role: string } }>(
      "/api/admin/session",
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
  },
  updateVtuber(token: string, id: number, patch: VtuberPatch) {
    return request<VtuberDetail>(`/api/admin/vtubers/${id}`, {
      method: "PATCH",
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
    params: {
      q?: string;
      status?: AdminStatusFilter;
      premium?: boolean;
      correo?: AdminCorreoFilter;
      page?: number;
      perPage?: number;
    },
    signal?: AbortSignal,
  ) {
    const query = new URLSearchParams();
    if (params.q) query.set("q", params.q);
    query.set("status", params.status ?? "all");
    if (params.premium) query.set("premium", "1");
    if (params.correo && params.correo !== "todos")
      query.set("correo", params.correo);
    if (params.page) query.set("page", String(params.page));
    if (params.perPage) query.set("perPage", String(params.perPage));
    return request<AdminListResponse>(`/api/admin/vtubers?${query}`, {
      headers: bearer(token),
      signal,
    });
  },
  /** Detalle por id, sin filtrar por estado: `detail(slug)` da 404 en borradores. */
  adminDetail(token: string, id: number) {
    return request<VtuberDetail>(`/api/admin/vtubers/${id}`, {
      headers: bearer(token),
    });
  },
  /** Fija (o con `null` quita) el correo de una ficha: vive en la cola de solicitudes, no en la ficha. Si es nuevo, la ficha recibe un correo de bienvenida (`bienvenida`). */
  setVtuberEmail(token: string, id: number, email: string | null) {
    return request<{
      email: string | null;
      bienvenida?: "enviada" | "fallo" | "no";
    }>(`/api/admin/vtubers/${id}/correo`, {
      method: "PUT",
      headers: bearer(token),
      body: JSON.stringify({ email }),
    });
  },
  /** Crea una ficha; nace en BORRADOR y al final de la dex. */
  createVtuber(token: string, body: VtuberCreate) {
    return request<VtuberDetail>("/api/admin/vtubers", {
      method: "POST",
      headers: bearer(token),
      body: JSON.stringify(body),
    });
  },
  /** Número que recibiría una ficha mandada «al final» de la dex. */
  dexNext(token: string) {
    return request<{ next: number }>("/api/admin/dex/next", {
      headers: bearer(token),
    });
  },
  factions(token: string) {
    return request<{ items: FactionRow[] }>("/api/admin/factions", {
      headers: bearer(token),
    });
  },
  createFaction(token: string, body: { label: string; icon?: string | null }) {
    return request<{ faction: FactionRow; items: FactionRow[] }>(
      "/api/admin/factions",
      {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify(body),
      },
    );
  },
  updateFaction(
    token: string,
    id: number,
    body: { label?: string; icon?: string | null },
  ) {
    return request<{ faction: FactionRow; items: FactionRow[] }>(
      `/api/admin/factions/${id}`,
      {
        method: "PATCH",
        headers: bearer(token),
        body: JSON.stringify(body),
      },
    );
  },
  /** Con `mergeInto` las fichas pasan a esa facción; sin él pierden la facción. */
  deleteFaction(token: string, id: number, mergeInto?: number) {
    const query = mergeInto ? `?mergeInto=${mergeInto}` : "";
    return request<{ ok: boolean; items: FactionRow[] }>(
      `/api/admin/factions/${id}${query}`,
      {
        method: "DELETE",
        headers: bearer(token),
      },
    );
  },
  /**
   * Sube el emblema (PNG) de una facción. Binario crudo, como las imágenes de las fichas;
   * el servidor valida por contenido (máx. 2 MB en producción) y versiona la URL (`?v=`).
   */
  uploadFactionEmblem(token: string, id: number, file: Blob) {
    return request<{
      faction: FactionRow;
      items: FactionRow[];
      asset: unknown;
    }>(`/api/admin/factions/${id}/image`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
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
      asset: {
        path: string;
        width: number | null;
        height: number | null;
        bytes: number;
        format: string;
        hasAlpha: boolean;
        alphaLost: boolean;
      };
      vtuber: VtuberDetail;
    }>(`/api/admin/vtubers/${id}/image/${kind}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/octet-stream",
      },
      body: file,
    });
  },
  deleteImage(token: string, id: number, kind: UploadKind) {
    return request<{
      ok: true;
      kind: UploadKind;
      slug: string;
      restaurado: string;
      vtuber: VtuberDetail;
    }>(`/api/admin/vtubers/${id}/image/${kind}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
  },
  /** Formulario público de inscripción: deja una solicitud pendiente, no crea la ficha. */
  enviarInscripcion(body: Record<string, unknown>) {
    return request<{ ok: true; estado: "pendiente" | "sin_verificar" }>(
      "/api/inscripciones",
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  /** Paso 1 de la inscripción: manda un código al correo. No dice si ese correo tiene un borrador. */
  pedirCodigoDeInscripcion(email: string, website = "") {
    return request<{ ok: true }>("/api/inscripciones/codigo", {
      method: "POST",
      body: JSON.stringify({ email, website }),
    });
  },
  /** Paso 2: canjea el código por una sesión y trae el borrador que esa persona dejó a medias (o `null`). */
  verificarCodigoDeInscripcion(token: string) {
    return request<{
      ok: true;
      sesion: string;
      borrador: { datos: BorradorDeInscripcion; actualizado: string } | null;
    }>("/api/inscripciones/verificar", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
  /** Guarda lo escrito hasta ahora, atado al correo de la sesión. */
  guardarBorradorDeInscripcion(sesion: string, datos: BorradorDeInscripcion) {
    return request<{ ok: true; actualizado: string }>(
      "/api/inscripciones/borrador",
      { method: "PUT", body: JSON.stringify({ sesion, datos }) },
    );
  },
  /** Formulario público de baja. Mismos términos que la inscripción. */
  enviarBaja(body: Record<string, unknown>) {
    return request<{ ok: true; estado: "sin_verificar" }>("/api/bajas", {
      method: "POST",
      body: JSON.stringify(body),
    });
  },
  /**
   * Sube el avatar (`character`) o el logo de un formulario público: un WebP ya normalizado por el navegador.
   * `credencial` es la `sesion` de la inscripción o el `permiso` de la modificación.
   */
  subirImagenDeSolicitud(
    formulario: FormularioConImagenes,
    credencial: string,
    tipo: "character" | "logo",
    imagen: Blob,
  ) {
    return request<{
      id: string;
      tipo: string;
      ancho: number;
      alto: number;
      size: number;
    }>(`/api/${RUTA_DE_FORMULARIO[formulario]}/imagen?tipo=${tipo}`, {
      method: "POST",
      headers: { "content-type": "image/webp", "x-credencial": credencial },
      body: imagen,
    });
  },
  /** La vista previa de una imagen ya subida (para recuperar un borrador), o `null` si ya no está. */
  async imagenDeSolicitud(
    formulario: FormularioConImagenes,
    credencial: string,
    id: string,
  ): Promise<Blob | null> {
    const respuesta = await fetch(
      `${BASE}/api/${RUTA_DE_FORMULARIO[formulario]}/imagen?id=${encodeURIComponent(id)}`,
      { headers: { "x-credencial": credencial } },
    ).catch(() => null);
    return respuesta?.ok ? respuesta.blob() : null;
  },
  /** Formulario público para pedir cambios en una ficha ya registrada. Mismos términos y misma cola. */
  enviarModificacion(body: Record<string, unknown>) {
    return request<{ ok: true; estado: "pendiente" | "sin_verificar" }>(
      "/api/modificaciones",
      { method: "POST", body: JSON.stringify(body) },
    );
  },
  /** Paso 1 de «actualizar ficha»: manda un código al correo. No dice si el correo tiene fichas. */
  pedirCodigoDeModificacion(email: string, website = "") {
    return request<{ ok: true }>("/api/modificaciones/codigo", {
      method: "POST",
      body: JSON.stringify({ email, website }),
    });
  },
  /** Paso 2: canjea el código por un permiso de envío y trae las fichas inscritas con ese correo. */
  verificarCodigoDeModificacion(token: string) {
    return request<{
      ok: true;
      permiso: string;
      fichas: Array<{ slug: string; name: string }>;
    }>("/api/modificaciones/verificar", {
      method: "POST",
      body: JSON.stringify({ token }),
    });
  },
  /** «Mi ficha»: el estado de la ficha de quien llega con su enlace mágico (el token no se gasta). */
  miFicha(token: string, slug?: string) {
    return request<RespuestaMiFicha>("/api/mi-ficha", {
      method: "POST",
      body: JSON.stringify({ token, slug }),
    });
  },
  /** Gasta un punto de habilidad (`subir`) o de stat (`subir-stat`, `clave` = slug), o devuelve los repartidos de esa bolsa. */
  repartirPuntos(
    token: string,
    slug: string,
    accion: "subir" | "reiniciar" | "subir-stat" | "reiniciar-stats",
    clave?: string,
  ) {
    return request<{ ok: true; ficha: VistaMiFicha }>("/api/mi-ficha/puntos", {
      method: "POST",
      body: JSON.stringify({ token, slug, accion, clave }),
    });
  },
  /** Código de un uso para vincular la cuenta de Minecraft (`codigo`) o soltar el vínculo (`desvincular`). */
  minecraftDeMiFicha(
    token: string,
    slug: string,
    accion: "codigo" | "desvincular",
  ) {
    return request<{
      ok: true;
      ficha: VistaMiFicha;
      codigo?: { codigo: string; expira: string };
    }>("/api/mi-ficha/minecraft", {
      method: "POST",
      body: JSON.stringify({ token, slug, accion }),
    });
  },
  /** Reclama el grado de carta de una misión de grado completada (opcional: la persona decide). */
  reclamarGradoDeMision(token: string, slug: string, mision: string) {
    return request<{ ok: true; grado: string; ficha: VistaMiFicha }>(
      "/api/mi-ficha/misiones",
      {
        method: "POST",
        body: JSON.stringify({ token, slug, accion: "reclamar-grado", mision }),
      },
    );
  },
  /** Manda el enlace mágico a ese correo si tiene fichas; responde igual para cualquiera. */
  pedirEnlaceDeMiFicha(email: string) {
    return request<{ ok: true }>("/api/mi-ficha/enlace", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
  },
  /** Mantenedor: los grados reclamados con misiones de Minecraft (para revisarlos o revocarlos). */
  reclamosDeMisiones(token: string) {
    return request<{ items: ReclamoDeMision[] }>("/api/admin/misiones/reclamos", {
      headers: bearer(token),
    });
  },
  /** Mantenedor: revoca un reclamo y devuelve la carta al grado anterior (si aún lleva el reclamado). */
  revocarReclamoDeMision(token: string, vtuberId: number, mision: string) {
    return request<{ ok: true; cartaModificada: boolean }>(
      `/api/admin/misiones/reclamos/${vtuberId}/${encodeURIComponent(mision)}/revocar`,
      { method: "POST", headers: bearer(token) },
    );
  },
  /** Rechazos de los formularios públicos en los últimos días (sin correos ni contenido). */
  rechazosDeSolicitudes(token: string, dias = 7) {
    return request<ResumenRechazos>(
      `/api/admin/solicitudes/rechazos?dias=${dias}`,
      { headers: bearer(token) },
    );
  },
  solicitudes(
    token: string,
    estado: string = "pendiente",
    tipo?: "inscripcion" | "baja" | "modificacion",
  ) {
    const query = new URLSearchParams({ estado, ...(tipo ? { tipo } : {}) });
    return request<{
      items: SolicitudAdmin[];
      pendientes: { inscripcion: number; baja: number; modificacion: number };
    }>(`/api/admin/solicitudes?${query}`, {
      headers: bearer(token),
    });
  },
  resolverSolicitud(
    token: string,
    id: number,
    accion: "aprobar" | "rechazar" | "procesar",
    nota = "",
    fichaSlug?: string,
  ) {
    return request<{
      solicitud: SolicitudAdmin;
      /** Solo al aprobar: qué imágenes subidas pasaron a la ficha y cuáles no se pudieron copiar. */
      imagenes?: {
        aplicadas: string[];
        fallidas: Array<{ tipo: string; error: string }>;
      };
    }>(
      `/api/admin/solicitudes/${id}/resolver`,
      {
        method: "POST",
        headers: bearer(token),
        body: JSON.stringify({
          accion,
          nota,
          ...(fichaSlug ? { fichaSlug } : {}),
        }),
      },
    );
  },
  /** Las imágenes que la persona subió con el formulario (sin bytes). */
  imagenesDeSolicitud(token: string, id: number) {
    return request<{
      imagenes: Array<{
        id: string;
        tipo: "character" | "logo";
        ancho: number;
        alto: number;
        size: number;
      }>;
    }>(`/api/admin/solicitudes/${id}/imagenes`, { headers: bearer(token) });
  },
  /** Los bytes de una de esas imágenes (el `<img>` no puede mandar la cabecera de sesión), o `null`. */
  async imagenSubidaDeSolicitud(
    token: string,
    id: number,
    tipo: string,
  ): Promise<Blob | null> {
    const respuesta = await fetch(
      `${BASE}/api/admin/solicitudes/${id}/imagen/${tipo}`,
      { headers: bearer(token) },
    ).catch(() => null);
    return respuesta?.ok ? respuesta.blob() : null;
  },
  /** Qué pasaría al aprobar (sin escribir nada). `ficha` elige a mano la ficha de una modificación. */
  vistaPreviaSolicitud(token: string, id: number, ficha?: string) {
    const query = ficha ? `?${new URLSearchParams({ ficha })}` : "";
    return request<VistaPreviaSolicitud>(
      `/api/admin/solicitudes/${id}/vista-previa${query}`,
      { headers: bearer(token) },
    );
  },
  adminStats(token: string) {
    return request<AdminStats>("/api/admin/stats", {
      headers: { authorization: `Bearer ${token}` },
    });
  },
  audit(token: string) {
    return request<{
      items: Array<{
        id: number;
        actor: string;
        entity: string;
        entityId: number | null;
        action: string;
        payload: string | null;
        createdAt: string;
      }>;
    }>("/api/admin/audit", { headers: { authorization: `Bearer ${token}` } });
  },
};
