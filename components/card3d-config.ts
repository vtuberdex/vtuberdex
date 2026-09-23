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
  holo: { default: 0.3, tile: 0.3, detail: 0.3, noThemeFloor: 0.45 },
  gloss: { default: 0.3, tile: 0.3, detail: 0.3 },
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
  holo: 0.76,
  /**
   * ESCALA del fondo dentro de la carta (cuánto se agranda el arte del fondo).
   *
   * 1.10 era el margen justo para que el paralaje no descubriera el borde del lienzo. El
   * usuario pidió el fondo un 10% MÁS GRANDE, así que 1.10 * 1.10 = 1.21: el encuadre se
   * calcula por el lado más pequeño que cubre el canvas, de modo que subirlo recorta más la
   * imagen y el fondo llena la carta con menos borde visible.
   *
   * OJO si lo subes mucho: el paralaje desplaza la capa, así que necesitas margen o el
   * borde del fondo entrará en cuadro.
   */
  cover: 1.21,
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
  /**
   * TINTE HOLOGRÁFICO DEL BORDE del fondo.
   *
   * POR QUÉ (petición concreta): el fondo llevaba el holograma repartido por igual por
   * toda su superficie, así que en el centro se veía tenue y el efecto no se leía. En una
   * lámina de verdad el ángulo rasante del borde es el que más desplaza el color, y esa
   * concentración es lo que hace el borde visiblemente iridiscente. El frente ya tenía su
   * Fresnel; el fondo no, y por eso su canto quedaba apagado.
   *
   * `edgeTint` pesa cuánto se AÑADE el espectro en el contorno (0 lo deja como estaba).
   * El exponente lo concentra: cuanto más alto, más pegado al filo queda el color.
   */
  edgeTint: 0.85,
  edgeTintPower: 2.4,
  /**
   * Ciclos del espectro en el borde. Más alto = bandas de color más finas recorriendo el
   * contorno; con muy pocos se ve un borde de un solo color.
   */
  edgeTintCycles: 2.2,
  /**
   * Suelo del arte sobre el que se suma el tinte del canto.
   *
   * POR QUÉ HACE FALTA: el tinte se multiplica por la luminancia del arte para no
   * encender un fondo oscuro como si fuera claro. Pero en un fondo MUY oscuro ese
   * producto tiende a 0 y el canto desaparecía justo cuando más se nota. Este suelo
   * garantiza que el borde tenga siempre sobre qué sumarse.
   */
  edgeTintFloor: 0.15,
} as const;

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
  highlightBoost: 2.5,
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
  lightCeiling: 1.5,
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
  strength: 1.0,
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
  strength: 0.25,
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
  highlightWeight: 0.6,
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
  strength: 0.09,

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
 * CAPAS PARALLAX de la carta, de abajo arriba.
 *
 * El usuario pidió 7 capas separadas con paralaje propio. Cada valor es la
 * FRACCIÓN DEL ANCHO de carta que se desplaza con el puntero (que va de -1 a 1).
 * Signo positivo = se mueve con el puntero; negativo = en contra (más cerca del
 * cristal).
 *
 *   0 background   -> capa más lejana, movimiento opuesto al frente, escala 1.10
 *   1 character    -> el personaje, anclado a la carta (casi sin paralaje)
 *   2 logo         -> marca, desplazamiento medio
 *   3 title        -> placa metálica del título
 *   4 texts        -> frase, pie, estado (texto blanco con sombra)
 *   5 tags         -> chips de tipo
 *   6 wordmark     -> "VTUBERDEX"
 *
 * El background se escala en CPU (overscan 1.10) para no ver bordes al inclinar.
 */
export const PARALLAX_LAYERS = [
  { name: 'background', index: 0, factor: -0.06, scale: 1.10 },
  { name: 'character', index: 1, factor: 0.005, scale: 1.0 },
  { name: 'logo', index: 2, factor: -0.03, scale: 1.0 },
  { name: 'title', index: 3, factor: 0.015, scale: 1.0 },
  { name: 'texts', index: 4, factor: 0.012, scale: 1.0 },
  { name: 'tags', index: 5, factor: 0.018, scale: 1.0 },
  { name: 'wordmark', index: 6, factor: 0.01, scale: 1.0 },
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

/**
 * CAPAS PARALLAX de la carta, de abajo arriba.
 *
 * El usuario pidió 7 capas separadas con paralaje propio. Cada valor es la
 * FRACCIÓN DEL ANCHO de carta que se desplaza con el puntero (que va de -1 a 1).
 * Signo positivo = se mueve con el puntero; negativo = en contra (más cerca del
 * cristal).
 *
 *   0 background   -> capa más lejana, movimiento opuesto al frente
 *   1 character    -> el personaje, anclado a la carta (casi sin paralaje)
 *   2 logo         -> marca, desplazamiento medio
 *   3 title        -> placa metálica del título
 *   4 texts        -> frase, pie, estado (texto blanco con sombra)
 *   5 tags         -> chips de tipo
 *   6 wordmark     -> "VTUBERDEX"
 *
 * El background es 10% más grande en CPU para no ver bordes al inclinar.
 */
export const PARALLAX = {
  background: -0.06,
  character: 0.005,
  logo: -0.03,
  title: 0.015,
  texts: 0.012,
  tags: 0.018,
  wordmark: 0.01,
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
