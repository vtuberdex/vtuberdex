/**
 * `/minecraft` — guía para que un VTuber con ficha entre al servidor de Minecraft de VTuberDex.
 * Texto trilingüe en `lib/i18n/textos/minecraft.ts`; los metadatos del servidor quedan en español.
 */
import type { Metadata } from 'next';

import { MinecraftContenido } from '@/components/minecraft/minecraft-contenido';
import { NOMBRE_SITIO } from '@/lib/seo';

export const metadata: Metadata = {
  title: `Cómo entrar al servidor de Minecraft · ${NOMBRE_SITIO}`,
  description: 'Guía paso a paso para que los VTubers con ficha entren al servidor de Minecraft de VTuberDex (Java y Bedrock).',
  alternates: { canonical: '/minecraft' },
};

export default function MinecraftRoute() {
  return <MinecraftContenido />;
}
