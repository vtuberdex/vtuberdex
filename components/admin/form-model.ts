/**
 * Modelo del formulario del editor: de `VtuberDetail` a estado de formulario y de
 * vuelta a un PATCH con SOLO lo que cambió.
 *
 * POR QUÉ SE COMPARA CONTRA UNA LÍNEA BASE Y NO CAMPO A CAMPO
 * ------------------------------------------------------------
 * Los arrays REEMPLAZAN la lista completa en el servidor, así que reenviar
 * `skills` sin haberlas tocado reescribiría 30 filas (y su `position`) por nada, y
 * un fallo en una lista que el usuario ni abrió bloquearía el guardado. En vez de
 * mantener un «dirty» por campo, la línea base se pasa por el MISMO camino que el
 * formulario actual (`toPayload`) y se envía lo que difiere: normalización
 * (recortes, '' -> null) y comparación comparten una sola definición, así que un
 * campo sin tocar nunca aparece como cambiado por una diferencia de formato.
 */
import type {
  ProfileField,
  SkillInput,
  SocialInput,
  StatInput,
  VtuberCreate,
  VtuberDetail,
  VtuberPatch,
  VtuberStatus,
} from '@/lib/types';

/** Atributo tal como se edita: los números viajan como texto para poder dejarlos vacíos. */
export interface StatForm {
  label: string;
  value: string;
  max: string;
  valueText: string;
  slug: string;
}

export interface SkillForm {
  category: SkillInput['category'];
  section: string;
  type: string;
  name: string;
  effect: string;
  factions: Array<{ src: string | null; name: string | null }>;
}

export interface SocialForm {
  platform: string;
  label: string;
  url: string;
  icon: string;
}

export interface EditorForm {
  name: string;
  slug: string;
  /** Texto del campo numérico; vacío = sin cambio. */
  dexNumber: string;
  /** «Mandar al final»: gana al número escrito y viaja como `'end'`. */
  dexEnd: boolean;
  phrase: string;
  cardText: string;
  themeColor: string;
  secondaryColor: string;
  birthday: string;
  height: string;
  hashtag: string;
  favoriteColor: string;
  level: string;
  status: VtuberStatus;
  countries: string[];
  languages: string[];
  /** Separados por coma. */
  groups: string;
  artists: string;
  factions: string[];
  profile: ProfileField[];
  stats: StatForm[];
  skills: SkillForm[];
  socials: SocialForm[];
}

export const MAX_FACTIONS = 2;
/** Color con el que arranca el formulario cuando la ficha aún no tiene uno. */
export const DEFAULT_THEME = '#5eead4';
const HTTP_URL = /^https?:\/\/\S+$/i;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** Misma normalización que el servidor (ascii minúscula con guiones), para mostrar la vista previa. */
export function slugifyUrl(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function formFromDetail(detail: VtuberDetail): EditorForm {
  return {
    name: detail.name,
    slug: detail.slug,
    dexNumber: String(detail.dexNumber),
    dexEnd: false,
    phrase: detail.phrase ?? '',
    cardText: detail.cardText ?? '',
    themeColor: detail.themeColor ?? DEFAULT_THEME,
    secondaryColor: detail.secondaryColor ?? '',
    birthday: detail.birthday ?? '',
    height: detail.height ?? '',
    hashtag: detail.hashtag ?? '',
    favoriteColor: detail.favoriteColor ?? '',
    level: detail.level === null || detail.level === undefined ? '' : String(detail.level),
    status: detail.status,
    countries: detail.countries.map((country) => country.slug),
    languages: [...detail.languages],
    groups: detail.groups.join(', '),
    artists: detail.artists.join(', '),
    // El slug es lo que acepta el servidor; la etiqueta solo si el detalle no lo trae.
    factions: (detail.factionIcons ?? []).map((faction) => faction.slug ?? faction.label ?? '').filter(Boolean),
    profile: detail.profile.map((field) => ({ label: field.label, value: field.value })),
    stats: detail.stats.map((stat) => ({
      label: stat.label,
      value: stat.value === null ? '' : String(stat.value),
      max: stat.max === null ? '' : String(stat.max),
      valueText: stat.valueText ?? '',
      slug: stat.slug ?? '',
    })),
    skills: detail.skills.map((skill) => ({
      category: skill.category,
      section: skill.section ?? '',
      type: skill.type ?? '',
      name: skill.name ?? '',
      effect: skill.effect ?? '',
      // Se conservan tal cual: no se crean a mano y perderlas borraría los emblemas.
      factions: skill.factions ?? [],
    })),
    socials: detail.socials.map((social) => ({
      platform: social.platform,
      label: social.label ?? '',
      url: social.url,
      icon: social.icon ?? '',
    })),
  };
}

export const emptyStat = (): StatForm => ({ label: '', value: '', max: '', valueText: '', slug: '' });
export const emptySkill = (): SkillForm => ({ category: 'active', section: '', type: '', name: '', effect: '', factions: [] });
export const emptySocial = (): SocialForm => ({ platform: '', label: '', url: '', icon: '' });

const orNull = (value: string): string | null => value.trim() || null;
const splitList = (value: string): string[] =>
  value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

export type PayloadErrors = Partial<Record<keyof VtuberPatch, string>>;

/** Todo el formulario como payload completo, más los errores de validación POR CAMPO. */
export function toPayload(form: EditorForm): { payload: VtuberPatch; errors: PayloadErrors } {
  const errors: PayloadErrors = {};

  if (!form.name.trim()) errors.name = 'El nombre es obligatorio.';
  if (form.slug.trim() && !slugifyUrl(form.slug)) errors.slug = 'La URL necesita letras o números.';
  if (!HEX.test(form.themeColor)) errors.themeColor = 'El color de marca debe ser #rrggbb.';

  let dexNumber: number | 'end' | undefined;
  if (form.dexEnd) dexNumber = 'end';
  else if (form.dexNumber.trim()) {
    const parsed = Number(form.dexNumber);
    if (Number.isInteger(parsed) && parsed >= 1) dexNumber = parsed;
    else errors.dexNumber = 'El número debe ser un entero positivo.';
  }

  let level: number | null = null;
  if (form.level.trim()) {
    const parsed = Number(form.level);
    if (Number.isInteger(parsed) && parsed >= 0) level = parsed;
    else errors.level = 'El nivel debe ser un entero.';
  }

  if (form.factions.length > MAX_FACTIONS) errors.factions = `Máximo ${MAX_FACTIONS} facciones.`;

  const profile: ProfileField[] = [];
  for (const field of form.profile) {
    const label = field.label.trim();
    const value = field.value.trim();
    if (!label && !value) continue;
    if (!label) errors.profile = 'Cada dato del perfil necesita un nombre.';
    else profile.push({ label, value });
  }

  const stats: StatInput[] = [];
  for (const stat of form.stats) {
    const label = stat.label.trim();
    if (!label && !stat.value.trim() && !stat.max.trim() && !stat.valueText.trim()) continue;
    if (!label) {
      errors.stats = 'Cada atributo necesita un nombre.';
      continue;
    }
    const value = stat.value.trim() === '' ? null : Number(stat.value);
    const max = stat.max.trim() === '' ? null : Number(stat.max);
    if ((value !== null && !Number.isInteger(value)) || (max !== null && !Number.isInteger(max))) {
      errors.stats = `El valor y el máximo de «${label}» deben ser enteros.`;
      continue;
    }
    const input: StatInput = { label, value, max, valueText: orNull(stat.valueText) };
    if (stat.slug.trim()) input.slug = stat.slug.trim();
    stats.push(input);
  }

  const skills: SkillInput[] = [];
  for (const skill of form.skills) {
    if (!skill.name.trim() && !skill.effect.trim() && !skill.section.trim() && !skill.type.trim()) continue;
    skills.push({
      category: skill.category,
      section: orNull(skill.section),
      type: orNull(skill.type),
      name: orNull(skill.name),
      effect: orNull(skill.effect),
      factions: skill.factions,
    });
  }

  const socials: SocialInput[] = [];
  for (const social of form.socials) {
    const url = social.url.trim();
    const platform = social.platform.trim();
    if (!url && !platform && !social.label.trim()) continue;
    if (!platform) errors.socials = 'Cada red necesita una plataforma.';
    else if (!HTTP_URL.test(url)) errors.socials = `La URL de «${platform}» debe empezar con http:// o https://.`;
    else socials.push({ platform, label: orNull(social.label), url, icon: orNull(social.icon) });
  }

  const payload: VtuberPatch = {
    name: form.name.trim(),
    slug: slugifyUrl(form.slug),
    phrase: orNull(form.phrase),
    cardText: orNull(form.cardText),
    themeColor: form.themeColor,
    secondaryColor: orNull(form.secondaryColor),
    birthday: orNull(form.birthday),
    height: orNull(form.height),
    hashtag: orNull(form.hashtag),
    favoriteColor: orNull(form.favoriteColor),
    level,
    status: form.status,
    countries: form.countries,
    languages: form.languages,
    groups: splitList(form.groups),
    artists: splitList(form.artists),
    factions: form.factions,
    profile,
    stats,
    skills,
    socials,
  };
  if (dexNumber !== undefined) payload.dexNumber = dexNumber;
  return { payload, errors };
}

/**
 * Solo lo que difiere de la ficha cargada, y los errores de ESOS campos. Un dato
 * heredado inválido (p. ej. una red scrapeada sin http) no bloquea guardar otro campo.
 */
export function buildPatch(detail: VtuberDetail, form: EditorForm): { patch: VtuberPatch; errors: string[] } {
  const baseForm = formFromDetail(detail);
  const base = toPayload(baseForm).payload;
  const { payload, errors } = toPayload(form);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(payload) as Array<keyof VtuberPatch>) {
    if (JSON.stringify(payload[key]) !== JSON.stringify(base[key])) patch[key] = payload[key];
  }
  /**
   * Los errores se miran contra el FORMULARIO crudo, no contra el payload: un elemento
   * inválido (una red sin http, un número escrito mal) no entra al payload, así que
   * comparar payloads lo daría por «sin cambios» y el error se perdería. Un dato heredado
   * inválido que el usuario no tocó sigue sin bloquear el guardado de otros campos.
   */
  const messages: string[] = [];
  for (const key of Object.keys(errors) as Array<keyof PayloadErrors>) {
    const raw = key as unknown as keyof EditorForm;
    const touched = key === 'dexNumber' ? form.dexNumber !== baseForm.dexNumber || form.dexEnd : JSON.stringify(form[raw]) !== JSON.stringify(baseForm[raw]);
    if (touched && errors[key]) messages.push(errors[key] as string);
  }
  return { patch: patch as VtuberPatch, errors: messages };
}

/** Formulario vacío de una carta nueva: nace «al final» de la dex y en borrador. */
export function emptyForm(): EditorForm {
  return {
    name: '',
    slug: '',
    dexNumber: '',
    dexEnd: true,
    phrase: '',
    cardText: '',
    themeColor: DEFAULT_THEME,
    secondaryColor: '',
    birthday: '',
    height: '',
    hashtag: '',
    favoriteColor: '',
    level: '',
    status: 'draft',
    countries: [],
    languages: [],
    groups: '',
    artists: '',
    factions: [],
    profile: [],
    stats: [],
    skills: [],
    socials: [],
  };
}

/** Cuerpo del POST de una carta nueva: solo la identidad (lo demás se guarda con un PATCH por paso). */
export function createBody(form: EditorForm): { body: VtuberCreate | null; problem: string | null } {
  const name = form.name.trim();
  if (!name) return { body: null, problem: 'Escribe un nombre para continuar.' };
  const body: VtuberCreate = { name };
  const slug = slugifyUrl(form.slug);
  if (slug) body.slug = slug;
  if (!form.dexEnd && form.dexNumber.trim()) {
    const parsed = Number(form.dexNumber);
    if (!Number.isInteger(parsed) || parsed < 1) return { body: null, problem: 'El número debe ser un entero positivo.' };
    body.dexNumber = parsed;
  }
  if (form.countries.length > 0) body.countries = form.countries;
  return { body, problem: null };
}
