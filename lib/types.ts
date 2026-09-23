/** Tipos compartidos con la API (contrato único para toda la app). */

export interface CountryRef {
  slug: string;
  name: string;
  flag: string | null;
}

export interface VtuberImages {
  /**
   * El PERSONAJE recortado y normalizado al lienzo de carta (720x1008, 1.4).
   * Es la base de la carta 3D y del listado: al venir ya en la proporción
   * correcta, estirarla a un marco no la deforma.
   */
  character: string | null;
  /**
   * `card`, `thumb` y `radar` siguen en el contrato porque la API los devuelve
   * (el esquema de la base conserva las filas de `asset`), pero YA NO SE
   * PUBLICAN: sus carpetas se eliminaron por no aportar nada que el front use.
   * `character ?? card` queda como respaldo por si alguna ficha llegara sin
   * personaje; hoy los 785 lo tienen.
   */
  card: string | null;
  thumb: string | null;
  logo: string | null;
  radar: string | null;
  /**
   * FONDO opcional de la carta 3D, pintado POR DETRÁS del personaje.
   *
   * Es `null` en la inmensa mayoría de fichas: el scraper no lo produce, solo
   * existe si alguien lo sube desde el mantenedor. La carta 3D dibuja esta capa
   * únicamente cuando hay imagen, así que su ausencia no cambia nada de lo que se
   * veía antes de que este tipo existiera.
   */
  background: string | null;
}

/**
 * Tipos de imagen que el mantenedor puede subir o reemplazar. Debe coincidir con
 * las claves de `UPLOADABLE_KINDS` del servidor (más `background`, que en el
 * servidor vive en `UPLOADABLE_KINDS` y en la ruta de producción se valida aparte
 * porque allí no hay `sharp`).
 *
 * `character`, `logo`, `faction` y `background` son los que la app muestra;
 * `card`/`thumb` sobreviven aquí solo por compatibilidad con el esquema del
 * servidor.
 */
export type UploadKind = 'character' | 'card' | 'thumb' | 'logo' | 'radar' | 'background';

export interface VtuberCard {
  id: number;
  dexNumber: number;
  slug: string;
  name: string;
  phrase: string | null;
  /** Texto personalizado impreso en la carta, extraído por OCR. */
  cardText: string | null;
  /** Confianza del OCR (0-100); permite mostrar la fiabilidad del texto. */
  cardTextConfidence: number | null;
  themeColor: string | null;
  secondaryColor: string | null;
  palette: string[];
  level: number | null;
  powerScore: number | null;
  hasDetail: boolean;
  status: 'published' | 'draft' | 'hidden';
  birthday: string | null;
  height: string | null;
  hashtag: string | null;
  favoriteColor: string | null;
  countries: CountryRef[];
  groups: string[];
  artists: string[];
  factions: string[];
  /** Facciones con su emblema; la carta lo superpone como holograma. */
  factionIcons?: Array<{ label: string | null; icon: string | null }>;
  languages: string[];
  /** Muestra de stats (máx. 5) para la barra segmentada de la carta. */
  statsPreview: number[];
  /** Cantidad de redes enlazadas, mostrada en el pie de la carta. */
  socialCount: number;
  images: VtuberImages;
}

export interface ProfileField {
  label: string;
  value: string;
}

export interface StatRow {
  label: string;
  slug: string;
  value: number | null;
  valueText: string | null;
  max: number | null;
  position: number;
}

export interface SkillRow {
  category: 'active' | 'passive' | 'ultimate' | 'other';
  section: string | null;
  type: string | null;
  name: string | null;
  effect: string | null;
  effectHtml: string | null;
  factions: Array<{ src: string | null; name: string | null }>;
  position: number;
}

export interface SocialRow {
  platform: string;
  label: string | null;
  url: string;
  icon: string | null;
}

export interface AssetRow {
  kind: 'character' | 'card' | 'thumb' | 'logo' | 'radar' | 'background';
  path: string;
  sourceUrl: string | null;
  width: number | null;
  height: number | null;
  bytes: number | null;
}

export interface VtuberDetail extends VtuberCard {
  profile: ProfileField[];
  stats: StatRow[];
  skills: SkillRow[];
  socials: SocialRow[];
  assets: AssetRow[];
  experience: { current: number | null; max: number | null } | null;
}

export interface FacetBucket {
  /** Identificador para filtrar (los idiomas usan el código: 'es', 'ja'…). */
  slug?: string;
  /** Código de idioma; las facetas de idiomas lo traen en lugar de `slug`. */
  code?: string;
  name: string;
  flag?: string | null;
  count: number;
}

/** Valor con el que se filtra una faceta (idiomas: `code`; el resto: `slug`). */
export function facetValue(bucket: FacetBucket): string {
  return bucket.slug ?? bucket.code ?? bucket.name;
}

export interface Facets {
  countries: FacetBucket[];
  languages: FacetBucket[];
  groups: FacetBucket[];
  artists: FacetBucket[];
  factions: FacetBucket[];
  totals: { total: number; withDetail: number; themes: number };
}

export interface ApiListResponse {
  items: VtuberCard[];
  total: number;
  page: number;
  perPage: number;
  pageCount: number;
  facets: Facets | null;
}

export interface Neighbors {
  /** Vecinos de dex para navegar sin volver al catálogo. */
  prev: { dexNumber: number; slug: string; name: string } | null;
  next: { dexNumber: number; slug: string; name: string } | null;
}

export type SortKey = 'dex' | 'dex-desc' | 'name' | 'power';

export interface SearchParams {
  q: string;
  countries: string[];
  languages: string[];
  groups: string[];
  artists: string[];
  factions: string[];
  language: string | null;
  sort: SortKey;
  page: number;
  perPage: number;
}
