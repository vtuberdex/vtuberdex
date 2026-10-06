/**
 * `/niveles` — explica cómo funcionan la experiencia, los niveles, la EXP total y los puntos de habilidad.
 * Texto trilingüe en `lib/i18n/textos/niveles.ts`; los metadatos del servidor quedan en español, como en el resto
 * de páginas informativas.
 */
import type { Metadata } from 'next';

import { NivelesContenido } from '@/components/niveles/niveles-contenido';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Cómo funcionan los niveles · ${NOMBRE_SITIO}`,
  description: 'Cómo suben de nivel las fichas con los likes, qué es la EXP total y cómo se reparten los puntos de habilidad.',
  alternates: { canonical: '/niveles' },
};

export default function NivelesRoute() {
  return <NivelesContenido />;
}
