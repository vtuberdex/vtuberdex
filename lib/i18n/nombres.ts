/**
 * Nombres de países, idiomas y etiquetas de ficha en el idioma activo.
 *
 * Lo que viene de la base está en español (el catálogo es de VTubers hispanohablantes). Se
 * traduce lo que es un conjunto CERRADO y conocido; el texto libre (frases, historias, valores
 * de la ficha) se queda como lo escribió su dueño.
 *
 *   · Países: `Intl.DisplayNames` con el código ISO que sale de la BANDERA (los emoji de bandera
 *     son dos letras regionales: `🇨🇱` = C+L). Las banderas sin código (Cataluña, Canarias) o un
 *     país sin bandera caen al nombre de la base.
 *   · Idiomas: la base ya guarda el código ISO (`es`, `ja`…).
 *   · Etiquetas de la ficha personal: el scraper dejó variantes con errata (`Pais`, `Hashtag arte`,
 *     `Comida que detestas`); se normalizan y se llevan a una clave.
 */
import { BCP47, type Locale } from './locales';
import { traducir, type Clave } from './mensajes';

const displayNames = new Map<string, Intl.DisplayNames | null>();
function nombresDe(locale: Locale, tipo: 'region' | 'language'): Intl.DisplayNames | null {
  const clave = `${locale}:${tipo}`;
  if (!displayNames.has(clave)) {
    try {
      displayNames.set(clave, new Intl.DisplayNames([BCP47[locale]], { type: tipo }));
    } catch {
      displayNames.set(clave, null);
    }
  }
  return displayNames.get(clave) ?? null;
}

/** `🇨🇱` → `CL`; cualquier otra cosa → `null`. */
export function isoDeBandera(bandera: string | null | undefined): string | null {
  const simbolos = [...(bandera ?? '').trim()];
  if (simbolos.length !== 2) return null;
  const letras = simbolos.map((s) => (s.codePointAt(0) ?? 0) - 0x1f1e6);
  if (letras.some((l) => l < 0 || l > 25)) return null;
  return letras.map((l) => String.fromCharCode(65 + l)).join('');
}

export function nombreDePais(locale: Locale, pais: { name: string; flag?: string | null }): string {
  if (locale === 'es') return pais.name;
  const iso = isoDeBandera(pais.flag);
  if (!iso) return pais.name;
  try {
    return nombresDe(locale, 'region')?.of(iso) ?? pais.name;
  } catch {
    return pais.name;
  }
}

export function nombreDeIdioma(locale: Locale, codigo: string, respaldo: string): string {
  if (locale === 'es') return respaldo;
  try {
    return nombresDe(locale, 'language')?.of(codigo) ?? respaldo;
  } catch {
    return respaldo;
  }
}

const sinTildes = (texto: string): string =>
  texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

const CLAVE_DE_ETIQUETA: Record<string, Clave> = {
  'cumpleanos': 'perfil.cumpleanos',
  'altura': 'perfil.altura',
  'modelo': 'perfil.modelo',
  'signo': 'perfil.signo',
  'signo zodiacal': 'perfil.signo',
  'pais': 'perfil.pais',
  'hashtag': 'perfil.hashtag',
  'hashtag arte': 'perfil.hashtagArte',
  'hashtag de arte': 'perfil.hashtagArte',
  'color favorito': 'perfil.colorFavorito',
  'videojuego favorito': 'perfil.videojuegoFavorito',
  'serie favorita': 'perfil.serieFavorita',
  'anime favorito': 'perfil.animeFavorito',
  'animal favorito': 'perfil.animalFavorito',
  'comida favorita': 'perfil.comidaFavorita',
  'comida que te desagrada': 'perfil.comidaOdiada',
  'comida que detestas': 'perfil.comidaOdiada',
  'musica favorita': 'perfil.musicaFavorita',
  'gustos musicales': 'perfil.musicaFavorita',
};

/** Etiqueta de la ficha personal; si no es una conocida, tal cual viene. En español no se toca. */
export function etiquetaDePerfil(locale: Locale, etiqueta: string): string {
  if (locale === 'es') return etiqueta;
  const clave = CLAVE_DE_ETIQUETA[sinTildes(etiqueta)];
  return clave ? traducir(locale, clave) : etiqueta;
}

const STATS_CONOCIDOS = new Set(['speed', 'mp', 'magicDefense', 'magicAttack', 'level', 'hp', 'exp', 'evasion', 'defense', 'critic', 'attack', 'accuracy', 'luck']);

export function etiquetaDeStat(locale: Locale, slug: string, etiqueta: string): string {
  if (locale === 'es' || !STATS_CONOCIDOS.has(slug)) return etiqueta;
  return traducir(locale, `stat.${slug}` as Clave);
}

const TIPOS_DE_HABILIDAD = new Set(['soporte', 'ofensivo', 'defensivo', 'pasivo', 'activo', 'ultimate']);

export function tipoDeHabilidad(locale: Locale, tipo: string): string {
  if (locale === 'es') return tipo;
  const clave = sinTildes(tipo);
  return TIPOS_DE_HABILIDAD.has(clave) ? traducir(locale, `habilidad.tipo.${clave}` as Clave) : tipo;
}
