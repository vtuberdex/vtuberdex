/**
 * Completitud de una carta: la lista de lo que le falta, con el paso del asistente
 * donde se arregla cada cosa.
 *
 * Una sola definición para tres usos: el checklist del último paso, el indicador de
 * cada paso del asistente y la insignia de % de la lista lateral. La lista lateral solo
 * tiene el resumen de la carta (no el detalle completo), así que los ítems "núcleo" se
 * pueden calcular desde cualquiera de las dos fuentes; perfil y habilidades quedan como
 * RECOMENDADOS: se muestran en el checklist pero no cuentan para el %, porque hay
 * VTubers que de verdad no tienen ficha personal ni habilidades.
 */
import type { VtuberCard } from '@/lib/types';

export type StepId = 'identidad' | 'imagenes' | 'colores' | 'historia' | 'atributos' | 'habilidades' | 'redes' | 'revision';

export interface CheckItem {
  id: string;
  label: string;
  ok: boolean;
  step: StepId;
  /** Qué hacer si falta. */
  hint: string;
  /** Recomendado: se muestra pero no cuenta para el porcentaje. */
  optional?: boolean;
}

export interface CompletenessInput {
  name: string;
  slug: string;
  character: boolean;
  logo: boolean;
  themeColor: boolean;
  factions: number;
  phrase: boolean;
  cardText: boolean;
  stats: number;
  socials: number;
  profile?: number;
  skills?: number;
}

export function checklist(input: CompletenessInput): CheckItem[] {
  const items: CheckItem[] = [
    { id: 'nombre', label: 'Nombre y dirección de la página', ok: Boolean(input.name.trim() && input.slug.trim()), step: 'identidad', hint: 'Escribe el nombre de la carta.' },
    { id: 'personaje', label: 'Imagen del personaje', ok: input.character, step: 'imagenes', hint: 'Sin personaje la carta se ve vacía.' },
    { id: 'logo', label: 'Logo', ok: input.logo, step: 'imagenes', hint: 'El logo va en la parte superior de la carta.' },
    { id: 'color', label: 'Color de marca', ok: input.themeColor, step: 'colores', hint: 'Elige el color que representa al VTuber.' },
    { id: 'facciones', label: 'Al menos una facción', ok: input.factions > 0, step: 'colores', hint: 'Elige hasta 2 facciones.' },
    { id: 'frase', label: 'Frase de presentación', ok: input.phrase, step: 'historia', hint: 'Una línea que lo describa.' },
    { id: 'historia', label: 'Historia (lore)', ok: input.cardText, step: 'historia', hint: 'Cuenta quién es en unas líneas.' },
    { id: 'atributos', label: 'Atributos', ok: input.stats > 0, step: 'atributos', hint: 'Usa «Añadir atributos estándar».' },
    { id: 'redes', label: 'Redes sociales', ok: input.socials > 0, step: 'redes', hint: 'Añade al menos un enlace.' },
  ];
  if (input.profile !== undefined) {
    items.push({ id: 'perfil', label: 'Datos de perfil (recomendado)', ok: input.profile > 0, step: 'historia', hint: 'Cumpleaños, altura…', optional: true });
  }
  if (input.skills !== undefined) {
    items.push({ id: 'habilidades', label: 'Habilidades (recomendado)', ok: input.skills > 0, step: 'habilidades', hint: 'Activas, pasivas o definitiva.', optional: true });
  }
  return items;
}

export function percent(items: CheckItem[]): number {
  const core = items.filter((item) => !item.optional);
  if (core.length === 0) return 0;
  return Math.round((core.filter((item) => item.ok).length / core.length) * 100);
}

/** Porcentaje desde el resumen de la lista lateral (sin perfil ni habilidades). */
export function percentOfCard(card: VtuberCard): number {
  return percent(
    checklist({
      name: card.name,
      slug: card.slug,
      character: Boolean(card.images.character),
      logo: Boolean(card.images.logo),
      themeColor: Boolean(card.themeColor),
      factions: card.factions.length,
      phrase: Boolean(card.phrase),
      cardText: Boolean(card.cardText),
      stats: card.statsPreview.length,
      socials: card.socialCount,
    }),
  );
}

/** Estado de un paso: `null` = no tiene requisitos (revisión). */
export function stepComplete(items: CheckItem[], step: StepId): boolean | null {
  const own = items.filter((item) => item.step === step && !item.optional);
  if (own.length === 0) return step === 'revision' ? percent(items) === 100 : null;
  return own.every((item) => item.ok);
}
