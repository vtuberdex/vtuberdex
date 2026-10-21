/** Rangos por nivel en la interfaz: la tabla vive en el servidor (JS puro) y se reexporta, como `lib/premium.ts`. */
import { RANGOS, rangoDeNivel } from "@/server/src/rangos.mjs";

export type IdRango = "novato" | "aprendiz" | "veterano" | "elite" | "maestro" | "leyenda";

export interface InfoRango {
  id: IdRango;
  indice: number;
  desde: number;
  siguiente: { id: IdRango; desde: number; faltan: number } | null;
}

export const RANGOS_POR_NIVEL: ReadonlyArray<{ id: IdRango; desde: number }> =
  RANGOS as ReadonlyArray<{ id: IdRango; desde: number }>;
export const rangoDelNivel = (nivel: number | null | undefined): InfoRango =>
  rangoDeNivel(nivel ?? 1) as InfoRango;
