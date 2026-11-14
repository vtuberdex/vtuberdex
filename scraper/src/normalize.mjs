// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Normalización de países, idiomas y texto.
 *
 * El sitio original mezcla variantes del mismo país ("Mexico" / "México" /
 * "Argetina"), listas separadas por coma ("España, Canarias") y sufijos basura
 * ("Perú´"). Todo eso se resuelve aquí, en un único lugar, para que el resto del
 * pipeline trabaje con claves estables (slug ASCII).
 */

// Slugs que aparecen en el catálogo Y como destino de varios alias: una sola
// definición para que un typo en una de las copias no cree un país fantasma.
const COREA_DEL_SUR = "corea-del-sur";
const ESTADOS_UNIDOS = "estados-unidos";
const REPUBLICA_DOMINICANA = "republica-dominicana";
const REINO_UNIDO = "reino-unido";

/** Catálogo de países conocido, derivado del propio mapeo del sitio + extras. */
export const COUNTRIES = [
  {
    slug: "argentina",
    es: "Argentina",
    en: "Argentina",
    flag: "🇦🇷",
    lang: "es",
  },
  { slug: "bolivia", es: "Bolivia", en: "Bolivia", flag: "🇧🇴", lang: "es" },
  {
    slug: "canarias",
    es: "Canarias",
    en: "Canary Islands",
    flag: "🇮🇨",
    lang: "es",
  },
  { slug: "cataluna", es: "Cataluña", en: "Catalonia", flag: "🏴", lang: "es" },
  { slug: "chile", es: "Chile", en: "Chile", flag: "🇨🇱", lang: "es" },
  { slug: "colombia", es: "Colombia", en: "Colombia", flag: "🇨🇴", lang: "es" },
  {
    slug: COREA_DEL_SUR,
    es: "Corea del Sur",
    en: "South Korea",
    flag: "🇰🇷",
    lang: "ko",
  },
  {
    slug: "costa-rica",
    es: "Costa Rica",
    en: "Costa Rica",
    flag: "🇨🇷",
    lang: "es",
  },
  { slug: "cuba", es: "Cuba", en: "Cuba", flag: "🇨🇺", lang: "es" },
  { slug: "ecuador", es: "Ecuador", en: "Ecuador", flag: "🇪🇨", lang: "es" },
  {
    slug: "el-salvador",
    es: "El Salvador",
    en: "El Salvador",
    flag: "🇸🇻",
    lang: "es",
  },
  { slug: "espana", es: "España", en: "Spain", flag: "🇪🇸", lang: "es" },
  {
    slug: ESTADOS_UNIDOS,
    es: "Estados Unidos",
    en: "United States",
    flag: "🇺🇸",
    lang: "en",
  },
  { slug: "francia", es: "Francia", en: "France", flag: "🇫🇷", lang: "fr" },
  { slug: "galicia", es: "Galicia", en: "Galicia", flag: "🏴", lang: "es" },
  {
    slug: "guatemala",
    es: "Guatemala",
    en: "Guatemala",
    flag: "🇬🇹",
    lang: "es",
  },
  { slug: "holanda", es: "Holanda", en: "Netherlands", flag: "🇳🇱", lang: "nl" },
  { slug: "honduras", es: "Honduras", en: "Honduras", flag: "🇭🇳", lang: "es" },
  { slug: "italia", es: "Italia", en: "Italy", flag: "🇮🇹", lang: "it" },
  { slug: "japon", es: "Japón", en: "Japan", flag: "🇯🇵", lang: "ja" },
  { slug: "mexico", es: "México", en: "Mexico", flag: "🇲🇽", lang: "es" },
  {
    slug: "nicaragua",
    es: "Nicaragua",
    en: "Nicaragua",
    flag: "🇳🇮",
    lang: "es",
  },
  { slug: "panama", es: "Panamá", en: "Panama", flag: "🇵🇦", lang: "es" },
  { slug: "paraguay", es: "Paraguay", en: "Paraguay", flag: "🇵🇾", lang: "es" },
  { slug: "peru", es: "Perú", en: "Peru", flag: "🇵🇪", lang: "es" },
  {
    slug: "puerto-rico",
    es: "Puerto Rico",
    en: "Puerto Rico",
    flag: "🇵🇷",
    lang: "es",
  },
  {
    slug: REPUBLICA_DOMINICANA,
    es: "República Dominicana",
    en: "Dominican Republic",
    flag: "🇩🇴",
    lang: "es",
  },
  { slug: "rusia", es: "Rusia", en: "Russia", flag: "🇷🇺", lang: "ru" },
  { slug: "uruguay", es: "Uruguay", en: "Uruguay", flag: "🇺🇾", lang: "es" },
  {
    slug: "venezuela",
    es: "Venezuela",
    en: "Venezuela",
    flag: "🇻🇪",
    lang: "es",
  },
  {
    slug: "inglaterra",
    es: "Inglaterra",
    en: "England",
    flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿",
    lang: "en",
  },
  {
    slug: REINO_UNIDO,
    es: "Reino Unido",
    en: "United Kingdom",
    flag: "🇬🇧",
    lang: "en",
  },
  { slug: "canada", es: "Canadá", en: "Canada", flag: "🇨🇦", lang: "en" },
  {
    slug: "australia",
    es: "Australia",
    en: "Australia",
    flag: "🇦🇺",
    lang: "en",
  },
  { slug: "irlanda", es: "Irlanda", en: "Ireland", flag: "🇮🇪", lang: "en" },
  {
    slug: "nueva-zelanda",
    es: "Nueva Zelanda",
    en: "New Zealand",
    flag: "🇳🇿",
    lang: "en",
  },
];

export const COUNTRY_BY_SLUG = new Map(COUNTRIES.map((c) => [c.slug, c]));

/** Alias explícitos vistos en el sitio (typos, traducciones, variantes). */
const ALIASES = new Map(
  Object.entries({
    argetina: "argentina",
    argelia: "argentina",
    mexico: "mexico",
    peru: "peru",
    "corea del sur": COREA_DEL_SUR,
    "republica dominicana": REPUBLICA_DOMINICANA,
    "estados unidos de america": ESTADOS_UNIDOS,
    usa: ESTADOS_UNIDOS,
    us: ESTADOS_UNIDOS,
    eeuu: ESTADOS_UNIDOS,
    uk: REINO_UNIDO,
    "reino unido": REINO_UNIDO,
    inglaterra: "inglaterra",
    "nueva zelanda": "nueva-zelanda",
    holanda: "holanda",
    "paises bajos": "holanda",
    "el salvador": "el-salvador",
    "costa rica": "costa-rica",
    "puerto rico": "puerto-rico",
    "republica dominicana ": REPUBLICA_DOMINICANA,
    cataluna: "cataluna",
    espana: "espana",
    japon: "japon",
    panama: "panama",
    canada: "canada",
    "corea del sur ": COREA_DEL_SUR,
  }),
);

/** minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function slugify(value) {
  return (
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      // Tras el paso anterior no puede haber dos guiones seguidos, así que basta
      // con quitar UNO por extremo (y la regex queda lineal, sin `-+$`).
      .replace(/^-|-$/g, "")
  );
}

/** Normalización suave usada para comparar texto (conserva espacios). */
export function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N},\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convierte el `data-pais` del sitio en una lista de países canónicos.
 * "España, Canarias" -> [espana, canarias]; "Perú´" -> [peru]; "Mexico" -> [mexico].
 */
export function parseCountries(rawValue) {
  const parts = String(rawValue ?? "")
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);

  const out = [];
  const seen = new Set();
  for (const part of parts) {
    const canonical = ALIASES.get(part) ?? slugify(part);
    if (!canonical || seen.has(canonical)) {
      continue;
    }
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/** Idiomas deducidos de los países (el sitio no expone un campo de idioma real). */
export function languagesForCountries(countrySlugs) {
  const langs = new Set();
  for (const slug of countrySlugs) {
    const country = COUNTRY_BY_SLUG.get(slug);
    langs.add(country?.lang ?? "es");
  }
  if (langs.size === 0) {
    langs.add("es");
  }
  return [...langs].sort(compararCodigos);
}

/** Orden por unidades de código (el de `<`), no por locale: estable entre máquinas. */
function compararCodigos(a, b) {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/** Listas separadas por coma dentro de un atributo (grupos, artistas). */
export function splitList(rawValue) {
  return String(rawValue ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Extrae el número de dex desde `vtuber16.jpg`, `card16` o `VTuber 16`. */
export function parseDexNumber(...candidates) {
  for (const candidate of candidates) {
    const match = /(\d+)/.exec(String(candidate ?? ""));
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}
