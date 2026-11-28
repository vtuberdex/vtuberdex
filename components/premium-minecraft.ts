// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Fondo y tipografía del marco de MISIONES (gradeo ganado jugando en el servidor de Minecraft).
 *
 * POR QUÉ DIBUJADO Y NO UNA TEXTURA DEL JUEGO
 * -------------------------------------------
 * Las texturas de bloques son de Mojang: meterlas en una web pública sería usar arte ajeno. Aquí el fondo
 * es un MOSAICO de bloques de píxeles dibujado por código (hierba arriba, tierra en medio, piedra abajo),
 * original y sin ningún archivo que descargar: son unas cuantas llamadas 2D que se pagan una vez por carta,
 * igual que el resto de la hoja (`premium-label.ts`). Si el mantenedor consigue una textura propia o de un
 * artista, sustituye `dibujarFondoMinecraft` y nada más cambia.
 *
 * Matemática y azar puros (sin DOM) para que `premium-minecraft.test.ts` los fije sin navegador.
 */

/** Familia de la fuente (archivo `app/fonts/Minecrafter-Reg.ttf`, `@font-face` en `app/globals.css`). */
export const FUENTE_MINECRAFT = "Minecrafter";

/**
 * Colores de los bloques. El ORDEN importa: `bloquesDeFondo` elige por índice.
 *   0-1 hierba · 2-4 tierra · 5-7 piedra
 * Tonos apagados: la etiqueta y la ventana de la carta tienen que seguir siendo lo más legible de la placa.
 */
export const PALETA_MINECRAFT = [
  "#5b8f3a",
  "#4d7d31",
  "#7a5a3a",
  "#6b4d31",
  "#8a6844",
  "#7d7f84",
  "#6c6e73",
  "#5d5f64",
] as const;

/** Bloques por fila del lienzo de la hoja (640 px → 40 px por bloque). */
export const COLUMNAS_MINECRAFT = 16;

/** Azar determinista pequeño (mulberry32): la misma carta tiene siempre el mismo fondo. */
function azarDe(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Cuadrícula `filas x columnas` con el índice de `PALETA_MINECRAFT` de cada bloque. Capas por profundidad:
 * una franja de hierba arriba, tierra debajo y piedra al fondo, con el límite entre capas irregular (como un
 * corte de terreno) y los tonos de cada capa mezclados al azar.
 */
export function bloquesDeFondo(
  columnas: number,
  filas: number,
  semilla: number,
): number[][] {
  const azar = azarDe(semilla);
  const finHierba = Math.max(1, Math.round(filas * 0.12));
  const finTierra = Math.round(filas * 0.5);
  const grilla: number[][] = [];
  for (let f = 0; f < filas; f += 1) {
    const fila: number[] = [];
    for (let c = 0; c < columnas; c += 1) {
      // Límite irregular: cada columna adelanta o atrasa una fila el cambio de capa.
      const desvio = Math.floor(azar() * 3) - 1;
      const profundidad = f + desvio;
      if (profundidad < finHierba) {
        fila.push(Math.floor(azar() * 2));
      } else if (profundidad < finTierra) {
        fila.push(2 + Math.floor(azar() * 3));
      } else {
        fila.push(5 + Math.floor(azar() * 3));
      }
    }
    grilla.push(fila);
  }
  return grilla;
}

/** Pinta el mosaico en todo `ancho x alto` y le echa un velo oscuro leve para no competir con la etiqueta. */
export function dibujarFondoMinecraft(
  ctx: CanvasRenderingContext2D,
  ancho: number,
  alto: number,
  semilla: number,
) {
  const lado = ancho / COLUMNAS_MINECRAFT;
  const filas = Math.ceil(alto / lado);
  const bloques = bloquesDeFondo(COLUMNAS_MINECRAFT, filas, semilla);
  const azar = azarDe(semilla ^ 0x9e3779b9);
  bloques.forEach((fila, f) => {
    fila.forEach((indice, c) => {
      const x = c * lado;
      const y = f * lado;
      ctx.fillStyle = PALETA_MINECRAFT[indice];
      ctx.fillRect(x, y, lado + 1, lado + 1);
      // Motas del bloque: media docena de píxeles más oscuros o claros, como el ruido de la textura del juego.
      const mota = lado / 4;
      ctx.fillStyle =
        azar() < 0.5 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.1)";
      ctx.fillRect(
        x + Math.floor(azar() * 3) * mota,
        y + Math.floor(azar() * 3) * mota,
        mota,
        mota,
      );
    });
  });
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fillRect(0, 0, ancho, alto);
}

/**
 * Espera a que el navegador tenga la fuente lista para poder dibujar con ella en el lienzo (un lienzo no
 * dispara la descarga de una `@font-face` por sí solo). Devuelve `false`, sin lanzar, si no se pudo: la
 * etiqueta se dibuja igual con la fuente de respaldo de la pila.
 */
export async function cargarFuenteMinecraft(): Promise<boolean> {
  try {
    const fuentes =
      typeof document === "undefined" ? undefined : document.fonts;
    if (!fuentes?.load) {
      return false;
    }
    const cargadas = await fuentes.load(`16px "${FUENTE_MINECRAFT}"`);
    return cargadas.length > 0;
  } catch {
    return false;
  }
}
