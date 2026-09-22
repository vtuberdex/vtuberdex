'use client';
/**
 * Textura de la cara frontal de la carta, generada en canvas (sin assets).
 *
 * Composición, de arriba a abajo:
 *   1. Cabecera: número de dex, nombre y bandera del país.
 *   2. Ventana de arte con la imagen del VTuber, logo superpuesto y halo.
 *   3. Barra de stats + tipos (facción/grupo) + frase.
 *   4. Pie: redes principales y sello de la casa.
 *
 * Se dibuja siempre en un canvas de 1024x1436 (proporción 5:7) para que la
 * geometría 3D sea idéntica entre cartas.
 */
import type { VtuberCard } from '@/lib/types';
import { cardPalette, mixHex, rgba } from '@/lib/color';

export const CARD_TEXTURE_WIDTH = 1008;
/**
 * Alto del lienzo de la textura: EXACTAMENTE la proporción de una carta
 * coleccionable (2.5x3.5 pulgadas = 1.4) y la misma que usan el CSS
 * (`aspect-[5/7]`) y el asset de carta generado (720x1008). Antes era 1024x1436
 * (1.4023), un desajuste que hacía que la carta 3D se viera ligeramente estirada.
 */
export const CARD_TEXTURE_HEIGHT = 1411;

/**
 * Anchos de textura admitidos.
 *
 * POR QUÉ SE PUEDE ELEGIR — medido, no estimado
 * ---------------------------------------------
 * La textura se dibujaba SIEMPRE a 1008x1411 (1,42 M de píxeles) y se genera otra
 * vez por cada máscara, con bucles JS que recorren el lienzo entero. En la grilla
 * cada tarjeta se muestra a **163 px** de ancho: 1008 es **6,2×** lo que se ve.
 *
 * El coste medido de las 24 tarjetas a 1008 era de 4 canvas cada una (84 en total,
 * 119 M píxeles) y **24 s de hilo bloqueado** en tareas largas — el scroll se
 * sentía pesado porque el navegador estaba pintando texturas que luego reduce.
 *
 * En la grilla sobra con `tile` (512): a DPR 2 aún hay 1,57× de margen sobre los
 * 326 px reales que se necesitan. El detalle conserva `full` (1008), donde la
 * carta sí se muestra a tamaño grande y el texto fino se nota.
 */
export const CARD_TEXTURE_TILE_WIDTH = 512;
export const CARD_TEXTURE_FULL_WIDTH = CARD_TEXTURE_WIDTH;

export interface CardTextureInput {
  card: VtuberCard;
  /** Imagen de arte ya cargada (la carta o el personaje); puede ser null. */
  art: HTMLImageElement | null;
  logo: HTMLImageElement | null;
  /**
   * Ancho del lienzo. Por defecto el de resolución completa (1008), que es el que
   * usa el detalle. La grilla pasa `CARD_TEXTURE_TILE_WIDTH` (512): la tarjeta se
   * ve a ~163 px, así que dibujar a 1008 era 6,2× trabajo para luego reducirlo.
   *
   * El dibujo NO cambia: todo el cuerpo de la función está escrito en unidades del
   * lienzo de 1008, así que basta un `ctx.scale()` para que salga idéntico a otra
   * resolución. Es la razón de mantener las coordenadas en la escala canónica en
   * vez de introducir un factor en cada literal.
   */
  width?: number;
}

const FONT = '"Chakra Petch", "Rajdhani", system-ui, sans-serif';

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startSize: number, weight = '700'): number {
  let size = startSize;
  do {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > 16);
  return size;
}

/** Dibuja la cara frontal y devuelve el canvas listo para usar como textura. */
/**
/**
 * Rectángulos que el FONDO no puede pisar, en UV normalizado.
 *
 * POR QUÉ CAJAS Y NO UNA BANDA DE ALTO COMPLETO
 * ---------------------------------------------
 * La primera versión protegía una BANDA horizontal —de debajo de los chips de estado
 * al techo de la frase— y eso dejaba dos FRANJAS SIN FONDO arriba y abajo, que es
 * exactamente lo que se veía como "el fondo se corta". El fondo cubría el 100% del
 * ancho pero solo una parte del alto, y con una arista recta en cada extremo.
 *
 * El texto de la carta no ocupa filas enteras: la cabecera va de `pad` a `W-pad`, los
 * chips de estado solo a la IZQUIERDA, el logo solo a la DERECHA y los de tipos y la
 * frase abajo. Proteger la fila completa tiraba el fondo de franjas donde el único
 * texto es una esquina.
 *
 * Así que la zona prohibida son las CAJAS del texto, y el fondo se dibuja en todo lo
 * demás, con un margen (`FONDO_TEXTO_MARGEN`) que mantiene la separación para que no
 * se lea pegado.
 *
 * Los valores salen de las MISMAS constantes con las que se dibuja cada bloque en
 * `drawCardFront`, no de una estimación: si allí se mueve un bloque, aquí cambia solo.
 */
const FONDO_TEXTO_MARGEN = 14;

let lastTextBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }> | null = null;

/** Publica las cajas del texto de la carta que se acaba de dibujar. */
export function getLastTextBoxes(): Array<{ x0: number; y0: number; x1: number; y1: number }> | null {
  return lastTextBoxes;
}

/**
 * CAPA DE TEXTO de la última carta dibujada: los píxeles de la carta en las bandas donde
 * vive el texto (cabecera, chips, tipos, frase y pie), con transparencia fuera de ellas.
 *
 * El shader la pega ENCIMA del fondo. Ver el porqué en `drawCardFront`.
 */
let textLayer: HTMLCanvasElement | null = null;

/** Devuelve la capa de texto de la última carta dibujada. */
export function getLastTextLayer(): HTMLCanvasElement | null {
  return textLayer;
}

/**
 * Caja donde quedó dibujado el LOGO en la última llamada a `drawCardFront`. La usa
 * `logoMask()` para generar su máscara en la posición exacta.
 */
let lastLogoBox: { x: number; y: number; w: number; h: number } | null = null;
export function getLastLogoBox(): { x: number; y: number; w: number; h: number } | null {
  return lastLogoBox;
}

export function drawCardFront({ card, art, logo, width = CARD_TEXTURE_WIDTH }: CardTextureInput): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = Math.round(width * (CARD_TEXTURE_HEIGHT / CARD_TEXTURE_WIDTH));
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  lastLogoBox = null;
  lastTextBoxes = null;
  textLayer = null;
  const { accent, secondary, deep, mid, sheen } = cardPalette(card.themeColor, card.secondaryColor);
  /**
   * Todo el dibujo está escrito en unidades del lienzo CANÓNICO (1008 de ancho).
   * Escalar aquí, una sola vez, hace que la carta salga idéntica a cualquier
   * resolución sin tocar ni un literal del resto de la función.
   */
  const scale = width / CARD_TEXTURE_WIDTH;
  ctx.scale(scale, scale);
  const W = CARD_TEXTURE_WIDTH;
  const H = CARD_TEXTURE_HEIGHT;
  const pad = 46;

  // ------------------------------------------------------------- ARTE (full) ---
  // El FONDO se pinta SIEMPRE antes del arte: el personaje se guarda con alfa
  // (lienzo de carta transparente), así que dibujarlo directamente dejaría la
  // carta sin fondo y se vería el hueco por detrás.
  const bgGradient = ctx.createLinearGradient(0, 0, W, H);
  bgGradient.addColorStop(0, mid);
  bgGradient.addColorStop(0.45, deep);
  bgGradient.addColorStop(1, '#080910');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, W, H);

  // ------------------------------------------------------------- ARTE (full) ---
  // El arte se ajusta SIEMPRE al ALTO completo de la carta, conservando su
  // proporción. No se recorta ni se amplía por encima del marco:
  //   - Si ya tiene proporción de carta (1.4) -> llena el lienzo exacto.
  //   - Si es más estrecho -> se ajusta por alto y queda centrado en horizontal.
  //   - Si es más ancho -> se ajusta por alto; el sobrante lateral se recorta
  //     contra el borde (nunca se estira, que deformaría la figura).
  // Antes se ampliaba con un término extra (`(H + headerBottom) / art.height`)
  // pensado para "colar" el arte por debajo de la cabecera: eso hacía que la
  // imagen se saliera del marco y que el personaje se viera a medias.
  if (art) {
    const scaleToHeight = H / art.height;
    const dw = art.width * scaleToHeight;
    const dh = H;
    // Centrado en horizontal. Si sobra más de lo que cabe, el recorte es simétrico.
    const dx = (W - dw) / 2;
    ctx.drawImage(art, dx, 0, dw, dh);
  } else {
    // Sin arte: el fondo ya está pintado arriba, solo se avisa.
    ctx.fillStyle = rgba(sheen, 0.55);
    ctx.font = `700 44px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SIN IMAGEN', W / 2, H / 2);
    ctx.textAlign = 'left';
  }

  // Tinte del color de marca: unifica el arte con la identidad del VTuber, pero
  // MUY sutil. Antes iba a 0.22-0.30 sobre toda la carta y, sumado a las veladuras
  // y a la viñeta, apagaba la imagen entera.
  const tint = ctx.createLinearGradient(0, 0, W, H);
  tint.addColorStop(0, rgba(accent, 0.16));
  tint.addColorStop(0.5, rgba(deep, 0.1));
  tint.addColorStop(1, rgba(secondary, 0.14));
  ctx.fillStyle = tint;
  ctx.fillRect(0, 0, W, H);

  // ------------------------------------------------- VELADURAS DE LEGABILIDAD ---
  // Arriba (cabecera) y abajo (frase/tipos/barra): sin esto el texto no se lee
  // sobre una foto clara.
  const topShade = ctx.createLinearGradient(0, 0, 0, 300);
  topShade.addColorStop(0, 'rgba(5,6,10,0.92)');
  topShade.addColorStop(0.55, 'rgba(5,6,10,0.62)');
  topShade.addColorStop(1, 'rgba(5,6,10,0)');
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, W, 300);

  // El degradado inferior arranca MÁS ABAJO y es menos opaco: antes empezaba al
  // 42% de la altura y llegaba a 0.95 de opacidad al 62%, así que oscurecía media
  // carta y tapaba al personaje. Ahora reserva solo la franja donde viven la frase,
  // los tipos y la barra de stats, y deja el arte visible por encima.
  const bottomShade = ctx.createLinearGradient(0, H * 0.58, 0, H);
  // Opacidad REDUCIDA OTRA VEZ (0.55/0.82/0.94 -> 0.34/0.55/0.68 -> 0.18/0.34/0.46):
  // el degradado negro seguía oscureciendo la parte baja del arte. Con estos
  // valores la frase y los chips se leen igual (llevan su propio contraste) y el
  // personaje queda visible hasta abajo.
  bottomShade.addColorStop(0, 'rgba(5,6,10,0)');
  bottomShade.addColorStop(0.35, 'rgba(5,6,10,0.18)');
  bottomShade.addColorStop(0.70, 'rgba(5,6,10,0.34)');
  bottomShade.addColorStop(1, 'rgba(5,6,10,0.46)');
  ctx.fillStyle = bottomShade;
  ctx.fillRect(0, H * 0.58, W, H * 0.42);

  // Rejilla técnica sutil sobre todo el conjunto.
  ctx.strokeStyle = rgba(sheen, 0.05);
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  // --------------------------------------------------------------- marco ---
  // SIN contorno dibujado. Cualquier trazo aquí es una línea de ancho constante y
  // por tanto un FILO duro dentro de la carta. El borde ya lo define el canto 3D
  // (el cuerpo con esquinas redondeadas) y el brillo del contorno lo aporta el
  // shader con el Fresnel del color de marca, que sí se degrada con la luz.

  // ------------------------------------------------------------ cabecera ---
  // Placa de cabecera translúcida (deja ver el arte) para anclar número+nombre.
  const headerTop = 44;
  const headerH = 116;
  const headerGradient = ctx.createLinearGradient(pad, headerTop, W - pad, headerTop + headerH);
  headerGradient.addColorStop(0, rgba(accent, 0.95));
  headerGradient.addColorStop(1, rgba(secondary, 0.75));
  ctx.fillStyle = headerGradient;
  roundRect(ctx, pad, headerTop, W - pad * 2, headerH, 22);
  ctx.fill();

  // Número de dex en placa metálica.
  const badge = `#${String(card.dexNumber).padStart(3, '0')}`;
  ctx.fillStyle = rgba('#05060a', 0.6);
  roundRect(ctx, pad + 16, headerTop + 21, 168, 74, 16);
  ctx.fill();
  ctx.fillStyle = sheen;
  ctx.font = `800 44px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(badge, pad + 100, headerTop + 59);

  // Nombre: reserva el ancho del país para que nunca se solapen.
  const primary = card.countries[0];
  const countryLabel = primary ? `${primary.flag ?? ''} ${primary.name}`.trim() : '';
  ctx.font = `600 34px ${FONT}`;
  const countryWidth = countryLabel ? ctx.measureText(countryLabel).width + 28 : 0;
  const nameMax = W - pad * 2 - 232 - countryWidth;
  ctx.textAlign = 'left';
  const nameSize = fitText(ctx, card.name.toUpperCase(), nameMax, 58, '800');
  ctx.font = `800 ${nameSize}px ${FONT}`;
  ctx.fillStyle = '#0a0c11';
  ctx.fillText(card.name.toUpperCase(), pad + 212, headerTop + 59);

  if (primary) {
    ctx.textAlign = 'right';
    ctx.font = `600 34px ${FONT}`;
    ctx.fillStyle = rgba('#05060a', 0.78);
    ctx.fillText(countryLabel, W - pad - 18, headerTop + 59);
  }

  // ------------------------------------------------------------- LOGO (grande) ---
  // Sin marco NI fondo, POR ENCIMA de la franja de tags.
  // El tamaño se ajusta por ÁREA, no por ancho/alto: los logos tienen
  // proporciones muy dispares (0.7 a 9:1), y un límite por dimensión dejaba unos
  // diminutos y otros enormes. Con área, todos pesan visualmente lo mismo.
  // El usuario pidió el logo un TERCIO más pequeño en la carta 3D. El tamaño se
  // fija por ÁREA (no por lado), así que un tercio menos de lado es ~(2/3)^2 del
  // área: 0.11 * 0.44 = 0.049.
  const LOGO_AREA = W * H * 0.049;
  const logosBase = H - 140 - 22; // borde inferior de la barra de stats
  const logoWidth = logo
    ? (() => {
        const scale = Math.sqrt(LOGO_AREA / (logo.width * logo.height));
        return { dw: logo.width * scale, dh: logo.height * scale };
      })()
    : null;
  // Altura de los chips de tipo: hay que reservarla ANTES de colocar el logo.
  const typesList = [...card.factions, ...card.groups].slice(0, 4);
  const chipFont = `700 24px ${FONT}`;
  const chipRowsPreview: string[][] = [];
  ctx.save();
  ctx.font = chipFont;
  for (const type of typesList) {
    const label = type.toUpperCase().slice(0, 22);
    const width = ctx.measureText(label).width + 32;
    const row = chipRowsPreview[chipRowsPreview.length - 1];
    const used = row ? row.reduce((sum, item) => sum + ctx.measureText(item).width + 32 + 12, 0) : 0;
    if (row && used + width <= W - pad * 2) row.push(label);
    else chipRowsPreview.push([label]);
  }
  ctx.restore();
  const rowHeight = 54;
  const typesHeight = chipRowsPreview.length * rowHeight + 12;

  // El logo vive en su propia banda, encima de los chips y subido sobre la frase.
  /**
   * SE MIDE SU CAJA, PERO NO SE DIBUJA (fallo medido).
   *
   * Antes el logo se dibujaba aquí Y el shader lo recomponía como pegatina al final
   * (`uLogoSticker`), así que había DOS logos: el horneado en la textura —fijo— y el
   * sticker —con paralaje—. En reposo el sticker tapa al horneado y no se nota, pero en
   * cuanto la carta se inclina el sticker se corre y deja al descubierto el horneado:
   * eso era el "logo duplicado, uno quieto y otro moviéndose".
   *
   * El horneado no lo consume nadie más: la carta 3D dibuja el sticker y el respaldo 2D
   * usa un `<img>` del arte, no esta textura. Así que se deja de dibujar y solo se
   * publica la caja, que es lo que el sticker y su máscara necesitan para colocarse.
   *
   * Sigue haciendo falta la caja para reservar el ESPACIO: `phraseTopLimit` la usa más
   * abajo para que la frase no suba a la banda del logo.
   */
  if (logo && logoWidth) {
    const lx = W - pad - logoWidth.dw;
    const ly = logosBase - typesHeight - logoWidth.dh - 70;
    // Se publica dónde IRÍA el logo para que `logoMask()` y `logoSticker()` lo dibujen
    // en el MISMO sitio: la exclusión del holográfico debe calcar la silueta real del
    // logotipo, no un rectángulo aproximado que dejaba un parche sin efecto.
    lastLogoBox = { x: lx, y: ly, w: logoWidth.dw, h: logoWidth.dh };
  }

  // --------------------------------------------------------- chips de estado ---
  const stateChips = [
    card.level !== null ? `NIV ${card.level}` : null,
    card.powerScore ? `PODER ${card.powerScore}` : null,
    card.hasDetail ? 'FICHA COMPLETA' : 'SOLO FICHA BÁSICA',
  ].filter(Boolean) as string[];
  let stateX = pad;
  const stateY = headerTop + headerH + 34;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const chip of stateChips) {
    ctx.font = `700 24px ${FONT}`;
    const chipW = ctx.measureText(chip).width + 30;
    ctx.fillStyle = 'rgba(5,6,10,0.62)';
    roundRect(ctx, stateX, stateY, chipW, 42, 12);
    ctx.fill();
    ctx.strokeStyle = rgba(accent, 0.6);
    ctx.lineWidth = 1.5;
    roundRect(ctx, stateX, stateY, chipW, 42, 12);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(chip, stateX + 15, stateY + 22);
    stateX += chipW + 10;
  }
  /**
   * Borde derecho REAL de la fila de chips de estado. Se toma aquí, cuando ya se han
   * medido, porque el ancho depende del texto (nivel y poder varían por ficha). La
   * máscara del fondo lo necesita para proteger solo lo que llega a ocupar, en vez de
   * una fila entera de ancho completo.
   */
  const stateChipsEnd = stateChips.length > 0 ? stateX - 10 : pad;

  // ----------------------------------------------------------------- tipos ---
  // Repartidos en filas; su altura se descuenta del espacio de la frase.
  const barY = H - 140;
  const chipRows = chipRowsPreview;
  const phraseBottomLimit = barY - 22 - typesHeight;
  // Si hay logo, la frase no puede subir hasta su banda (va encima de los chips).
  const phraseTopLimit = logoWidth
    ? logosBase - typesHeight - logoWidth.dh - 86
    : H * 0.5;
  const textWidth = W - pad * 2;

  // ---------------------------------------------------------------- frase ---
  let y = H - 140 - 24 - typesHeight - 26;
  const phrase = (card.phrase ?? '').replace(/\s+/g, ' ').trim();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `500 32px ${FONT}`;
  ctx.fillStyle = rgba('#e8ecf5', 0.94);
  const lineHeight = 42;
  const maxPhraseLines = Math.max(1, Math.floor((phraseBottomLimit - phraseTopLimit) / lineHeight));
  /**
   * Caja REAL de la frase, para la máscara del fondo. Se siguen los extremos que la
   * frase acaba ocupando de verdad —el renglón más ancho y la primera línea— en vez de
   * `phraseTopLimit`, que es un LÍMITE DE ESPACIO y no la posición del texto: con la
   * frase vacía ese límite queda a media carta y bloqueaba el fondo por debajo de la
   * mitad, que es el corte que se veía.
   */
  let phraseBoxTop = phraseBottomLimit - 26;
  let phraseBoxRight = pad;
  if (phrase) {
    // Se parte en líneas y se coloca desde abajo hacia arriba para no chocar con
    // los tipos; si sobra texto, se recorta con "…".
    const words = phrase.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > textWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);

    const visible = lines.slice(0, Math.max(1, maxPhraseLines));
    if (lines.length > visible.length) visible[visible.length - 1] = `${visible[visible.length - 1]}…`;
    const total = visible.length;
    y = phraseBottomLimit - (total - 1) * lineHeight;
    phraseBoxTop = y - 26;
    for (const line of visible) {
      phraseBoxRight = Math.max(phraseBoxRight, pad + ctx.measureText(line).width);
      ctx.fillText(line, pad, y);
      y += lineHeight;
    }
  } else {
    ctx.fillStyle = rgba('#e8ecf5', 0.5);
    ctx.fillText('Sin presentación registrada', pad, phraseBottomLimit);
    phraseBoxRight = Math.max(
      phraseBoxRight,
      pad + ctx.measureText('Sin presentación registrada').width,
    );
  }

  // Chips de tipos, anclados sobre la barra.
  /**
   * Extremos que ocupan los chips de tipos. Igual que los de estado, se miden: hay
   * fichas sin tipos (el fondo puede llegar hasta la barra) y otras con cuatro, y solo
   * la fila más ancha debe quedar protegida.
   */
  let typesTop = barY - 22;
  let typesRight = pad;
  if (chipRows.length > 0) {
    let ty = barY - 22 - chipRows.length * rowHeight;
    typesTop = ty;
    for (const row of chipRows) {
      let tx = pad;
      ctx.font = chipFont;
      for (const label of row) {
        const tw = ctx.measureText(label).width + 32;
        const typeGradient = ctx.createLinearGradient(tx, 0, tx + tw, 0);
        typeGradient.addColorStop(0, rgba(accent, 0.92));
        typeGradient.addColorStop(1, rgba(secondary, 0.85));
        ctx.fillStyle = typeGradient;
        roundRect(ctx, tx, ty, tw, 42, 21);
        ctx.fill();
        ctx.fillStyle = '#080a10';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, tx + 16, ty + 23);
        ctx.textBaseline = 'alphabetic';
        tx += tw + 12;
      }
      typesRight = Math.max(typesRight, tx - 12);
      ty += rowHeight;
    }
  }

  // ---------------------------------------------------------------- barra ---
  const barH = 16;
  const segments = card.statsPreview ?? [];
  let bx = pad;
  const barW = W - pad * 2;
  ctx.fillStyle = rgba('#ffffff', 0.12);
  roundRect(ctx, pad, barY, barW, barH, 8);
  ctx.fill();
  const palette = [accent, secondary, mixHex(accent, '#ffffff', 0.4), mixHex(secondary, '#ffffff', 0.3)];
  const total = segments.reduce((sum, value) => sum + value, 0) || 1;
  segments.forEach((value, index) => {
    const w = (value / total) * barW;
    ctx.fillStyle = palette[index % palette.length];
    roundRect(ctx, bx, barY, Math.max(w - 4, 6), barH, 8);
    ctx.fill();
    bx += w;
  });

  // ------------------------------------------------------------------- pie ---
  ctx.font = `600 26px ${FONT}`;
  ctx.fillStyle = rgba('#e8ecf5', 0.68);
  ctx.textAlign = 'left';
  const socialCount = card.socialCount ?? 0;
  ctx.fillText(socialCount > 0 ? `${socialCount} redes enlazadas` : 'Sin redes enlazadas', pad, H - 86);

  ctx.textAlign = 'right';
  ctx.fillStyle = rgba(sheen, 0.8);
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText('VTUBERDEX', W - pad, H - 86);
  ctx.font = `500 22px ${FONT}`;
  ctx.fillStyle = rgba('#e8ecf5', 0.5);
  ctx.fillText(primary ? `${primary.name}` : 'Sin país', W - pad, H - 54);

  /**
   * CAJAS DE TEXTO que el fondo no puede pisar.
   *
   * Antes aquí se publicaba una BANDA de alto completo (`top`/`bottom`) y de ahí salían
   * las franjas negras arriba y abajo que se reportaron: el fondo cubría el 100% del
   * ancho pero se recortaba a una franja horizontal. El texto de la carta NO ocupa
   * filas enteras —los chips de estado van solo a la izquierda, el logo solo a la
   * derecha, la frase solo a la izquierda— así que prohibir la fila completa borraba
   * fondo de zonas donde no hay nada.
   *
   * Se publican las cajas REALES, con los extremos medidos durante el dibujo:
   *
   *   - cabecera: la placa completa (número + nombre + país)
   *   - chips de estado: de `pad` al borde medido del último chip, a la izquierda
   *   - logo: su caja, a la derecha
   *   - tipos y frase: el bloque de abajo, con su ancho medido
   *
   * Nada de esto es una estimación: cada valor sale de la misma medición con la que se
   * dibujó el bloque, así que si allí cambia, aquí cambia solo.
   */
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  // Cabecera: placa completa.
  boxes.push({ x0: pad, y0: headerTop, x1: W - pad, y1: headerTop + headerH });
  // Chips de estado (izquierda).
  if (stateChips.length > 0) {
    boxes.push({ x0: pad, y0: stateY, x1: stateChipsEnd, y1: stateY + 42 });
  }
  // Logo (derecha).
  if (logoWidth) {
    boxes.push({
      x0: W - pad - logoWidth.dw,
      y0: logosBase - typesHeight - logoWidth.dh - 70,
      x1: W - pad,
      y1: logosBase - typesHeight - 70,
    });
  }
  // Tipos (izquierda, sobre la barra).
  if (chipRows.length > 0) {
    boxes.push({ x0: pad, y0: typesTop, x1: typesRight, y1: barY - 22 });
  }
  // Frase (izquierda, bajo los tipos).
  boxes.push({
    x0: pad,
    y0: phrase && phraseBoxRight > pad ? phraseBoxTop : phraseBottomLimit - 26,
    x1: Math.max(phraseBoxRight, pad + 320),
    y1: phraseBottomLimit + 10,
  });
  // Pie: redes y créditos, a los dos lados.
  boxes.push({ x0: pad, y0: H - 108, x1: W / 2, y1: H - 40 });
  boxes.push({ x0: W / 2, y0: H - 108, x1: W - pad, y1: H - 40 });
  lastTextBoxes = boxes.map((b) => ({
    x0: (b.x0 - FONDO_TEXTO_MARGEN) / W,
    y0: (b.y0 - FONDO_TEXTO_MARGEN) / H,
    x1: (b.x1 + FONDO_TEXTO_MARGEN) / W,
    y1: (b.y1 + FONDO_TEXTO_MARGEN) / H,
  }));

  /**
   * CAPA DE TEXTO: el ancho de la carta en la banda del texto, para recomponerlo ENCIMA
   * del fondo en el shader.
   *
   * POR QUÉ ASÍ Y NO EXCLUYENDO EL FONDO (el fallo costó dos intentos)
   * ----------------------------------------------------------------
   * Como el shader compone el fondo REEMPLAZANDO la carta donde el personaje es
   * transparente, el texto de esa zona desaparece bajo la imagen. Se intentó primero
   * EXCLUIR el fondo de las cajas de texto: dejaba ver el degradado oscuro del tema y la
   * veladura de legibilidad, o sea RECTÁNGULOS NEGROS pegados a la cabecera, los chips y
   * el pie. Se intentó después ATENUARLO: menos negro, pero seguía viéndose la franja.
   *
   * El problema es de fondo: cualquier cosa que deje asomar la textura bajo el fondo se
   * ve oscura, porque esa zona de la carta es una placa casi negra a propósito (para que
   * el texto se lea sobre cualquier arte). Lo correcto es lo que el repo ya hace con el
   * LOGO: no cortar el fondo, sino RE-COMPONER el elemento por encima.
   *
   * Así que esta capa lleva copiados los píxeles de la carta en las bandas del texto
   * —placa, chips, frase y pie, con sus degradados— y su ALFA marca dónde van. El shader
   * dibuja el fondo sin exclusiones en todo el lienzo y después pega esta capa encima: el
   * texto queda idéntico al de siempre y el fondo llega a los cuatro bordes.
   */
  textLayer = document.createElement('canvas');
  textLayer.width = canvas.width;
  textLayer.height = canvas.height;
  const tl = textLayer.getContext('2d');
  if (tl) {
    /**
     * CAJAS EXACTAS, sin margen: el recorte coincide con el borde de cada placa.
     *
     * POR QUE SIN MARGEN (fallo medido): la primera version usaba BANDAS de ancho
     * completo, y eso volvia a tapar el fondo en toda la franja — se veia un corte
     * horizontal a la altura del chip, o sea el mismo defecto con otra forma. Con las
     * cajas ajustadas, el fondo llega al borde superior y al lateral, y lo unico que se
     * repone encima son las placas.
     *
     * Tampoco vale el margen que usa `lastTextBoxes` (14 px): esos 14 px de mas son
     * textura de la carta, que en la cabecera es la veladura oscura, asi que saldria un
     * anillo oscuro alrededor de cada placa.
     */
    for (const b of boxes) {
      const x = Math.round(b.x0 * scale);
      const y = Math.round(b.y0 * scale);
      const w = Math.round((b.x1 - b.x0) * scale);
      const h = Math.round((b.y1 - b.y0) * scale);
      if (w <= 0 || h <= 0) continue;
      tl.drawImage(canvas, x, y, w, h, x, y, w, h);
    }
  }

  return canvas;
}

/** Convierte el canvas en ImageBitmap para `THREE.CanvasTexture`. */
export function canvasToTextureSource(canvas: HTMLCanvasElement): HTMLCanvasElement {
  return canvas;
}

/**
 * COBERTURA DEL FONDO: dónde el FONDO debe verse, calculada desde la
 * transparencia REAL del personaje.
 *
 * POR QUÉ HACE FALTA ESTA MÁSCARA
 * ------------------------------
 * El shader no puede deducir esta zona del alfa de la carta: `uMap` es la carta ya
 * compuesta y su degradado de tema se pinta OPACO sobre todo el lienzo antes del
 * arte, así que en esa textura la transparencia del personaje ya no existe. La
 * silueta hay que calcularla desde la imagen original del personaje, en CPU, y
 * pasarla como su propia textura (el mismo recurso que `logoMask`).
 *
 * QUÉ DEVUELVE
 * ------------
 * Rojo = 1 donde el fondo puede pintarse. Dos condiciones, y ambas importan:
 *
 *   1. **El personaje es transparente ahí.** Se mide el ALFA del arte, no un umbral
 *      de color: un personaje con fondo transparente deja ver el color de tema de la
 *      carta en los márgenes, y ahí es justo donde el fondo tiene que entrar. La
 *      rampa de `edgeSoftness` suaviza el borde para que el fondo aparezca de forma
 *      gradual en vez de con un corte duro. En las fichas cuyo arte es un rectángulo
 *      opaco (medido: 684 de 785 cubren ≥98% del alto) la cobertura sale casi toda 0
 *      y el fondo apenas se ve — comportamiento aceptado a propósito.
 *   2. **No cae sobre una CAJA DE TEXTO.** A diferencia de la versión anterior, que
 *      solo permitía el fondo dentro de una BANDA horizontal, la cobertura ahora vale
 *      en TODO el lienzo salvo donde hay texto. Esa banda dejaba dos franjas sin fondo
 *      —arriba y abajo— porque el texto no ocupa filas enteras: los chips de estado van
 *      a la izquierda, el logo a la derecha y la frase a la izquierda. Con las cajas, el
 *      fondo cubre el ancho y el alto completos y solo se aparta de lo que de verdad hay
 *      que leer.
 *
 * ALCANCE DEL FONDO
 * -----------------
 * El fondo NO llega a los bordes de la carta: se queda en el interior del canto, que
 * es lo que evita que asome por los filos al inclinar. El recorte lo hace el propio
 * cuerpo 3D con sus esquinas redondeadas, así que aquí no hace falta.
 *
 * @param art     imagen del personaje ya cargada (null si la ficha no tiene)
 * @param width   ancho del lienzo de la carta
 * @param height  alto del lienzo
 * @param boxes   cajas de texto a proteger, en UV (de `getLastTextBoxes`)
 * @returns canvas en escala de grises; el shader lo lee por su canal rojo
 */
export function characterAlphaMask(
  art: CanvasImageSource | null,
  width: number,
  height: number,
  boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> | null,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const out = ctx.createImageData(width, height);
  const o = out.data;

  /**
   * Colocación del arte: la MISMA que `drawCardFront` (ajuste al alto completo,
   * centrado horizontal). Tiene que coincidir exactamente o la máscara caería
   * desplazada respecto de la imagen y el fondo se vería por encima del personaje en
   * unas zonas y por debajo en otras.
   */
  let artCanvas: HTMLCanvasElement | null = null;
  let dx = 0;
  let dw = 0;
  if (art) {
    const anyArt = art as { width?: number; height?: number };
    const artW = anyArt.width ?? 0;
    const artH = anyArt.height ?? 0;
    if (artW > 0 && artH > 0) {
      /** Se dibuja en un canvas auxiliar para poder LEER su alfa píxel a píxel. */
      artCanvas = document.createElement('canvas');
      artCanvas.width = width;
      artCanvas.height = height;
      const artCtx = artCanvas.getContext('2d');
      if (artCtx) {
        const scaleToHeight = height / artH;
        dw = artW * scaleToHeight;
        dx = (width - dw) / 2;
        artCtx.drawImage(art, dx, 0, dw, height);
      } else {
        artCanvas = null;
      }
    }
  }

  const artData = artCanvas?.getContext('2d')?.getImageData(0, 0, width, height).data ?? null;

  /**
   * COBERTURA = transparencia del PERSONAJE, sin más.
   *
   * El texto NO se protege aquí: se recompone encima del fondo con la capa de texto (ver
   * `drawCardFront`). Se intentó antes excluirlo y atenuarlo con este mismo mapa y las dos
   * versiones dejaban ver la placa oscura de la carta como franjas negras, porque el
   * problema no era cuánto fondo se pinta sino que la textura de debajo es casi negra.
   */
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const coverage = artData ? 1 - artData[(y * width + x) * 4 + 3] / 255 : 1;
      const i = (y * width + x) * 4;
      o[i] = Math.round(coverage * 255);
      o[i + 1] = Math.round(coverage * 255);
      o[i + 2] = Math.round(coverage * 255);
      o[i + 3] = 255;
    }
  }

  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * Máscara de TINTA Y PIEL: aísla el LINEART NEGRO y los TONOS DE PIEL del dibujo.
 *
 * Por qué esto y no un paso alto: un realce de bordes (diferencia contra una
 * versión desenfocada) responde a CUALQUIER cambio de intensidad, así que también
 * enciende el ruido del fondo, las luces y las texturas que no son el personaje.
 * Lo que define a un personaje de anime, y lo que conviene resaltar sobre la
 * lámina, son dos cosas concretas:
 *
 *   1. LINEART: los trazos negros que dibujan el contorno, el pelo y la ropa.
 *      Se detectan por ser oscuros en los TRES canales (`max(r,g,b)` bajo) con
 *      poca saturación... aunque los lineart coloreados existen, así que se admite
 *      algo de tinte y se exige solo que sea oscuro.
 *   2. PIEL: los tonos de piel caucásica y mate cumplen una relación estable
 *      entre canales (R > G > B con diferencias acotadas). Se comprueba esa
 *      relación en vez de un rango de color rígido, porque el tono varía mucho
 *      entre personajes (desde pálido hasta moreno) y un umbral fijo dejaría
 *      fuera a media plantilla.
 *
 * El resultado se devuelve en escala de grises (intensidad de la máscara) con el
 * alfa del arte, para mezclarlo en el shader en modo LUZ: el lineart y la piel
 * se encienden como holograma y el resto de la carta queda intacto.
 *
 * @param art imagen del personaje ya cargada
 * @param width ancho del lienzo
 * @param height alto del lienzo
 * @returns canvas con la máscara (RGB = intensidad, alfa = cobertura del arte)
 */
export function inkAndSkinMask(art: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const artCanvas = document.createElement('canvas');
  artCanvas.width = width;
  artCanvas.height = height;
  const artCtx = artCanvas.getContext('2d');
  if (!artCtx) return canvas;
  // Mismo encuadre que la carta (ajuste al alto): la máscara cae exactamente
  // sobre el dibujo que hay debajo.
  artCtx.drawImage(art, 0, 0, width, height);

  const src = artCtx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const a = src.data;
  const o = out.data;

  for (let i = 0; i < a.length; i += 4) {
    const alpha = a[i + 3];
    if (alpha < 8) continue; // fuera del personaje no hay nada que resaltar
    const r = a[i];
    const g = a[i + 1];
    const b = a[i + 2];

    // --- LINEART -----------------------------------------------------------
    // Oscuro en los tres canales. El umbral 92 cubre los trazos negros y los
    // grises muy oscuros del sombreado, sin llegar a las zonas medianas.
    const maxCh = Math.max(r, g, b);
    const minCh = Math.min(r, g, b);
    const ink = maxCh < 92 ? 1 - maxCh / 92 : 0;

    // --- PIEL --------------------------------------------------------------
    // Relación de canales de la piel: el rojo manda, el verde va cerca y el azul
    // se queda atrás. Se exige además un mínimo de luminosidad para no confundir
    // la piel con zonas oscuras del trazo, y un máximo de saturación para no
    // capturar naranjas puros de la ropa o el fondo.
    const esCalido = r > g && g >= b && r - b > 12 && r - b < 120;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = maxCh === 0 ? 0 : (maxCh - minCh) / maxCh;
    const piel = esCalido && lum > 70 && lum < 250 && sat < 0.62 ? 1 : 0;
    // La piel entra más suave que el lineart: si pesara igual, una cara grande se
    // convertiría en una mancha encendida y el efecto perdería el dibujo.
    const skinWeight = 0.55;

    const intensidad = Math.max(ink, piel * skinWeight);
    if (intensidad <= 0) continue;

    const v = Math.round(Math.min(255, intensidad * 255));
    o[i] = v;
    o[i + 1] = v;
    o[i + 2] = v;
    o[i + 3] = alpha;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Carga una imagen con CORS habilitado (necesario para usarla en WebGL). */
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

/**
 * Máscara del LOGO: su SILUETA REAL (los píxeles opacos del propio logo), en la
 * misma caja donde se dibujó.
 *
 * Por qué una máscara y no un rectángulo: el logo tiene transparencia alrededor y
 * proporciones muy distintas según el VTuber, así que excluir un rectángulo dejaba
 * un parche rectangular visible donde el holográfico no entraba. Con la silueta
 * real, el shader sabe exactamente dónde está la marca.
 *
 * El valor de la máscara es 1 sobre el logo y 0 fuera, para que el shader baje el
 * HOLOGRÁFICO dentro de ella pero deje intactos los REFLEJOS (barniz), que en una
 * carta real sí pasan sobre cualquier impresión.
 */
export function logoMask(logo: CanvasImageSource, box: { x: number; y: number; w: number; h: number }, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  /**
   * `box` llega en unidades CANÓNICAS (las de `drawCardFront`, que dibuja sobre un
   * lienzo de 1008). Si la máscara se genera a otra resolución hay que escalarla,
   * o el logo caería en una posición distinta a la de la carta.
   */
  const scale = width / CARD_TEXTURE_WIDTH;
  ctx.scale(scale, scale);

  // El logo se redibuja en su caja y se recorta a su alfa real: la silueta.
  const tmp = document.createElement('canvas');
  tmp.width = width;
  tmp.height = height;
  const tmpCtx = tmp.getContext('2d');
  if (!tmpCtx) return canvas;
  tmpCtx.scale(scale, scale);
  tmpCtx.drawImage(logo, box.x, box.y, box.w, box.h);

  const src = tmpCtx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  const a = src.data;
  const o = out.data;
  for (let i = 0; i < a.length; i += 4) {
    // La marca se considera cubierta donde el logo tiene presencia visible.
    const cubierto = a[i + 3] > 24 ? 255 : 0;
    o[i] = cubierto;
    o[i + 1] = cubierto;
    o[i + 2] = cubierto;
    o[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/**
 * LOGO COMO STICKER: el logotipo dibujado en su caja, con sus píxeles y su alfa,
 * para recomponerlo sobre las capas de efecto en el shader.
 *
 * Se devuelve como una imagen del tamaño del lienzo (no solo el recorte) porque el
 * shader lo muestrea con las mismas coordenadas UV que la textura de la carta: así
 * el sticker cae exactamente donde estaba el logo, sin cálculos de posición en el
 * shader ni riesgo de desalinearse.
 */
export function logoSticker(logo: CanvasImageSource, box: { x: number; y: number; w: number; h: number }, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  // `box` viene en unidades canónicas (lienzo de 1008): se escala igual que en
  // `logoMask` para que el sticker caiga donde estaba el logo.
  ctx.scale(width / CARD_TEXTURE_WIDTH, width / CARD_TEXTURE_WIDTH);
  ctx.drawImage(logo, box.x, box.y, box.w, box.h);
  return canvas;
}

/**
 * @deprecated Ya no se usa. El contraluz dejó de ser un disco detrás de la carta y
 * pasó al shader del resplandor (glowFragmentShader), un plano mayor que la carta que
 * solo enciende el anillo exterior y deja el arte intacto.
 *
 * Se deja la función porque describe el razonamiento —un disco emisivo sí tiene
 * píxeles, una luz detrás no ilumina nada visible a este tamaño— y porque revivirla
 * es la salida si se quiere volver a un resplandor suelto.
 */
export function backlightGlow(color: string, size = 256): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, rgba(color, 0.85));
  gradient.addColorStop(0.35, rgba(color, 0.4));
  gradient.addColorStop(0.68, rgba(color, 0.12));
  gradient.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
