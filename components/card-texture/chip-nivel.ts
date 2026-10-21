/**
 * El chip de nivel de la carta: «NIV 12 · VETERANO». UNA definición para las dos capas que lo usan (el dibujo de los chips
 * en `capa-textos.ts` y la medida de su extremo en `componer.ts`): si discreparan, las capas que se colocan a partir del
 * extremo de los chips quedarían desfasadas. El nombre del rango va en español y en mayúsculas como el resto de chips (los
 * textos del canvas no se traducen). Solo hay chip si la carta trae nivel (el detalle sí; el listado no aplica likes ni XP).
 */
import { RANGOS, rangoDeNivel } from "@/server/src/rangos.mjs";

export function chipDeNivel(level: number | null): string | null {
  if (level === null) return null;
  const rango = RANGOS[rangoDeNivel(level).indice] as { nombre: string };
  return `NIV ${level} · ${rango.nombre.toUpperCase()}`;
}
