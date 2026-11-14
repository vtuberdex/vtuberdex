// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * Ensambla las 7 capas y publica la info de layout medida.
 */
import {
  CARD_TEXTURE_WIDTH,
  CARD_TEXTURE_HEIGHT,
  FONT,
  HEADER,
} from "./dimensiones";
import type { CardDrawInfo, CardLayers } from "./tipos";
import { createLayer, emptyLayer } from "./lienzo";
import { drawSurfaceLayer } from "./capa-superficie";
import { drawCharacterLayer } from "./capa-personaje";
import { drawTitleLayer } from "./capa-titulo";
import { drawWordmarkLayer } from "./capa-wordmark";
import { CHIP_ROW_HEIGHT, chipRowsFor } from "./capa-tags";
import { stateChipsFor } from "./capa-textos";
import {
  deteriorarArte,
  deteriorarCabecera,
  deteriorarCanto,
  planDeCarta,
  tarjetaParaTitulo,
} from "./deterioro";

/**
 * LOGO: ESQUINA INFERIOR DERECHA. El área base (4.9% de la carta) se escala por
 * `LOGO_SCALE_FACTOR`. Originalmente estaba al doble (factor 2); se redujo a 4/3
 * (2/3 del tamaño anterior) para que no compita con el personaje.
 */
const LOGO_SCALE_FACTOR = 4 / 3;

type LogoBox = { x: number; y: number; w: number; h: number };

/** Caja del logo con el área fija de la marca, pegada a la esquina inferior derecha. */
function logoBoxFor(
  logo: CardDrawInfo["logo"],
  { W, H, pad }: { W: number; H: number; pad: number },
): LogoBox | null {
  if (!logo) {
    return null;
  }
  const LOGO_AREA = W * H * 0.049 * LOGO_SCALE_FACTOR * LOGO_SCALE_FACTOR;
  const scaleLogo = Math.sqrt(LOGO_AREA / (logo.width * logo.height));
  const dw = logo.width * scaleLogo;
  const dh = logo.height * scaleLogo;
  return { x: W - pad - dw, y: H - pad - dh, w: dw, h: dh };
}

/** Un contexto 2D de prueba solo para medir texto; sin DOM (servidor, worker) no hay y se mide 0. */
function probeContext(): CanvasRenderingContext2D | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.createElement("canvas").getContext("2d");
}

/** Las filas de chips de tipos, medidas igual que las pinta `capa-tags.ts`. */
function measureChipRows(typesList: string[], maxWidth: number): string[][] {
  const probe = probeContext();
  return probe ? chipRowsFor(probe, typesList, maxWidth) : [];
}

/** Dónde acaba el último chip de estado (se necesita para posicionar otras capas). */
function stateChipsEndFor(stateChips: string[], pad: number): number {
  if (stateChips.length === 0) {
    return pad;
  }
  const probe = probeContext();
  if (!probe) {
    return pad;
  }
  probe.font = `700 24px ${FONT}`;
  let stateX = pad;
  for (const chip of stateChips) {
    const chipW = probe.measureText(chip).width + 30;
    stateX += chipW + 10;
  }
  return stateX - 10;
}

/** Estropea solo las capas recién dibujadas: las de `reutilizar` ya vienen estropeadas. */
function deteriorarLoNuevo(
  plan: NonNullable<ReturnType<typeof planDeCarta>>,
  reutilizar: CardDrawInfo["reutilizar"],
  capas: {
    fondo: HTMLCanvasElement;
    personaje: HTMLCanvasElement;
    titulo: HTMLCanvasElement;
    marca: HTMLCanvasElement;
  },
) {
  if (!reutilizar?.background) {
    deteriorarArte(capas.fondo, plan);
  }
  if (!reutilizar?.character) {
    deteriorarArte(capas.personaje, plan);
  }
  if (!reutilizar?.title) {
    deteriorarCabecera(capas.titulo, plan);
  }
  deteriorarCanto(capas.marca, plan);
}

/** Genera todas las capas y la información de layout medida. */
export function drawCardLayers({
  card,
  art,
  logo,
  background,
  width = CARD_TEXTURE_WIDTH,
  reutilizar,
}: CardDrawInfo): CardLayers {
  const W = CARD_TEXTURE_WIDTH;
  const H = CARD_TEXTURE_HEIGHT;
  const { pad, top: headerTop, height: headerH } = HEADER;
  const headerBottom = headerTop + headerH;
  const barY = H - 140;

  const typesList = [...card.factions, ...card.groups].slice(0, 4);
  const chipRows = measureChipRows(typesList, W - pad * 2);
  const typesHeight = chipRows.length * CHIP_ROW_HEIGHT + 12;
  const typesTop = barY - 22 - typesHeight;

  // Límite inferior de la frase.
  const phraseBottomLimit = barY - 22 - typesHeight - 26;

  const info: CardLayers["info"] = {
    W,
    H,
    headerTop,
    headerH,
    headerBottom,
    pad,
    logoBox: logoBoxFor(logo, { W, H, pad }),
    typesTop,
    typesRight: pad,
    phraseBottom: phraseBottomLimit,
    stateChipsEnd: stateChipsEndFor(stateChipsFor(card), pad),
    barY,
  };

  /**
   * Cartas degradadas (grados 7…1): se estropea lo que se dibuja AQUÍ. Las capas que llegan por
   * `reutilizar` ya vienen estropeadas de la etapa rápida (`generarRapida`); tocarlas otra vez
   * duplicaría el daño. El wordmark es la capa de arriba y lleva el canto roto y los rayones.
   */
  const plan = planDeCarta(card);
  const fondo =
    reutilizar?.background ?? drawSurfaceLayer({ card, background, width });
  const personaje = reutilizar?.character ?? drawCharacterLayer({ art, width });
  const titulo =
    reutilizar?.title ??
    drawTitleLayer({ card: tarjetaParaTitulo(card), width });
  const marca = drawWordmarkLayer({ card, width });
  if (plan) {
    deteriorarLoNuevo(plan, reutilizar, { fondo, personaje, titulo, marca });
  }

  return {
    /**
     * CAPA 0: la SUPERFICIE de la carta, no una capa sobre ella.
     *
     * Antes esta capa era una imagen OPCIONAL que el shader componía encima de un degradado
     * de tema calculado en GLSL, y por eso el fondo se leía como una foto pegada: solo
     * actuaba donde `bgCover` (la cobertura calculada en el shader) la dejaba, y el material
     * de la carta seguía siendo el degradado del shader. Ahora el degradado y el arte viven
     * AQUÍ, en el mismo canvas opaco, y el shader los trata como el sustrato de la carta.
     */
    background: fondo,
    character: personaje,
    /**
     * La capa del logo se sirve VACÍA a propósito.
     *
     * POR QUÉ: el logo se dibuja DOS veces en la carta — esta capa (el arte de la marca
     * compuesto en la pila, con `mix()` sobre `base`, SIN el bloque de metal) y el
     * STICKER final (`logoSticker`, recompuesto encima con el brillo metálico, el
     * barrido, el contraste y el tinte frío/cálido). El usuario veía las dos: "una
     * tiene brillo metálico y la otra no", y la que no lo tiene es ésta.
     *
     * La marca la dibuja el sticker, que es el que lleva el acabado de la pieza; esta
     * capa solo aportaba una copia plana encima. Se deja el slot para no renumerar las
     * capas (`uLayer2` sigue existiendo y las posiciones de PARALLAX_LAYERS no cambian),
     * pero sin arte.
     *
     * OJO: `logoBox` sigue publicándose en `info` y se calcula más arriba, porque el
     * sticker y su máscara lo necesitan para saber DÓNDE va la marca.
     *
     * Se usa un canvas de 1x1 y no uno del tamaño de la carta: una capa VACÍA a
     * 1008x1411 ocupa ~5,7 MB de textura en la GPU por carta y no aporta nada. Al
     * muestrearla su alfa es 0 en todo el UV, que es justo lo que se busca. El slot
     * existe para no renumerar `uLayer2` ni las posiciones de PARALLAX_LAYERS.
     */
    logo: emptyLayer(),
    title: titulo,
    /**
     * CAPAS 4 y 5 VACÍAS: los textos y los tags SALIERON de la carta 3D.
     *
     * Petición del usuario: "se deben eliminar todos los textos en blanco y las lineas y
     * tags, no se van a utilizar en el card 3d". Se van la frase, el pie, los chips de
     * estado (NIV / PODER / FICHA COMPLETA), los chips de facción y grupo y la barra de
     * stats.
     *
     * POR QUÉ VACÍAS Y NO ELIMINADAS: los índices no se pueden renumerar. `uLayer4` y
     * `uLayer5` existen en el shader y `PARALLAX_LAYERS` tiene sus posiciones; quitar los
     * slots desplazaría el wordmark de la capa 6 a la 4 y rompería el shader entero. Se
     * sirve un canvas de 1x1 (alfa 0 en todo el UV, ~nada de VRAM) y los `mix()` de esas dos
     * capas quedan inertes por construcción.
     *
     * Los archivos `capa-textos.ts` y `capa-tags.ts` se conservan y se siguen exportando
     * desde `index.ts`: el trabajo está hecho y probado, y si algún día se quiere la carta
     * "completa" para otra vista (la 2D, un export, una miniatura) se recupera llamándolas.
     */
    texts: emptyLayer(),
    tags: emptyLayer(),
    wordmark: marca,
    info,
  };
}

/** Back-compat: una textura "flat" con todo mezclado para usos que aún no migran. */
export function drawCardFront(input: CardDrawInfo): HTMLCanvasElement {
  const width = input.width ?? CARD_TEXTURE_WIDTH;
  const { canvas, ctx, W, H } = createLayer(width);
  // Sin contexto 2D se devuelve el lienzo vacío (mismo contrato que el resto de capas).
  if (ctx) {
    const layers = drawCardLayers({ ...input, width });
    ctx.drawImage(layers.background, 0, 0, W, H);
    ctx.drawImage(layers.character, 0, 0, W, H);
    // (la capa `logo` se omite: va vacía; la marca la pinta el sticker del shader)
    ctx.drawImage(layers.title, 0, 0, W, H);
    // (las capas `texts` y `tags` se omiten: salieron de la carta 3D, van vacías)
    ctx.drawImage(layers.wordmark, 0, 0, W, H);
  }
  return canvas;
}
