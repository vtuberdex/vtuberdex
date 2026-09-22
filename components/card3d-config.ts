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
   * Grosor del cuerpo: es lo que da el CANTO.
   *
   * 0.035 era una lámina casi plana (1.6% del ancho) y al inclinarla no se veía
   * canto alguno; 0.075 le da presencia de objeto sin volverla un ladrillo.
   */
  cardDepth: 0.075,
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
   */
  bevelRatio: 0.18,
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
  glowSpread: 1.35,
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
  holo: { default: 0.7, tile: 0.7, detail: 0.7, noThemeFloor: 0.45 },
  gloss: { default: 0.63, tile: 0.63, detail: 0.63 },
} as const;

/** Capa holográfica: interferencia de película delgada. */
export const HOLOGRAM = {
  /**
   * Peso del color espectral que se SUMA al arte. Es la perilla de la SATURACIÓN (ver
   * la cabecera): 0.12 -> 0.06 -> 0.03 razonando, y 0.15 al ajustar en vivo, que es
   * donde la lámina tiene color sin velar el arte.
   */
  layerWeight: 0.15,
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
 * FONDO de la carta: una capa PROPIA detrás del personaje.
 *
 * Es una cuarta imagen fuente (`asset.kind = 'background'` →
 * `data/images/background/<slug>.webp`) que se dibuja en la ventana de arte, POR
 * DEBAJO del personaje, y que lleva su propio holograma —más intenso que el del
 * personaje— para que las dos capas se lean a distinta profundidad. Con las
 * cuatro imágenes (fondo, personaje, logo y facción) la carta tiene planos
 * separados y el paralaje se percibe.
 *
 * IMPORTANTE — el fondo no sustituye a nada
 * ------------------------------------------
 * El fondo que la carta pinta SIEMPRE primero es el degradado del color de tema
 * de `card-texture.ts`. Este es una capa OPCIONAL encima de ese degradado y
 * debajo del personaje: sin imagen subida no cambia nada de lo que se ve hoy.
 *
 * POR QUÉ SU HOLOGRAMA ES MÁS FUERTE
 * ----------------------------------
 * El personaje es opaco (medido: 684 de 785 fichas cubren ≥98% del alto), así que
 * el fondo se ve poco y en los bordes. Si su efecto fuera tan sutil como el del
 * personaje apenas se notaría; aquí interesa justo lo contrario, que las dos capas
 * se distingan. Todos los pesos van por encima de los equivalentes de `HOLOGRAM`:
 *   · `layerWeight` 0.42 contra 0.15 del personaje (2,8×).
 *   · `baseMask` y `tiltFactor` por encima de los de `HOLOGRAM`, para que el efecto
 *     se vea también con la carta quieta.
 *   · `edgeStrength`, que es la perilla de TINTA Y PIEL solo para esta capa.
 *
 * LO QUE *NO* CAMBIA, Y POR QUÉ (fallo medido)
 * --------------------------------------------
 * El PATRÓN espacial del arcoíris es EXACTAMENTE el del personaje: los mismos
 * `HOLOGRAM.surfaceX/surfaceY` y el mismo `viewAngleWeight`. Antes esta capa sumaba
 * su propio `bgFoil` de 5 ciclos (contra 1,6 del frente) y usaba frecuencias de
 * superficie distintas (2,1/1,2 contra 1,1/0,8), así que las franjas del fondo tenían
 * otra escala que las del personaje: las dos capas se leían como dos láminas
 * holográficas distintas pegadas una sobre otra, y el efecto se veía falso. Un
 * holograma es una propiedad de la SUPERFICIE que se mira, no de la imagen que hay
 * debajo, así que la franja tiene que tener el mismo tamaño en las dos capas.
 *
 * Lo que distingue al fondo es entonces la INTENSIDAD y el CROMA, no la frecuencia:
 * por eso se sube `holo`/`layerWeight` y se deja el patrón compartido.
 */
export const BACKGROUND = {
  /**
   * Intensidad global del efecto del fondo. Como `INTENSITY.holo` pero SOLO para
   * esta capa: apagarla deja el fondo con su arte intacto y sin holograma.
   */
  holo: 0.9,
  /** Peso del color espectral que se SUMA al arte del fondo (su saturación). */
  layerWeight: 0.42,
  /**
   * FUERZA de TINTA Y PIEL solo para el fondo.
   *
   * El frente tiene la suya (`EDGE.strength`) y el fondo no tenía ninguna: el realce
   * de contornos del personaje se aplicaba a la carta entera por la zona de arte, sin
   * forma de ajustarlo por capa. La máscara es la MISMA para las dos (`inkAndSkinMask`
   * se calcula sobre la imagen del fondo en el mismo encuadre), lo que cambia es el
   * peso con el que cada capa la usa.
   *
   * Va por encima de `EDGE.strength` (0.1) con el mismo criterio que el resto de esta
   * capa: el fondo se ve menos, así que sus efectos van más marcados para que las dos
   * se distingan.
   *
   * AJUSTADO EN VIVO a 0.75: con 0.28 el realce casi no se notaba sobre el fondo.
   */
  edgeStrength: 0.75,
  /** El barrido que sigue al puntero y el desplazamiento por inclinación. */
  glareStrength: 1.15,
  glareRadius: 0.7,
  tiltShift: 2.6,
  /** Desfase temporal propio: el fondo no cambia de color al unísono con el personaje. */
  timeShift: 0.085,
  /** Piso del efecto con la carta quieta, y cuánto sube al inclinarla. */
  baseMask: 0.85,
  tiltFactor: 3.6,
  /** Desaturación del espectro y suelo metálico (menos gris = más color visible). */
  spectrumDesaturation: 0.3,
  metalFloorMix: 0.72,
  /**
   * Paralaje del fondo respecto del personaje. El valor es una FRACCIÓN DEL ANCHO
   * DE CARTA: con 0.06 el fondo recorre un 6% del ancho en el recorrido completo del
   * puntero. Se multiplica por `uPointer`, que va de -1 a 1, no por `uTilt` (esa es
   * una rotación en radianes y llega a 0.38, así que con ella el desplazamiento real
   * se quedaba en el 2,3% del ancho y no se percibía por más que se subiera el valor).
   *
   * El SIGNO se aplica en el shader (se resta el puntero): el fondo va al CONTRARIO
   * que el frente, que es lo que se lee como estar más lejos.
   */
  parallax: 0.06,
  /**
   * MARGEN del fondo para que el paralaje no lo saque del lienzo.
   *
   * POR QUÉ (fallo medido): el paralaje desplaza el muestreo, así que en los bordes
   * la lectura se sale de [0,1]. La textura está clampeada, así que ese sobrante NO
   * se envuelve: se ESTIRA el píxel del borde y el fondo sale con bandas deformadas
   * justo al inclinar, que es cuando se mira.
   *
   * El recorrido máximo es `parallax` (0.06 del ancho), así que hace falta más de un
   * 3% de margen por lado. Con 1.14 el fondo se amplía un 14% y sobran 7% por lado:
   * cubre el recorrido y deja holgura sin que la imagen parezca mal escalada.
   */
  overscanFactor: 1.14,
  /**
   * Nivel base del arte del fondo y cuánto lo realza su propia claridad.
   *
   * Un fondo oscuro NO puede encenderse como uno claro, o dejaría de parecer la
   * imagen que se subió: el arte se escala por su luminancia (`artFloor` es el
   * suelo, `artLumGain` lo que aporta lo claro). Subir el suelo hace el fondo más
   * luminoso y plano; subir la ganancia conserva el contraste original.
   */
  artFloor: 0.55,
  artLumGain: 0.9,
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
   * Placa del número de dex: acero más oscuro que la cabecera, para que el `#002`
   * se lea como una pieza distinta y no como parte del mismo bloque.
   */
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
  highlightWeight: 0.5,
} as const;

/** Emblemas de facción, superpuestos como holograma. */
export const FACTION = {
  /**
   * Opacidad del emblema. Casi todos los PNG traen su interior en negro OPACO
   * (~30-45% del área), así que se pondera por el BRILLO del trazo y no solo por
   * el alfa: 0.75 hacía que los emblemas apenas se distinguieran sobre arte oscuro.
   */
  strength: 1.0,
  /**
   * Posición y tamaño relativo de cada slot sobre la lámina. Los cuatro están
   * separados a propósito (no apilados): 1º arriba-derecha, 2º abajo-izquierda,
   * 3º arriba-izquierda, 4º abajo-derecha.
   */
  slots: [
    { x: 0.70, y: 0.76, size: 0.30 },
    { x: 0.30, y: 0.30, size: 0.28 },
    { x: 0.28, y: 0.78, size: 0.24 },
    { x: 0.72, y: 0.28, size: 0.24 },
  ],
  /** Parallax: cada emblema se desplaza con el puntero a distinta profundidad. */
  pointerParallax: 0.02,
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
  maskBase: 0.5,
  maskTilt: 1.0,
  maskGlare: 0.45,
  /** Tinte iridiscente propio de cada slot. */
  tintSpectrumMix: 0.7,
  tintUvScale: 0.9,
  tintPointer: 0.1,
  tintPhase: 0.2,
  /** Mezcla sobre el arte: tinte del propio color y luz añadida. */
  selfTint: 0.45,
  addedLight: 0.8,
} as const;

/**
 * Tinta y piel: el lineart y los tonos de piel encendidos como holograma.
 *
 * ESTA ES LA CAPA QUE MÁS SE COME EL ARTE, y se midió antes de tocarla: con la carta
 * en reposo aporta Δmedio 14.26 y cambia el 35.7% de los píxeles, más que el barniz
 * (12.10 / 29.3%) y muchísimo más que la lámina iridiscente (2.75 / 4.6%). Es también
 * la que más sube la LUMINANCIA del arte (+25%), que es lo que se percibe como velo.
 *
 * Recorrido: 0.6 -> 0.3 razonando (la mitad), y 0.1 al ajustar en vivo. A 0.3 el realce
 * de contornos todavía se notaba sobre las zonas claras del personaje; a 0.1 el lineart
 * se enciende sin aclarar el arte, que es el efecto que se buscaba.
 */
export const EDGE = {
  strength: 0.1,

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
  glossSelf: 0.1,
  holoSelf: 0.5,
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
  floor: 0.92,
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
 * Resplandor de marca ALREDEDOR de la carta (plano aparte, aditivo).
 *
 * Subió de 0.55 a 0.73 en el ajuste en vivo: es el halo que despega la carta del fondo,
 * y al bajar el brillo de la propia carta el halo tenía que subir para compensar.
 */
export const GLOW = {
  strength: 0.73,
  /** Caída exponencial desde el canto, que es como decae la luz. */
  falloffRate: 12.0,
  falloffWeight: 0.6,
  /** Filo más brillante pegado a la silueta. */
  coreRate: 34.0,
  coreWeight: 0.5,
  /** Suavizado del recorte, en píxeles (fwidth) con cota inferior. */
  aaPixels: 1.2,
  aaMin: 0.002,
  /** Apagado en el borde del propio plano, para que no se vea el rectángulo. */
  edgeFadeFrom: 0.82,
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
