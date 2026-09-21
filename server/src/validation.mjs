/**
 * Validación de payloads del mantenedor y de la query de búsqueda (zod).
 * Un único lugar define qué es un dato válido, reutilizado por rutas y tests.
 */
import { z } from 'zod';

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
  facet: z.enum(['all', 'countries', 'groups', 'artists', 'factions', 'languages']).optional(),
});

const countrySlug = z.string().trim().min(1).max(60);
const optionalText = (max) => z.string().trim().max(max).optional().nullable();

export const vtuberUpdateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  phrase: optionalText(600),
  themeColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color hexadecimal #rrggbb')
    .optional()
    .nullable(),
  birthday: optionalText(80),
  height: optionalText(40),
  hashtag: optionalText(120),
  favoriteColor: optionalText(80),
  status: z.enum(['published', 'draft', 'hidden']).optional(),
  countries: z.array(countrySlug).max(6).optional(),
  languages: z.array(z.string().trim().min(2).max(8)).max(6).optional(),
  groups: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  artists: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  factions: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  profile: z
    .array(z.object({ label: z.string().trim().min(1).max(80), value: z.string().trim().max(600) }))
    .max(40)
    .optional(),
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
