/**
 * Validación de payloads del mantenedor y de la query de búsqueda (zod).
 * Un único lugar define qué es un dato válido, reutilizado por rutas y tests.
 */
import { z } from 'zod';

import { TODOS_LOS_GRADOS } from './premium.mjs';

export const listQuerySchema = z.object({
  q: z.string().max(120).optional().default(''),
  countries: z.string().max(300).optional().default(''),
  languages: z.string().max(60).optional().default(''),
  groups: z.string().max(300).optional().default(''),
  artists: z.string().max(300).optional().default(''),
  factions: z.string().max(300).optional().default(''),
  sort: z.enum(['dex', 'dex-desc', 'name', 'power']).optional().default('dex'),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(24),
  language: z.string().max(10).optional(),
  /** Solo las cartas premium (gradeadas). `1` o `true`; cualquier otra cosa es un 400. */
  premium: z.enum(['1', 'true']).optional(),
  facet: z.enum(['all', 'countries', 'groups', 'artists', 'factions', 'languages']).optional(),
});

const countrySlug = z.string().trim().min(1).max(60);
const optionalText = (max) => z.string().trim().max(max).optional().nullable();

/** URL de una red social: solo http(s). Un `javascript:` en un enlace de la ficha sería XSS. */
const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((valor) => /^https?:\/\/\S+$/i.test(valor), 'debe ser una URL http(s)');

const statSchema = z.object({
  label: z.string().trim().min(1).max(40),
  slug: z.string().trim().max(40).optional().nullable(),
  value: z.number().int().min(0).max(1_000_000).optional().nullable(),
  valueText: optionalText(60),
  max: z.number().int().min(0).max(1_000_000).optional().nullable(),
});

const skillSchema = z.object({
  category: z.enum(['active', 'passive', 'ultimate', 'other']),
  section: optionalText(80),
  type: optionalText(80),
  name: optionalText(160),
  effect: optionalText(2000),
  // Emblemas de facción de la habilidad: solo se conservan al editar, no se crean a mano.
  factions: z
    .array(z.object({ src: z.string().max(300).nullable().optional(), name: z.string().max(80).nullable().optional() }))
    .max(8)
    .optional(),
});

const socialSchema = z.object({
  platform: z.string().trim().min(1).max(40),
  label: optionalText(80),
  url: httpUrl,
  icon: optionalText(300),
});

/** Máximo de facciones por VTuber. Espejo de `MAX_FACCIONES` (mutations.mjs). */
const MAX_FACCIONES = 2;

const FECHA = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fecha AAAA-MM-DD');

/**
 * Datos premium de una ficha. `null` la devuelve a carta normal. Las fechas son opcionales:
 * sin ellas el alta y el último ascenso son «hoy» (ver `aplicarPremium` y `sellarPremium`).
 */
const premiumSchema = z
  .object({
    grade: z.enum(TODOS_LOS_GRADOS),
    since: FECHA.optional(),
    gradedAt: FECHA.optional(),
  })
  .nullable();

export const vtuberUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  /** La URL de la ficha (`/v/<slug>`). Se normaliza a ASCII minúscula con guiones al guardar. */
  slug: z.string().trim().min(1).max(80).optional(),
  /** Número de la dex: un entero LIBRE, o `'end'` para el siguiente al último. */
  dexNumber: z.union([z.literal('end'), z.number().int().min(1).max(99_999)]).optional(),
  phrase: optionalText(600),
  /** Lore / historia de la carta. */
  cardText: optionalText(4000),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color hexadecimal #rrggbb')
    .optional()
    .nullable(),
  secondaryColor: optionalText(80),
  birthday: optionalText(80),
  height: optionalText(40),
  hashtag: optionalText(120),
  favoriteColor: optionalText(80),
  level: z.number().int().min(0).max(1000).optional().nullable(),
  status: z.enum(['published', 'draft', 'hidden']).optional(),
  countries: z.array(countrySlug).max(6).optional(),
  languages: z.array(z.string().trim().min(2).max(8)).max(6).optional(),
  groups: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  artists: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  /** Slugs (o etiquetas) de facciones EXISTENTES; máximo dos. */
  factions: z.array(z.string().trim().min(1).max(80)).max(MAX_FACCIONES, `máximo ${MAX_FACCIONES} facciones`).optional(),
  profile: z
    .array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(600) }))
    .max(40)
    .optional(),
  stats: z.array(statSchema).max(30).optional(),
  skills: z.array(skillSchema).max(30).optional(),
  socials: z.array(socialSchema).max(20).optional(),
  /** Carta premium: grado de la escala 8…BL, o `null` para quitarla. */
  premium: premiumSchema.optional(),
});

/** Crear una ficha: lo mismo que editarla, pero el nombre es obligatorio. */
export const vtuberCreateSchema = vtuberUpdateSchema.extend({ name: z.string().trim().min(1).max(160) });

export const factionCreateSchema = z.object({
  label: z.string().trim().min(1).max(60),
  icon: z.string().trim().max(300).optional().nullable(),
});

export const factionUpdateSchema = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  icon: z.string().trim().max(300).optional().nullable(),
});

/** Listado del mantenedor: incluye borradores y ocultos, que la API pública no devuelve. */
export const adminListQuerySchema = z.object({
  q: z.string().max(120).optional().default(''),
  status: z.enum(['all', 'published', 'draft', 'hidden']).optional().default('all'),
  /** Solo las cartas premium: la pestaña «Premium» del mantenedor lista las que ya existen. */
  premium: z.enum(['1', 'true']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  perPage: z.coerce.number().int().min(1).max(100).optional().default(40),
});

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(4).max(200),
});

export const bulkStatusSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  status: z.enum(['published', 'draft', 'hidden']),
});

/** Convierte el error de zod en un mensaje corto para la API. */
export function formatIssues(error) {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}
