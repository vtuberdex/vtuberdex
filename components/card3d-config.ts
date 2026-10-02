/**
 * Valores de la carta holográfica 3D. **Este archivo es el mando del efecto.**
 *
 * PARA QUÉ SIRVE
 * --------------
 * Todo lo que se pueda ajustar SIN reescribir la fórmula que lo usa vive aquí: las
 * intensidades, los pesos de mezcla, las constantes de los shaders, la geometría y
 * las luces de la escena. Quien quiera tocar el efecto abre este archivo y no
 * `shaders.ts` ni `holo-card.tsx`, que solo contienen el CÓMO. Un valor que se
 * repita en dos sitios es un valor que se desincroniza al primer cambio.
 *
 * UNIDADES
 * --------
 *   · `0..1`   intensidad, opacidad y pesos de mezcla.
 *   · `*`      multiplicadores sin unidades (ciclos de interferencia, escalas).
 *   · mundo    unidades de three.js: la carta mide `GEOMETRY.cardWidth` de ancho y
 *              su alto se deriva de la proporción real de la carta. No son píxeles.
 *
 * QUÉ MUEVE QUÉ (la confusión que costó varias vueltas)
 * ----------------------------------------------------
 * La **saturación** del arcoíris la decide `HOLOGRAM.layerWeight`, NO
 * `INTENSITY.holo`. `holo` apaga el holograma ENTERO —incluido el tono metálico que
 * hace que la carta parezca una lámina— mientras que `layerWeight` decide cuánto de
 * ese color se SUMA al arte, que es lo que se ve cargado.
 *
 * Este peso bajó a 0.03 razonando que el color era lo que lavaba la carta, y el
 * ajuste en vivo lo devolvió a 0.15 (cinco veces más): la medición por capas mostró
 * que el velo lo ponían el barniz (+40% de luminancia) y la tinta (+25%), no el
 * arcoíris (+0.8%). Con esas dos ya bajas, el peso SÍ puede subir y la lámina gana
 * presencia sin lavar nada. El orden de las perillas importa: primero `gloss` y
 * `EDGE.strength`, después `layerWeight`.
 *
 * DÓNDE VIVE CADA CAPA
 * --------------------
 * El detalle del pipeline (por qué cada capa va en modo luz, por qué el logo se
 * recompone al final, por qué el resplandor es un plano aparte) está en
 * `shaders.ts`. Aquí solo están los números.
 */

import { CARD_TEXTURE_HEIGHT, CARD_TEXTURE_WIDTH, FACTION_SOCKET, HEADER } from './card-texture/dimensiones';

/**
 * PALETA DEL ESPECTRO: de aquí sale el color de TODAS las capas holográficas.
 *
 * Va primero porque la comparten la lámina de la superficie, el borde metálico, el
 * tinte de cada emblema de facción y la tinta del lineart. Si cada capa tuviera su
 * propia paleta, el arcoíris no sería un solo efecto coherente.
 *
 * El color de una lámina holográfica NO se elige: sale del ORDEN DEL ESPECTRO. Las
 * paradas van de violeta (~380nm) a rojo (~700nm), y el shader interpola entre
 * paradas consecutivas, así que el tono recorre el arcoíris EN SECUENCIA: nunca salta
 * de verde a magenta, que es lo que delata a un holograma falso.
 *
 * `wavelengthToRgb` se GENERA desde esta lista (ver SPECTRUM_FN en `shaders.ts`): los
 * umbrales de cada tramo salen del número de paradas, así que añadir un color no
 * obliga a recalcularlos a mano. Los NOMBRES de las paradas viven en el shader: son
 * documentación del modelo, no una perilla.
 */
export const SPECTRUM = {
  /**
   * Paradas del espectro, en orden, de violeta a rojo. `name` es documentación: el
   * shader nombra así sus variables, para que la función generada se lea como el
   * modelo del espectro y no como una lista de c0..c5.
   */
  stops: [
    { name: 'violeta', rgb: [0.62, 0.22, 1.0] },
    { name: 'azul', rgb: [0.16, 0.34, 1.0] },
    { name: 'cian', rgb: [0.1, 0.92, 1.0] },
    { name: 'verde', rgb: [0.18, 1.0, 0.36] },
    { name: 'amarillo', rgb: [1.0, 0.94, 0.22] },
    { name: 'rojo', rgb: [1.0, 0.2, 0.16] },
  ],
  /**
   * Patrón espacial del foil (`spectralFoil`): cuánto pesa cada eje del UV y cuántas
   * franjas caben. Hace de variación de espesor de la lámina, que es lo que reparte el
   * arcoíris por la superficie en vez de dejarlo como un color plano.
   *
   * Es SUAVE a propósito: al multiplicar los ciclos el arcoíris se volvía visible por
   * toda la carta, que era el exceso de saturación que hubo que corregir.
   */
  foil: { x: 1.0, y: 0.7, cycles: 1.6 },
} as const;

/** Tamaño en unidades de mundo y proporción de la carta. */
export const GEOMETRY = {
  /** Ancho de la carta. El alto sale de la proporción real de la textura (1.4). */
  cardWidth: 2.2,
  /**
   * Proporción alto/ancho de la cara (1411/1008). Vive aquí —y no como un literal en
   * `holo-card.tsx`— porque el CUERPO 3D también la necesita para insetar el bisel, y el
   * harness construye la misma geometría que el componente: una copia divergente haría que
   * la medición del canto no valiera.
   */
  aspect: 1411 / 1008,
  /**
   * Grosor del cuerpo: es lo que da el CANTO.
   *
   * 0.035 era una lámina casi plana (1.6% del ancho) y al inclinarla no se veía
   * canto alguno; 0.075 le da presencia de objeto sin volverla un ladrillo.
   *
   * Subido a 0.11 (petición del usuario: "dale un borde biselado"): con 0.075 y el bisel
   * anterior la arista medía 3.1 px en pantalla y no se distinguía de un slab recto.
   */
  cardDepth: 0.11,
  /**
   * Radio de las esquinas. Lo comparten la máscara del shader (que recorta la
   * textura) y la geometría del cuerpo: si divergieran, el canto asomaría por las
   * esquinas de la cara.
   */
  cornerRadius: 0.16,
  /**
   * Bisel del canto, como fracción del grosor. Al redondearlo (ver
   * `bevelSegments`) la arista del canto se funde con la silueta.
   *
   * La forma se dibuja INSETADA por este tamaño porque el bisel EXPANDE la
   * geometría hacia fuera: a tamaño completo el cuerpo medía 2.2270x3.1066 contra
   * una cara de 2.2000x3.0796 (1,30 px de canto asomando por lado en la grilla y
   * 2,02 px en la ficha), y ese sobrante es geometría, no antialiasing.
   *
   * 0.18 daba una arista de 0.0135 unidades = 3.1 px en pantalla (medido), que NO se
   * distingue de un canto recto: por eso el bisel existía en la geometría y no se veía.
   * 0.38 lo lleva a 0.0418 u = 9.6 px, ya legible como chaflán con su degradado.
   */
  bevelRatio: 0.38,
  /** Segmentos del bisel: con 1 es un chaflán plano con arista visible. */
  bevelSegments: 4,
  /**
   * Segmentos de las esquinas curvas. Con 12, una esquina de radio 0.16 a 212 px
   * da ~1,3 px por segmento y el contorno se ve como un POLÍGONO. Es una geometría
   * por carta, no por frame, así que subirlo no cuesta.
   */
  curveSegments: 24,
  /**
   * Altura visible que ocupa la carta, como fracción del alto del encuadre: de ahí
   * sale la distancia de la cámara. A 0.98 (z=4.1) la carta se cortaba al
   * inclinarse; 0.8 deja margen para el tilt y la flotación.
   */
  cameraFill: 0.8,
  /** Campo de visión de la cámara, en grados. */
  cameraFov: 42,
  /** Plano del resplandor: cuántas veces la carta mide de lado. */
  glowSpread: 1.36,
  /** Z del plano del resplandor (negativo: detrás del cuerpo). */
  glowZ: -0.09,
  /** Separación de la cara frontal respecto del cuerpo, para evitar z-fighting. */
  faceZGap: 0.001,
} as const;

/**
 * Intensidades de entrada: las tres perillas globales del efecto.
 *
 * Estos valores salieron de AJUSTE EN VIVO con el panel de sliders (ver
 * `card3d-live.ts`), no de razonar sobre la fórmula: se movieron hasta que la carta se
 * vio bien sobre el arte real y de ahí se copiaron aquí. El recorrido importa porque
 * contradice la intuición: primero se bajó todo a 0.35/0.3 para que el efecto dejara de
 * comerse el arte, y al ajustar con los sliders el barniz SUBIÓ a 0.63 y el holograma a
 * 0.7. Lo que arregló el aspecto no fue apagar capas sino BAJAR las que suman luz por su
 * cuenta (`COMPOSITE.glossSelf`, `EDGE.strength`) y SUBIR el arcoíris: un holograma con
 * color y sin velo, en vez de un holograma apagado.
 *
 * `tile` sigue a `detail` a propósito: la carta de la grilla y la del detalle son la
 * misma carta, y tenerlas con valores distintos hace que el catálogo prometa algo que el
 * detalle no cumple.
 *
 * `noThemeFloor` es el PISO del holograma cuando la ficha NO tiene color de tema: sin
 * color no hay acento, así que el efecto se apaga casi del todo. Estaba escrito a mano
 * en `holo-card.tsx` (0.45) y era el único valor del holograma fuera de este archivo.
 *
 * OJO CON LA PERILLA (medido, no supuesto): bajar `holo` casi no cambia la carta. La
 * lámina iridiscente aporta Δmedio 2.75 y toca el 4.6% de los píxeles; lo que de verdad
 * carga la imagen es el barniz (`gloss`, 12.10 / 29.3%) y la capa de contraste
 * (`EDGE.strength`, 14.26 / 35.7%). Si la carta se ve "lavada", se toca `gloss` o
 * `EDGE.strength`, NO `holo`.
 */
export const INTENSITY = {
  holo: { default: 0.3, tile: 0.3, detail: 0.3, noThemeFloor: 0.45 },
  gloss: { default: 0.5, tile: 0.5, detail: 0.5 },
} as const;

/** Capa holográfica: interferencia de película delgada. */
export const HOLOGRAM = {
  /**
   * Peso del color espectral que se SUMA al arte. Es la perilla de la SATURACIÓN (ver
   * la cabecera): 0.12 -> 0.06 -> 0.03 razonando, y 0.15 al ajustar en vivo, que es
   * donde la lámina tiene color sin velar el arte.
   */
  layerWeight: 0.1,
  /** Fracción del espectro que se desplaza según el ángulo de visión. */
  viewAngleWeight: 1.5,
  /** Variación ESPACIAL del espesor: es lo que reparte las franjas por la lámina. */
  surfaceX: 1.1,
  surfaceY: 0.8,
  /** Desplazamiento del conjunto por inclinación de la carta y por tiempo. */
  tiltShift: 1.4,
  timeShift: 0.05,
  /** El espectro se desatura hacia su propia luminancia para bajar el croma. */
  spectrumDesaturation: 0.42,
  /** Suelo metálico: una lámina real es metal pálido con el matiz encima. */
  metalGround: [0.87, 0.89, 0.93],
  metalFloorMix: 0.45,
  /**
   * Piso del holograma, sumado a la inclinación y al glare, recortado a 0..1.
   *
   * Ambos en su techo (1 y 3) por ajuste en vivo: son los que hacen que el efecto se
   * vea con la carta QUIETA. Con el piso en 0.25 la lámina solo aparecía al inclinar,
   * así que en la grilla —donde nadie inclina nada— la carta se veía casi opaca.
   */
  baseMask: 1,
  tiltFactor: 3,
  /** Barrido diagonal que sigue al puntero (el glare del holográfico). */
  glareRadius: 0.62,
  /**
   * Brillo del barrido del puntero, a su máximo.
   *
   * Pasó por 0.55 -> 0.25 -> 1.0. El 0.25 venía de razonar que el glare se SUMABA al
   * arcoíris y lavaba la carta con el puntero encima; medido, el culpable del velo era
   * el barniz, no el barrido. Con `glossSelf` y `EDGE.strength` bajos, el barrido
   * puede ir a tope: es lo que hace que la carta responda al ratón, y a 0.25 apenas se
   * notaba que estaba vivo.
   */
  glareStrength: 1,
} as const;

/**
 * Zona de la IMAGEN dentro de la carta, en UV (y0, y1).
 *
 * La textura es una sola pieza (arte + cabecera + chips + frase + barra), así que
 * sin acotar el efecto se teñiría también la UI. La banda se deriva del layout real
 * de `card-texture.ts`, no se elige a ojo: cabecera de 44 a 160 y pie desde
 * `altura - 140`.
 */
export const ART_ZONE = {
  top: (44 + 116 + 10) / 1411,
  bottom: (1411 - 140 - 34) / 1411,
  /** Ancho de la transición, para que el efecto no termine en un corte recto. */
  fade: 0.05,
} as const;

/**
 * SUPERFICIE de la carta: la imagen de fondo ES el material del mesh.
 *
 * CAMBIO DE ARQUITECTURA (petición del usuario: "el background tiene que ser la textura del
 * mesh de la carta, y no una capa sobre la carta")
 * ---------------------------------------------------------------------------------------
 * Esto se llamaba `BACKGROUND` y describía una CAPA: una imagen opcional dibujada por
 * debajo del personaje, con su propio holograma más marcado que el del frente y su propio
 * paralaje, para leerse como un plano a distinta profundidad. Ese diseño era justo el
 * defecto: por bien que se integrara el arte, mientras el fondo tuviera ACABADO PROPIO
 * seguía siendo una capa encima de la carta, y eso se ve.
 *
 * Ahora la imagen se pinta en la capa 0 —la que el shader usa como SUSTRATO de la carta— y
 * no existe ningún pase de composición para el fondo: recibe el MISMO barniz, la MISMA
 * lámina, el MISMO tinte de canto y el MISMO filo que todo lo demás, porque el acabado se
 * aplica una sola vez sobre la carta ya armada. Una placa, un material, un juego de
 * perillas (las de `HOLOGRAM`, `INTENSITY`, `GLOSS`...).
 *
 * LO QUE SE ELIMINÓ CON LA CAPA, Y DÓNDE ESTÁ AHORA
 * -------------------------------------------------
 *   · holo, layerWeight, glareStrength, glareRadius, tiltShift, timeShift, baseMask,
 *     tiltFactor, spectrumDesaturation, metalFloorMix, artFloor, artLumGain, edgeTint,
 *     edgeTintPower, edgeTintCycles, edgeTintFloor, parallax, overscanFactor, edgeStrength
 *     -> el acabado propio del fondo. Lo que se conserva de esa lista es solo lo que
 *     gobierna el ARTE (su encuadre y su relación con el color de tema), porque el efecto
 *     ya es el de la carta: perillas como "holograma del fondo" o "paralaje del fondo" no
 *     tienen sentido si el fondo es la superficie — un material no refleja ni se desplaza
 *     distinto según la imagen que tenga impresa.
 *   · Los uniforms uBgHolo, uBgLayerWeight, uBgGlareStrength, uBgBaseMask, uBgTiltFactor y
 *     uBgArtFloor se retiraron del shader, junto con el bloque `{...}` que los consumía.
 *
 * `BG_NOISE` NO se toca: es la micro-superficie de TODA la lámina (la comparten el fondo,
 * el metal del título y el pulido del filo), así que no pertenecía a esta capa.
 */
export const BACKGROUND = {
  /**
   * ESCALA del arte dentro de la carta (cuanto se agranda la imagen).
   *
   * CON PARALAJE HACE FALTA MARGEN, y por eso sube de 1 a 1.25.
   *
   * La capa 0 vuelve a desplazarse con el puntero (`PARALLAX_LAYERS[0].factor`), y ese
   * desplazamiento ocurre en UV: si la textura cubriera la carta JUSTA (cover 1), al mover
   * el puntero el muestreo se saldria de [0,1] y ClampToEdge estiraria el borde en una
   * banda visible. El margen de 1.25 deja un 12,5% por lado, de sobra para un
   * desplazamiento del 4% (0.04 en UV con el puntero a tope).
   *
   * De paso, el arte llega mas a sangre en los bordes de la carta (recorta mas la imagen).
   */
  cover: 1.25,
  /**
   * Intensidad de la lamina holografica SOBRE LA CAPA 0.
   *
   * El usuario pidio el fondo "holografico y FUERTE": con una imagen suave (un acuario) el
   * arcoiris global no se marca, asi que esta es la perilla que le da presencia propia.
   * 0.9 con `baseMask` 1.8 y `tiltFactor` 4.0 satura la mascara en casi toda la carta.
   */
  holo: 0,
  /**
   * Cuanto de la lamina espectral se SUMA al canal de luz.
   *
   * Es el peso del pase local del fondo. Va aparte de `HOLOGRAM.layerWeight` (el global)
   * porque el fondo necesita MAS lamina que el resto: es la superficie grande de la carta
   * y el unico sitio donde el arcoiris tiene espacio para leerse.
   */
  layerWeight: 0.75,
  /**
   * Piso de la holografia del fondo: el efecto se ve con la carta QUIETA, no solo al
   * inclinarla. 1.8 mantiene la mascara alta en reposo.
   */
  baseMask: 1.8,
  /**
   * Cuanto responde el holograma del fondo a la inclinacion. Alto (4.0) porque el acuario
   * no aporta metal propio y sin el tilt el arcoiris quedaria plano.
   */
  tiltFactor: 4.0,
  /**
   * CUANTO RESPETA EL ARTE la lamina del fondo.
   *
   * EN 0: la lámina cae UNIFORME sobre todo el fondo, sin mirar la imagen.
   *
   * ESTO ES LO QUE ARREGLA EL "SOLO SE VE EN UN PEDAZO". Estaba en 1, y con 1 la lámina se
   * multiplicaba por la luminancia del arte (`clamp(artLum * artGain)`). En una imagen con
   * zonas oscuras —un acuario, con el agua en sombra— eso apaga el holograma justo donde el
   * arte es oscuro, o sea en la mayor parte del fondo, y solo lo enciende en los parches
   * claros. Se veía como manchas de brillo, no como una lámina.
   *
   * El foil de una carta holográfica real (una Pokémon) NO depende del dibujo: es un grabado
   * que cubre la superficie entera y se ve igual sobre las zonas claras y las oscuras. Por
   * eso 0: la lámina se reparte por todo el fondo y el arte queda debajo, intacto.
   *
   * La imagen se conserva INTACTA de todos modos: el arte vive en el canal de pigmento y la
   * lámina se SUMA en el canal de luz. Nunca se multiplican. Subir esta perilla vuelve al
   * comportamiento modulado (útil si algún día el fondo es una foto muy plana), pero para
   * una lámina tipo carta holográfica el valor es 0.
   */
  artFloor: 0,
  /**
   * GANANCIA de esa modulación por luminancia.
   *
   * Solo tiene efecto si `artFloor` > 0 (con 0 el mix devuelve 1 y esta ganancia no entra).
   * Se conserva viva en vez de retirarla porque es la otra mitad de la misma perilla.
   */
  artGain: 1.6,
  /* --- FOIL DEL FONDO: el grabado arcoíris tipo carta holográfica --- */
  /**
   * FRECUENCIA del patrón del foil por eje del UV. Es lo que hace que el arcoíris se lea
   * como franjas repartidas y no como un color plano.
   *
   * CONTRASTE CON EL GLOBAL: `SPECTRUM.foil.cycles` está en 1.6 a propósito (que el arcoíris
   * no se vea por toda la carta). El fondo necesita lo contrario —el patrón ES el efecto—,
   * así que aquí la frecuencia es alta: 3.2 + 2.6 dan unas cinco franjas diagonales sobre la
   * carta, que es la densidad a la que un foil se lee como grabado y no como un degradado.
   */
  foilX: 3.2,
  foilY: 2.6,
  /**
   * Ciclos del espectro por ángulo de visión: al inclinar la carta, el arcoíris recorre el
   * patrón. Es la mitad "viva" del foil, la que responde al movimiento.
   */
  foilViewAngle: 2.4,
  /**
   * Desaturación del espectro del fondo.
   *
   * Un foil real no muestra color puro: es metal pálido con el matiz por encima. 0.35 baja el
   * croma sin apagar el arcoíris (el global usa 0.42, más gris, porque allí el color tenía
   * que ser casi testimonial).
   */
  foilDesaturation: 0.35,
} as const;

/**
 * NO HAY PERILLAS DE BRILLO DEL ARTE, Y ES DELIBERADO.
 *
 * Aquí vivían `artFloor` y `artLumGain`, que modulaban el efecto del fondo por la
 * luminancia del arte ("un fondo oscuro no puede encenderse como uno claro"). Con el fondo
 * como superficie esa modulación desapareció —el acabado es el de la carta, no el suyo— y
 * las dos claves quedaron sin ningún lector: el shader no las consumía y el canvas de la
 * superficie solo necesita el encuadre.
 *
 * Se BORRAN en vez de dejarlas documentadas porque una perilla que nadie lee es peor que
 * ninguna: invita a moverla, no hace nada y hace dudar de si el efecto está roto. (El repo
 * ya tiene un caso así, `BACKGROUND.edgeStrength`, que se dejó con una nota larga
 * explicando por qué no servía.)
 *
 * Si algún día hace falta ajustar el brillo del arte, el sitio es `drawSurfaceLayer`, donde
 * se pinta: ahí se puede aplicar en CPU sobre el canvas, que es lo que el shader ya no ve.
 */


/**
 * HDR: reflejos que PASAN de blanco y se comprimen, en vez de recortarse en plano.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * Un framebuffer RGBA8 no guarda nada por encima de 1.0: cualquier valor mayor se
 * RECORTA al mismo blanco puro. Eso es justo lo que hace que un reflejo parezca
 * pintura: la luz tiene un techo duro, así que el brillo no tiene "centro" — toda la
 * zona brillante es exactamente igual de blanca y se lee como una mancha plana. En una
 * foto de verdad (nubes a contraluz, un canto metálico) las luces tienen rango: el
 * núcleo llega a blanco puro y alrededor BAJA de forma gradual, conservando el color.
 *
 * CÓMO SE HACE SIN CAMBIAR EL FONDO DE CANVAS
 * -------------------------------------------
 * Se calcula en HDR (los términos de LUZ pueden pasar de 1.0) y se comprime al final con
 * un codo suave, todo dentro del shader. No hace falta framebuffer flotante: lo que da
 * el aspecto es que la compresión ocurra DESPUÉS de sumar la luz, no que la suma se
 * recorte.
 *
 * `knee` es la clave de que esto no estropee la carta: por debajo de ese valor el color
 * sale IDÉNTICO, sin tocar. Solo lo que pasa del codo se comprime. Es decir, el arte y
 * los tonos medios se quedan como estaban y lo único que cambia son las luces — que es
 * exactamente lo que se pidió.
 */
export const HDR = {
  /**
   * Cuánto se multiplican SOLO los términos de luz (reflejo del metal, destello del
   * canto, barniz y holograma). Es lo que lleva los reflejos por encima de 1.0 para que
   * el límite tenga algo que comprimir. Con 1.0 no hay HDR: los reflejos quedan como
   * antes.
   */
  highlightBoost: 0.8,
  /**
   * TECHO DE LA LUZ: lo máximo que puede sumar el canal de luz sobre el arte.
   *
   * POR QUÉ ES UN TECHO Y NO UN CODO (fallo medido, con un fondo claro)
   * -----------------------------------------------------------------
   * La primera versión comprimía el color YA SUMADO, con un codo en 0.75. Sobre un fondo
   * oscuro funcionaba, pero con una imagen CLARA el arte queda por encima del codo y la
   * compresión se lo come: medido con un cielo de nubes (arte ~212/255), bajar el codo a
   * 0.45 dejaba el cielo en 206 y a 0.25 en 186 — es decir, el HDR OSCURECÍA la imagen en
   * vez de darle brillo. El usuario lo describió como "no veo los reflejos HDR" y tenía
   * razón: no había brillo que ver.
   *
   * La luz se comprime ahora en su PROPIO canal, empezando en 0 y sin zona de identidad,
   * así que:
   *   · el ARTE nunca se toca (por claro que sea el fondo, no se oscurece), y
   *   · las luces siguen teniendo un rolloff suave en vez de recortarse en plano.
   * Es lo que hace el HDR de verdad: comprime el rango de LUZ sobre un soporte intacto.
   */
  lightCeiling: 3.0,
  /**
   * Rango del rolloff. Con el techo en el denominador, un valor de 1 mantiene la parte
   * baja CASI lineal (la luz pequeña pasa tal cual) y lleva el resto al techo. Subirlo
   * hace la caída más suave y conserva más medios tonos de luz; bajarlo aplasta antes.
   */
  headroom: 1.15,
} as const;

/**
 * REFLEJO DE ESPEJO DEL METAL (environment mapping con el arte subido).
 *
 * QUÉ PIDIÓ EL USUARIO
 * --------------------
 * "las cosas que tienen textura metálica deberían tener reflejo tipo espejo con la imagen
 * que te adjunté". La imagen es un CIELO CON NUBES: un mapa de entorno, no decoración. Lo
 * que se pide es que el metal REFLEJE esa imagen — que las nubes aparezcan DENTRO del
 * acero, deformadas por la superficie, como en un pulido real.
 *
 * CÓMO, SIN GASTAR UN SAMPLER
 * ---------------------------
 * El cielo no es un plano de la carta: es un ENTORNO. Así que no se proyecta en UV de
 * pantalla (eso daría un calco pegado encima) sino con una proyección de esfera: se toma
 * la normal de la superficie y se refleja la dirección de vista, y de la dirección
 * resultante (x, y) se saca un UV del cielo. Las nubes así CURVAN con el ángulo, que es lo
 * que hace que se lea como espejo y no como calcomanía.
 *
 * El truco para no gastar presupuesto: el FONDO de la carta ya es una textura enlazada
 * (uLayer0). El metal refleja EL FONDO. Cero samplers nuevos, y el reflejo usa exactamente
 * la imagen que el usuario subió.
 *
 * La perturbación de la normal (abollado) es lo que rompe el espejo perfecto en facetas
 * irregulares: sin ella el material parece plástico brillante, no acero pulido.
 */
export const METAL_REFLECT = {
  /** Fuerza del reflejo sobre el metal (0 = metal mate, 1 = espejo pleno). */
  strength: 0.1,
  /**
   * Abollado de la superficie: cuánto se desvía la normal antes de reflejar. Es lo que da
   * el aspecto de acero cepillado/pulido con micro-facetas en vez de un espejo de baño.
   */
  bump: 0.32,
  /** Escala del abollado en UV: más alto = facetas más pequeñas y densas. */
  bumpScale: 0.55,
  /**
   * REFUERZO del reflejo. El metal se modula (su color x el entorno), así que con 1.0 el
   * reflejo es literal y puede salir apagado. Este valor devuelve el brillo para que el
   * entorno se lea dentro del metal sin lavar su color.
   */
  gain: 1.35,
  /**
   * MAPA DE ENTORNO: la imagen que el metal refleja.
   *
   * POR QUÉ ES UNA IMAGEN APARTE Y NO EL FONDO DE LA CARTA
   * -----------------------------------------------------
   * El reflejo estuvo leyendo uLayer0 (el fondo del VTuber) para no gastar un sampler, y
   * estaba mal por dos motivos: (1) si el VTuber no tiene fondo subido, esa capa está vacía
   * y el metal salía NEGRO — medido, exactamente el caso de "si el background no existe,
   * que lo deje transparente"; y (2) aunque hubiera fondo, el metal reflejaba el ARTE del
   * personaje (un pulpo), no un cielo.
   *
   * Un reflejo describe DÓNDE ESTÁ el metal, no qué hay impreso detrás, así que su imagen es
   * una foto de cielo propia. El archivo es components/metal-env.webp y lo IMPORTA el
   * componente (next/image-types declara el módulo), así que viaja en el bundle: no puede
   * vivir en public/ porque public/ está en .gitignore y el asset no llegaría al deploy.
   *
   * Es un sampler más: el presupuesto queda en 15 de los 16 que admite el driver (contado
   * sobre el programa enlazado en el harness, no sobre las líneas del fuente).
   */
  /**
   * GRIS MEDIO del mapa de entorno (0-1), MEDIDO sobre la imagen real (210.6/255 = 0.826).
   *
   * El reflejo se divide por este valor para modular en torno a la luminancia del metal en
   * vez de blanquearlo. Si se cambia la imagen de entorno hay que volver a medirlo: es su
   * luminancia media, no una constante de estilo.
   */
  envMean: 0.826,
  /**
   * Énfasis de curvatura: cuánto se abre el reflejo al alejarse del centro de la carta.
   * Subirlo exagera el efecto de superficie convexa (más "pulido y brillante"). Va aparte
   * del abollado porque son dos cosas distintas: uno es la forma de la pieza y el otro las
   * micro-facetas del pulido.
   */
  curvature: 0.042,
} as const;

/**
 * TEXTURA DE RUIDO DEL FONDO: la superficie del fondo deja de ser una lámina lisa.
 *
 * POR QUÉ RUIDO PROCEDURAL Y NO UNA TEXTURA DE RUIDO
 * --------------------------------------------------
 * Una textura de ruido costaría un sampler más, y el shader va por 14 de los 16 que
 * admite el driver: no hay margen que gastar en algo que se calcula con cuatro
 * operaciones. El ruido se genera con un hash, así que el presupuesto no se toca.
 *
 * CÓMO SE CONVIERTE EN "NORMAL"
 * -----------------------------
 * El ruido se trata como una ALTURA y se le saca el gradiente por diferencias finitas
 * (la altura en el píxel y en dos vecinos). Ese gradiente es la inclinación local de la
 * micro-superficie, o sea la normal. Sirve para lo que se ve en una lámina real: el
 * holograma deja de deslizarse uniforme y se rompe en facetas diminutas, porque cada
 * punto refleja con un ángulo ligeramente distinto. Es lo que quita el aspecto de
 * plástico pulido.
 */
export const BG_NOISE = {
  /**
   * Frecuencia del ruido. Bajo = manchas grandes y suaves; alto = grano fino. Sobre una
   * carta de ~400 px en pantalla, por debajo de ~4 se ven borrones y por encima de ~30
   * se convierte en sémola que parpadea al mover la carta.
   */
  scale: 11.0,
  /**
   * Octavas del fractal. Cada octava suma un detalle más fino: con 1 queda un ruido
   * blando y aburrido; con 4+ el detalle fino aliasea en movimiento (cuesta 4x por
   * píxel). 3 es el punto donde se ve textura sin hervir.
   */
  octaves: 3,
  /** Amplitud de la primera octava y cuánto decae cada siguiente. */
  ampStart: 0.5,
  persistence: 0.5,
  /** Cuánto se multiplica la frecuencia en cada octava (lacunaridad). */
  lacunarity: 2.0,
  /**
   * Tope de octavas del bucle. GLSL ES 1.00 exige que un `for` tenga una cota COMPARABLE
   * CON UNA CONSTANTE (un literal o una constante de compilación): con una condición
   * dinámica el shader NO compila. Por eso el bucle corre hasta este tope y dentro se
   * sale con un `break` cuando se alcanzan las octavas pedidas — la cota literal satisface
   * al compilador y el break da el comportamiento variable. Si subes `octaves` por encima
   * de este número, las octavas de más no se calculan.
   */
  maxOctaves: 6,
  /**
   * Suelo de la normalización del fractal. Evita dividir por un número diminuto (que
   * dispararía el resultado) cuando las amplitudes se anulan.
   */
  normFloor: 0.001,
  /**
   * Perturbación MÁXIMA de la fase del holograma, en unidades de UV.
   *
   * OJO: esta perilla NO es un multiplicador arbitrario. El gradiente del ruido se acota
   * a (-1,1) con una compresión suave, así que este número es literalmente cuánto puede
   * desplazarse la fase del espectro — predecible e independiente de la escala del ruido.
   *
   * Medido (barrido sobre el render real, con el fondo y el personaje como testigos):
   *
   *   fuerza   cambio en el FONDO   cambio en el PERSONAJE
   *   0.02     0.64                 0
   *   0.035    1.07                 0
   *   0.06     1.84                 0
   *   0.09     2.74                 0
   *   0.13     3.89                 0
   *
   * El personaje queda en 0 en TODOS los valores: el ruido no lo toca nunca, que es lo
   * que se pedía (textura en el fondo, no en la carta). Se elige 0.07 por estar en la
   * zona donde la textura ya se ve sin que el espectro empiece a plegarse: con 0.55
   * (cuando esta perilla multiplicaba un gradiente SIN acotar) el fondo se convertía en
   * un mapa de curvas de nivel psicodélico.
   */
  normalStrength: 0.1,
  /**
   * Paso de las diferencias finitas para el gradiente. Más fino = más detalle pero más
   * sensible al aliasing; más grueso = facetas más amplias.
   */
  gradientStep: 0.004,
  /**
   * Peso del relieve dentro de la fase. Se deja en 1 porque la magnitud ya la fija
   * normalStrength: tener dos multiplicadores para lo mismo solo hace imposible saber
   * cuál manda. Existe para poder apagar el efecto desde un solo sitio si hiciera falta.
   */
  phaseFromNormal: 1.0,
  /** Deriva temporal: el ruido se mueve despacio, así que la textura no está congelada. */
  drift: 0.02,
} as const;

/**
 * ACABADO DEL TEXTO de la carta: la placa metálica del título, la palabra del pie y
 * el realce de las letras.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN `card-texture.ts`
 * -------------------------------------------
 * Este módulo no importa NADA (ni `lib/color`), así que poner aquí los números no
 * crea ciclo con `card-texture.ts`, que pasa a importar la config. Y es la regla del
 * repo: todo valor ajustable vive aquí y el dibujo contiene solo el CÓMO.
 *
 * CÓMO SE HACE METAL EN UN CANVAS 2D (la técnica, no el gusto)
 * ------------------------------------------------------------
 * El metal no es un color: es un GRADIENTE DE MUCHAS PARADAS con dos filos. Un metal
 * pulido devuelve el entorno, así que tiene una banda clara pegada al borde superior,
 * el cuerpo medio, un segundo brillo ancho en el centro y una línea oscura al fondo.
 * Con dos paradas (claro/oscuro) se consigue plástico brillante; con las siete de
 * `metalStops` se consigue una lámina. El bisel (`bevelLight`/`bevelDark`) es lo que
 * la convierte en un objeto con ESPESOR: el filo claro arriba y la línea oscura abajo
 * son lo que el ojo lee como canto.
 *
 * El metal NO se inventa un color propio de marca: se tiñe con `brandTint` del acento
 * del VTuber, porque una placa de acero puro en una carta con identidad fuerte se lee
 * como un elemento pegado de otra carta.
 */
export const TEXT_FINISH = {
  /**
   * Paradas del metal de la placa del título, de arriba (0) a abajo (1).
   *
   * Las dos primeras y las dos últimas están JUNTAS a propósito: el salto de `9aa3b2`
   * a `f2f6fb` en el 8% del alto es el filo del bisel, y el de `b6bdc9` a `7f8896` en
   * el 15% final es la sombra del canto inferior. Separarlas mata el efecto.
   */
  metalStops: [
    { at: 0.0, color: '#7d8797' },
    { at: 0.08, color: '#ffffff' },
    { at: 0.24, color: '#b9c1cf' },
    { at: 0.5, color: '#f6f8fc' },
    { at: 0.72, color: '#cfd6e1' },
    { at: 0.9, color: '#8b95a4' },
    { at: 1.0, color: '#aab3c1' },
  ],
  /**
   * Cuánto se tiñe el metal con el color de marca. Bajo a propósito: por encima de
   * ~0.5 el acero deja de leerse como metal y vuelve a ser una placa de color.
   */
  brandTint: 0.22,
  /**
   * Barrido diagonal del metal: una banda ancha y otra estrecha, ambas casi
   * transparentes. Es lo que distingue una lámina de un degradado plano.
   */
  sheen: [
    { at: 0.0, alpha: 0.0 },
    { at: 0.3, alpha: 0.3 },
    { at: 0.45, alpha: 0.0 },
    { at: 0.62, alpha: 0.22 },
    { at: 1.0, alpha: 0.0 },
  ],
  /** Bisel de la placa: filo claro arriba y línea oscura abajo, en px del lienzo. */
  bevel: { light: '#ffffff', lightAlpha: 0.5, dark: '#0a0c11', darkAlpha: 0.38, width: 2 },
  /**
   * GRABADO del texto oscuro sobre el metal: una copia clara desplazada hacia abajo
   * hace que la letra parezca hundida en la placa. El desplazamiento va hacia ABAJO
   * (la luz viene de arriba) y es corto: con más de 2 px la letra se ve borrosa.
   */
  engrave: { color: '#ffffff', alpha: 0.42, offsetY: 1.4, blur: 1.2 },
  /**
   * Número de dex en BLANCO (petición del usuario). Iba en casi negro (#0a0c11).
   *
   * Sobre la placa de acero del badge una letra blanca necesita contorno oscuro para no
   * desaparecer: la placa tiene paradas claras (#a3adbd) y blancas donde el blanco puro no
   * contrasta. El grabado (`engrave`) ya no sirve aquí —hundía una letra oscura—, así que la
   * legibilidad la da este contorno, con el mismo criterio que el sombreado del resto de la
   * carta. El contorno es fino (1.6 px a 1008 de ancho) para que no se lea como una letra
   * "hinchada".
   */
  badgeColor: '#ffffff',
  badgeOutlineColor: '#0a0c11',
  badgeOutlineAlpha: 0.5,
  badgeOutlineWidth: 1.6,
  /**
   * Placa del número de dex: acero más oscuro que la cabecera, para que el `#002`
   * se lea como una pieza distinta y no como parte del mismo bloque.
   */
  /**
   * Acero OSCURO del engarce donde se encastra cada emblema de facción (cabecera). Casi negro con
   * un filo claro arriba: es lo que hace legible el holograma del emblema con cualquier color de
   * marca (sobre acero claro teñido de rojo, o sobre una placa oscura, un emblema de luz se perdía).
   */
  emblemSocketStops: [
    { at: 0.0, color: '#3b414d' },
    { at: 0.1, color: '#7a8496' },
    { at: 0.3, color: '#171b22' },
    { at: 0.85, color: '#0b0d12' },
    { at: 1.0, color: '#262c36' },
  ],
  badgeStops: [
    { at: 0.0, color: '#4a5260' },
    { at: 0.08, color: '#a3adbd' },
    { at: 0.42, color: '#616a79' },
    { at: 0.82, color: '#39404c' },
    { at: 1.0, color: '#525b69' },
  ],
  /**
   * MARCA del pie (VTUBERDEX): metálica SOLO EN LAS LETRAS.
   *
   * No se puede rellenar el texto con un gradiente y ya —eso daría una letra plana—:
   * se dibuja el mismo texto tres veces, la copia oscura desplazada ABAJO, la clara
   * desplazada ARRIBA y encima la del gradiente. Lo que asoma por los lados de esa
   * última es el bisel, y es lo que hace que la palabra parezca una pieza de metal
   * recortada en vez de una tipografía con color.
   */
  wordmark: {
    stops: [
      { at: 0.0, color: '#6f7887' },
      { at: 0.12, color: '#ffffff' },
      { at: 0.34, color: '#98a1b0' },
      { at: 0.56, color: '#e6ebf3' },
      { at: 0.78, color: '#7d8797' },
      { at: 1.0, color: '#bcc4d0' },
    ],
    brandTint: 0.26,
    bevelDarkOffset: 1.8,
    bevelDarkAlpha: 0.9,
    bevelLightOffset: -1.3,
    bevelLightAlpha: 0.55,
  },
  /**
   * SOMBRA NEGRA de las letras blancas de la carta.
   *
   * El texto del pie y la frase se dibujan en `#e8ecf5` casi opaco y, sobre un fondo
   * subido con imágenes claras (mar, nieve, cielos), desaparecían. La sombra es negra
   * y va desplazada abajo-derecha, que es la dirección de la luz del bisel del metal,
   * para que toda la carta parezca iluminada desde el mismo sitio.
   *
   * `blur` corto: por encima de ~8 px la letra blanca se ensucia.
   */
  shadow: { color: '#000000', alpha: 0.95, blur: 8, offsetX: 3, offsetY: 3 },
} as const;

/**
 * REFLEJO VIVO DEL METAL: el barrido que sigue al puntero sobre el título y el wordmark.
 *
 * EL PROBLEMA QUE RESUELVE (y por qué no podía hacerse donde parecía natural)
 * --------------------------------------------------------------------------
 * El metal de `TEXT_FINISH` se pinta en canvas 2D y se SUBE COMO TEXTURA. Un gradiente
 * de canvas es un cálculo por píxel ya resuelto: queda congelado en los píxeles de la
 * capa. Por eso el brillo del título estaba QUIETO — no era un ajuste mal puesto, era
 * el sitio equivocado. Ningún valor de `TEXT_FINISH` puede hacer que ese reflejo se
 * mueva, porque a esas alturas ya no hay nada que recalcular.
 *
 * La pieza que sí puede moverse es la del SHADER, que se reevalúa en cada frame y tiene
 * `uPointer` y `uTilt`. Lo que hace este bloque es SUPERponer una banda de luz viva
 * sobre la placa ya pintada: la textura aporta el acero (sus paradas y su bisel) y el
 * shader aporta el reflejo que barre. Sumadas se leen como una sola lámina.
 *
 * Se aplica a las capas 3 (título) y 6 (wordmark) enmascarado por SU PROPIO ALFA: solo
 * las letras y la placa llevan el barrido, nunca el hueco entre ellas. Si se aplicara a
 * toda la carta, el reflejo mancharía al personaje y al fondo.
 */
export const LIVE_SHEEN = {
  /**
   * Peso global del reflejo vivo. Es una perilla de verdad y no un adorno: con 0 el
   * barrido desaparece y se conserva solo el metal pintado en la textura, que es
   * exactamente la comparación que hace falta para MEDIR el efecto (mismo puntero, misma
   * carta, único cambio el barrido). Sin este conmutador, cualquier A/B queda contaminado
   * porque uPointer también mueve el paralaje de las 7 capas y el glare del holograma.
   */
  strength: 0.17,
  /**
   * Centro del recorrido, en la coordenada del barrido.
   *
   * POR QUÉ HACE FALTA UN CENTRO: la coordenada del reflejo NO está centrada en 0. Lleva
   * la inclinación (vUv.y * slant), así que su rango sobre la carta va de -0.69 a +0.19,
   * con el medio en -0.25. Sin desplazarlo, medio recorrido del ratón se gastaba en sacar
   * la banda por arriba del lienzo y el reflejo DESAPARECÍA con el cursor en un lado —
   * medido: con el puntero al extremo el diff era exactamente 0.
   *
   * El valor sale de dónde está el metal de verdad en la carta (la placa arriba y el
   * wordmark abajo), no del centro geométrico: medido, la zona útil va de -0.35 a +0.5.
   */
  centerOffset: 0.05,
  /**
   * Cuánto acompaña el barrido al puntero.
   *
   * MEDIDO, no elegido a ojo: la zona útil de la coordenada mide ~0.85 de ancho, así que
   * el recorrido total del barrido debe ser aproximadamente eso (0.42 por lado) para que
   * el ratón lleve el reflejo de un canto al otro SIN sacarlo de la carta. Con 1.0 la
   * banda se salía y el reflejo desaparecía en los extremos.
   */
  pointerTravel: 0.45,
  /**
   * Inclinación de la banda. Un reflejo vertical puro no lee como metal (parece una
   * columna de luz); inclinada acompaña la diagonal de la placa.
   */
  slant: 0.38,
  /**
   * Cuánto la mueve el GIRO de la carta, además del puntero. No es redundante: girar sin
   * mover el ratón también tiene que correr el reflejo, o la carta parece una calcomanía.
   */
  tiltTravel: 0.22,
  /**
   * Dos bandas: una ANCHA y tenue (el cuerpo del reflejo) y otra ESTRECHA y fuerte (el
   * filo especular dentro de ella). Con una sola se ve un degradado suave; el filo es lo
   * que da la sensación de superficie pulida. En unidades de UV.
   */
  wideWidth: 0.34,
  wideGain: 0.3,
  coreWidth: 0.1,
  coreGain: 0.55,
} as const;

/** Barniz: reflejo especular de una fuente blanda. */
export const GLOSS = {
  /** Centro de la fuente, desplazado por la inclinación (x: tilt.y, y: tilt.x). */
  lightDirX: 0.35,
  lightDirY: 0.75,
  tiltInfluence: 0.9,
  /** Cuán rápido cae el núcleo y su exponente. */
  coreTightness: 1.15,
  coreFalloff: 2.4,
  /** Franja alargada del reflejo: inclinación y ancho de la banda. */
  bandTiltX: 1.9,
  bandTiltY: 0.35,
  bandHalfWidth: 0.16,
  /** El brillo sigue al puntero, muy sutil. */
  pointerRadius: 1.5,
  pointerFalloff: 3.0,
  /** El canto (Fresnel) siempre brilla más: su exponente. */
  fresnelPower: 3.0,
  /**
   * Exponente del Fresnel de SUPERFICIE: decide cuánto arcoíris cobra el canto de la
   * lámina frente al centro de la carta. Es un valor DISTINTO del de arriba a
   * propósito (3.0 concentra el barniz en el filo; 2.2 reparte el espectro por más
   * superficie). Estaba suelto en el shader y se centralizó al auditar el holograma.
   */
  surfaceFresnelPower: 2.2,
  /** Peso de cada contribución dentro del barniz. */
  coreWeight: 0.75,
  bandWeight: 0.42,
  pointerWeight: 0.3,
  fresnelWeight: 0.35,
  /**
   * El brillo respeta el arte: sobre zonas ya claras aporta menos, o el resultado
   * se ve "lechoso" y arruina los colores planos.
   */
  highlightLuminanceFrom: 0.55,
  highlightLuminanceTo: 0.95,
  /**
   * Cuánto se frena el brillo sobre el arte claro. Subió de 0.35 a 0.5: en el detalle
   * las zonas claras del personaje son buena parte de la carta, y ahí el barniz es
   * donde más se notaba el aspecto lechoso.
   */
  highlightWeight: 0.4,
} as const;

/**
 * Posición de un emblema de facción en UV de la carta (origen abajo-izquierda), derivada de la
 * geometría de la cabecera. `indice` 1 es el de más a la derecha; el 0, el que va a su izquierda.
 *
 * `w` y `h` son DISTINTOS a propósito: el UV de la carta no es cuadrado (1008x1411), así que un
 * emblema cuadrado de N píxeles mide N/1008 de ancho y N/1411 de alto. Con el mismo valor en los
 * dos ejes el emblema salía estirado, que era invisible cuando eran grandes y decorativos y
 * saltaría a la vista en un engarce de 74 px.
 */
function ranuraDeCabecera(indice: 0 | 1) {
  const emblema = FACTION_SOCKET.size - FACTION_SOCKET.margin * 2;
  const centroDerecho = CARD_TEXTURE_WIDTH - HEADER.pad - FACTION_SOCKET.inset - FACTION_SOCKET.size / 2;
  const cx = centroDerecho - (1 - indice) * (FACTION_SOCKET.size + FACTION_SOCKET.gap);
  const cy = HEADER.top + HEADER.height / 2;
  return {
    x: cx / CARD_TEXTURE_WIDTH,
    y: 1 - cy / CARD_TEXTURE_HEIGHT,
    w: emblema / CARD_TEXTURE_WIDTH,
    h: emblema / CARD_TEXTURE_HEIGHT,
  };
}

/** Emblemas de facción, superpuestos como holograma. */
export const FACTION = {
  /**
   * Opacidad del emblema. Casi todos los PNG traen su interior en negro OPACO
   * (~30-45% del área), así que se pondera por el BRILLO del trazo y no solo por
   * el alfa: 0.75 hacía que los emblemas apenas se distinguieran sobre arte oscuro.
   */
  strength: 1.0,
  /**
   * Los DOS emblemas (máximo de facciones por VTuber) van en la CABECERA, a la derecha del
   * nombre y dentro de un engarce oscuro que pinta la textura (`capa-titulo.ts`).
   *
   * Antes eran cuatro emblemas grandes repartidos por la lámina. Se movieron a la cabecera por
   * petición del dueño; el engarce oscuro resuelve de paso el defecto de cartas rojas u oscuras,
   * donde un emblema de luz sobre el color de marca no se distinguía: sobre acero casi negro el
   * holograma se lee igual con cualquier color de marca.
   *
   * Con UNA sola facción se usa el slot 1 (el de la derecha): el emblema queda pegado al borde
   * de la placa y no deja un hueco a su derecha.
   */
  slots: [ranuraDeCabecera(0), ranuraDeCabecera(1)],
  /**
   * Parallax: cada emblema se desplaza con el puntero a distinta profundidad. Bajó de 0.02 a
   * 0.004: con emblemas de 74 px dentro de un engarce, 0.02 de UV son ~20 px y el emblema se
   * salía del engarce al mover el puntero.
   */
  pointerParallax: 0.004,
  /** Filtro del trazo por luminancia (el relleno oscuro del PNG no aporta nada). */
  strokeLow: 0.10,
  strokeHigh: 0.55,
  /** Latido desfasado por slot: los emblemas no pulsan al unísono. */
  pulseBase: 0.72,
  pulseAmplitude: 0.28,
  pulseSpeed: 1.5,
  pulsePhase: 1.9,
  pulseSurface: 5.0,
  /** Máscara: piso, cuánto sube con la inclinación y con el glare. */
  maskBase: 0.85,
  maskTilt: 1.0,
  maskGlare: 0.45,
  /** Tinte iridiscente propio de cada slot. */
  tintSpectrumMix: 0.7,
  tintUvScale: 0.9,
  tintPointer: 0.1,
  tintPhase: 0.2,
  /** Mezcla sobre el arte: tinte del propio color y luz añadida. */
  selfTint: 0.45,
  addedLight: 1.2,
} as const;

/**
 * Tinta y piel: el lineart y los tonos de piel encendidos como holograma.
 *
 * ALCANCE (cambio de arquitectura, petición del usuario): este realce va SOLO sobre el
 * fondo, NO sobre el personaje. La máscara es `edgeTex.a` invertida por la cobertura de
 * primer plano, así que en los píxeles del personaje el valor es 0 y allí no llega nada.
 *
 * POR QUÉ ANTES SÍ CAÍA EN EL PERSONAJE
 * -------------------------------------
 * `uEdgeMap` es la máscara de tinta y piel calculada en CPU (ver inkAndSkinMask): su ALFA es
 * la silueta del personaje y su RGB la intensidad del lineart. Multiplicar por ese alfa, como
 * se hacía, encendía el realce EXACTAMENTE sobre el personaje — lo contrario de lo pedido.
 *
 * Recorrido del valor: 0.6 -> 0.3 razonando (la mitad), y 0.1 al ajustar en vivo, cuando el
 * realce caía sobre el personaje y cualquier subida se leía como velo. Con el alcance
 * corregido al fondo, el usuario pidió 0.4: sobre el arte del fondo no lava al personaje, así
 * que admite mucha más intensidad que antes.
 */
export const EDGE = {
  strength: 0.5,

  /** El ángulo se desplaza: en el borde el corrimiento espectral es mayor. */
  angleOffset: 0.35,
  /** Espesor de la película: más ciclos que en la superficie. */
  filmThickness: 9.0,
  timeShift: 0.05,
  surfaceShift: 0.6,
  /** Máscara: piso (el efecto se ve con la carta quieta), tilt y glare. */
  maskBase: 0.55,
  maskTilt: 2.2,
  maskGlare: 1.2,
  maskCeiling: 1.6,
} as const;

/** Composición de las capas sobre el arte. */
export const COMPOSITE = {
  /**
   * Cada capa se suma al arte en modo luz (`base * (glossLayer + holoLayer)`) y además
   * aporta luz propia. Estos dos pesos son la parte "propia": el arte recibe las dos
   * capas al 100% (no hay perilla ahí: un factor distinto de 1 cambiaría el color del
   * arte, no la intensidad del efecto, y para eso está `layerWeight` en HOLOGRAM).
   */
  /**
   * La luz que el barniz añade por su cuenta, sin multiplicar por el arte. Es la que
   * se ve como un VELO sobre los colores (no la que da brillo, que va multiplicada):
   * bajó de 0.35 a 0.1 en el ajuste en vivo, la mitad del arreglo del aspecto lavado.
   */
  glossSelf: 0.15,
  holoSelf: 1,
} as const;

/** Borde metálico: barrido direccional con contraste y espectro. */
export const METAL_BORDER = {
  /** Exponente del Fresnel: concentra todo el efecto en el CONTORNO. */
  filoPower: 0.85,
  /** Barrido que recorre el contorno con el tilt y el puntero. */
  sweepX: 1.3,
  sweepY: 1.7,
  sweepTilt: 2.2,
  sweepPointer: 0.6,
  /** Ancho de la banda del barrido. */
  bandHalfWidth: 0.34,
  /** El tono del metal recorre el espectro según el ángulo de visión. */
  toneViewAngle: 2.0,
  toneTimeShift: 0.04,
  /** Suelo plateado: el metal es gris con el color encima. */
  silver: [0.88, 0.91, 0.96],
  silverMix: 0.55,
  /** Contraste: brillo del barrido y sombra entre barridos. */
  lightBase: 0.45,
  lightSweep: 1.15,
  /** Mezcla con el color de marca, para que la carta conserve su identidad. */
  brandMix: 0.72,
  /** Peso final del filo y destello extra del metal. */
  edgeWeight: 0.85,
  sparkleWeight: 0.5,
} as const;

/** Viñeta: caída suave en las esquinas (0.82 oscurecía los bordes del arte). */
export const VIGNETTE = {
  inner: 0.35,
  outer: 1.15,
  floor: 1.0,
  ceiling: 1.04,
} as const;

/** Logotipo: se recompone al FINAL, con sus píxeles y su alfa. */
export const LOGO = {
  /** Alfa mínimo por debajo del cual un píxel del logo no se dibuja. */
  stickerCutoff: 0.001,
  /** Barrido del brillo metálico sobre la marca. */
  sweepX: 0.7,
  sweepY: 0.9,
  sweepTilt: 1.6,
  sweepPointer: 0.5,
  bandHalfWidth: 0.30,
  /** La marca oscura brilla menos que una clara, como el metal real. */
  bandWeight: 0.85,
  specularWeight: 0.35,
  metalBase: 0.72,
  metalGain: 0.75,
  /** Luz fría del barrido y sombra cálida entre barridos. */
  coolLight: [0.92, 0.96, 1.0],
  coolLightWeight: 0.5,
  warmShadow: [0.1, 0.08, 0.04],
  /** Filo luminoso del contorno: separa la marca del fondo. */
  rimWidth: 2.0,
  rimFalloff: 1.6,
  rimWeight: 0.22,
  /**
   * PARALAJE del LOGO como plano PROPIO, también como fracción del ancho de carta.
   *
   * El logo no es una capa aparte del shader: se recompone como PEGATINA al final
   * (uLogoSticker) porque es la única forma de que ningún efecto lo tiña. Pero su
   * muestreo SÍ se desplaza, y eso lo convierte en el tercer plano: fondo →
   * personaje → logo, cada uno moviéndose a su ritmo.
   *
   * Va en NEGATIVO y más fuerte que el fondo: el logo es lo que está más cerca del
   * cristal, así que es lo que más se desplaza, y al ir al contrario que el fondo los
   * dos se separan del personaje.
   *
   * AJUSTE EN VIVO (dos vueltas): con 0.08 la marca se despegaba de su sitio y se leía
   * como un elemento suelto flotando sobre la carta; con 0.05 seguía siendo demasiado.
   * En 0.03 el desplazamiento es perceptible pero la marca mantiene su anclaje: sigue
   * habiendo separación con el fondo (0.06, en sentido contrario, así que entre los dos
   * planos hay 0.09 del ancho) sin que el logo parezca flotar.
   */
  parallax: -0.03,
} as const;

/**
 * CAPAS PARALLAX de la carta, de abajo arriba.
 *
 * El usuario pidió 7 capas separadas con paralaje propio. Cada valor es la
 * FRACCIÓN DEL ANCHO de carta que se desplaza con el puntero (que va de -1 a 1).
 * Signo positivo = se mueve con el puntero; negativo = en contra (más cerca del
 * cristal).
 *
 *   0 surface      -> la SUPERFICIE de la carta (el arte del fondo vive aquí)
 *   1 character    -> el personaje, ligeramente por delante de la superficie
 *   2 logo         -> marca, desplazamiento medio
 *   3 title        -> placa metálica del título
 *   4 texts        -> VACÍA (el usuario retiró los textos de la carta 3D)
 *   5 tags         -> VACÍA (el usuario retiró los tags de la carta 3D)
 *   6 wordmark     -> "VTUBERDEX"
 *
 * LA CAPA 0 SE MUEVE CON PARALAJE (petición del usuario, dos vueltas después)
 * --------------------------------------------------------------------------
 * Esta capa llegó a tener factor 0, y el motivo era bueno: se razonó que un material no
 * se desplaza respecto del mesh que lo lleva, y que un fondo desplazado se leía como una
 * CAPA en vez de como la superficie de la carta.
 *
 * El usuario ha pedido lo contrario y es su decisión: quiere que la textura del mesh se
 * mueva con paralaje. Se le da, pero el desplazamiento es PEQUEÑO (0.04 contra los 0.06
 * que llegó a llevar el "fondo lejano") y `BACKGROUND.cover` sube a 1.25 para que el
 * muestreo no se salga de la textura. Así conserva la profundidad que pide sin volver a
 * separar el arte del mesh: la imagen sigue siendo el sustrato —recibe el mismo acabado
 * que todo— y solo se desliza un poco por debajo del personaje.
 *
 * NOTA sobre cobertura y desplazamiento: son dos cosas y viven en sitios distintos.
 * `factor` es cuánto se desplaza la capa con el puntero (esta tabla). La ESCALA con la que
 * se dibuja el canvas de la capa 0 NO está aquí: sale de `BACKGROUND.cover`, que es lo que
 * usa `drawSurfaceLayer` al encajar el arte. Esta tabla llegó a tener un campo `scale` por
 * fila que no leía nadie; se retiró, porque una perilla muerta se toca, no hace nada y
 * hace dudar de si el efecto está roto.
 */
export const PARALLAX_LAYERS = [
  { name: 'surface', index: 0, factor: 0.04 },
  { name: 'character', index: 1, factor: 0.005 },
  { name: 'logo', index: 2, factor: -0.03 },
  { name: 'title', index: 3, factor: 0.015 },
  { name: 'texts', index: 4, factor: 0.012 },
  { name: 'tags', index: 5, factor: 0.018 },
  { name: 'wordmark', index: 6, factor: 0.01 },
] as const;

export type LayerName = typeof PARALLAX_LAYERS[number]['name'];
export const LAYER_UNIFORM_NAMES: string[] = PARALLAX_LAYERS.map((l) => `uLayer${l.index}`);
export const LAYER_PARALLAX_FACTORS: number[] = PARALLAX_LAYERS.map((l) => l.factor);

/**
 * Resplandor de marca ALREDEDOR de la carta (plano aparte, aditivo).
 *
 * Subió de 0.55 a 0.73 en el ajuste en vivo: es el halo que despega la carta del fondo,
 * y al bajar el brillo de la propia carta el halo tenía que subir para compensar.
 */
export const GLOW = {
  strength: 1.14,
  /** Caída exponencial desde el canto, que es como decae la luz. */
  falloffRate: 11.5,
  falloffWeight: 0.6,
  /** Filo más brillante pegado a la silueta. */
  coreRate: 34.0,
  coreWeight: 0.5,
  /** Suavizado del recorte, en píxeles (fwidth) con cota inferior. */
  aaPixels: 1.2,
  aaMin: 0.002,
  /** Apagado en el borde del propio plano, para que no se vea el rectángulo. */
  edgeFadeFrom: 0.80,
  /**
   * HUMO ESPECTRAL: vapor sutil que se sumerge en el resplandor exterior.
   *
   * Se calcula con ruido procedural de valor (hash + octavas) que MODULA la
   * intensidad y el tinte del brillo existente — no deforma la distancia al
   * borde, que era lo que expandía el halo en una nube condensada. Así el
   * resplandor original se conserva y el humo lo atraviesa como neblina.
   *
   * `smokeScale` frecuencia del ruido; `smokeSpeed` velocidad de la deriva;
   * `smokeAmp` cuánto modula la intensidad (0.1 = susurro, 0.3 = respiración);
   * `smokeOctaves` detalle del fractal; `smokeWarp` fuerza del domain warping
   * (0 = nube uniforme, 1 = volutas caóticas como humo de cigarro).
   * `spectralScale` densidad de franjas; `spectralSpeed` velocidad del arcoíris;
   * `spectralMix` peso del tinte respecto al color de marca; `spectralDistort`
   * cuánto el ruido desplaza el espectro (0 = arcoíris por anillo, 1 = por voluta).
   */
  smokeScale: 4.5,
  smokeSpeed: 0.8,
  smokeAmp: 0.22,
  smokeOctaves: 4,
  smokeWarp: 0.6,
  spectralScale: 3.0,
  spectralSpeed: 0.7,
  spectralMix: 0.45,
  spectralDistort: 0.4,
} as const;

/** Recorte de la silueta en el shader de la cara. */
export const SILHOUETTE = {
  /**
   * Ancho de la transición del borde, en PÍXELES: se multiplica por `fwidth(d)`
   * para que el canto se vea igual en la grilla (carta de 163 px) y en el detalle
   * (420 px). A partir de ~4 px el filo pierde foco y deja de parecer un objeto.
   */
  aaPixels: 1.4,
  /** Cota inferior, por si `fwidth` sale anómalo en una carta diminuta. */
  aaMinRatio: 0.0012,
  /** Alfa por debajo del cual se descarta el fragmento. */
  alphaCutoff: 0.02,
} as const;

/** Movimiento de la carta: inclinación por puntero y flotación. */
export const MOTION = {
  tiltY: 0.38,
  tiltX: 0.28,
  driftX: 0.05,
  /** Amortiguación exponencial: la inclinación persigue al puntero, no lo copia. */
  dampingBase: 0.0015,
  floatAmplitude: 0.045,
  floatSpeed: 0.7,
  rollAmplitude: 0.02,
  rollSpeed: 0.45,
  /** Curvatura sutil del cartón y parallax del frente. */
  bendDepth: 0.035,
  /** Medio ancho donde se concentra la curvatura, en unidades de UV del ancho. */
  bendRange: 1.1,
  /** Cuánto se acentúa la curva en su centro. */
  bendGain: 4.0,
  parallax: 0.028,
} as const;

/** Luces de la escena. La CARA no las recibe (usa su ShaderMaterial): encienden el CANTO. */
export const LIGHTS = {
  ambient: 0.75,
  key: { position: [3, 4, 6], intensity: 1.15 },
  /** Relleno lateral: un metal con `metalness` alto refleja el entorno. */
  fillLeft: { position: [-5, 2, 3], intensity: 0.55, color: '#eef2ff' },
  fillBottom: { position: [0, -4, 2], intensity: 0.35, color: '#cdd6e6' },
  accent: { position: [-3, -2, 3], intensity: 18, distance: 12 },
  top: { position: [0, 3, -4], intensity: 8, color: '#ffffff', distance: 10 },
} as const;

/** Cuerpo metálico del canto. */
export const BODY = {
  color: '#d8dde6',
  roughness: 0.18,
  metalness: 0.92,
  envMapIntensity: 1.2,
} as const;

/** Fondo de la escena: un gris claro, no la niebla oscura anterior (#05060a). */
export const FOG = { color: '#c9cdd6', near: 8, far: 20 } as const;

/**
 * PROTECCIÓN DEL MATIZ DEL FONDO frente al holograma.
 *
 * EL DEFECTO: en cartas de fondo ROJO o de colores OSCUROS el color de marca no se veía. El
 * arcoíris del holograma se SUMA como luz (rojo + verde = amarillo/oliva), así que un rojo
 * #c33f00 salía verde oliva y un casi negro #120808 salía verde azulado: el efecto «cubría» el
 * color en vez de brillar sobre él. Medido renderizando ambas cartas.
 *
 * LA CORRECCIÓN: sobre superficies saturadas u oscuras la luz cromática del holograma se
 * sustituye por luz DEL MISMO MATIZ que el arte (tono sobre tono): sigue habiendo destello, pero
 * ya no cambia el color. Sobre grises, blancos y pasteles (croma bajo y claros) el arcoíris
 * queda como estaba.
 */
export const HUE_PROTECT = {
  /** Croma (saturación HSV) del arte a partir del cual se protege, y donde llega al máximo. */
  chromaFrom: 0.3,
  chromaTo: 0.8,
  /** Luminancia por debajo de la cual el arte se considera oscuro (protección total en `darkTo`). */
  darkFrom: 0.45,
  darkTo: 0.12,
  /** Cuánto del arcoíris se sustituye en el caso peor (1 = nada de arcoíris). Deja un resto. */
  strength: 0.85,
  /** Piso del brillo máximo al normalizar el matiz: evita dividir por ~0 en negros y amplificar ruido. */
  valueFloor: 0.05,
} as const;

/**
 * COLOR PREDOMINANTE del fondo: tiñe el foil holográfico de la superficie.
 *
 * El foil del fondo era un arcoíris fijo; ahora se mezcla con el color que domina la superficie
 * (`predominante.ts`), así el destello es del color del arte y no cambia su matiz. Se MEZCLA, no
 * se sustituye: al 100 % el foil sería monocromo y la carta perdería el aspecto holográfico.
 */
export const DOMINANT = {
  /** Cuánto del arcoíris se sustituye por el predominante (0 = nada, 1 = monocromo). */
  mix: 0.7,
  /** Piso de la luminancia del tono al reescalarlo: evita dividir por ~0 con tonos muy oscuros. */
  toneFloor: 0.2,
  /** Lado de la cuadrícula en la que se muestrea la superficie (32x32 basta y es instantáneo). */
  grid: 32,
  /** Croma (0..1) por debajo del cual un píxel se considera gris y no vota. */
  minChroma: 0.18,
  /** Cubos de matiz: 12 separan rojo, naranja, amarillo… sin partir un mismo color en dos. */
  hueBins: 12,
  /** Fracción de la superficie que ha de tener el color ganador para confiar del todo en él. */
  coverageFull: 0.3,
  /** Cuánto del color con croma debe ser del ganador: por debajo de `From` es multicolor y no se fía. */
  dominanceFrom: 0.45,
  dominanceTo: 0.75,
} as const;
