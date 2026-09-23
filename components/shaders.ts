/**
 * Shaders de la carta holográfica.
 *
 * El efecto "carta Pokémon holográfica" del original no existe: allí las cartas
 * son imágenes planas con hover. Aquí el brillo iridiscente, el barrido
 * diagonal y la chispa de borde se calculan en GPU, con el color del VTuber
 * como acento, de modo que cada carta se ve distinta sin assets extra.
 *
 * LOS VALORES NO VIVEN AQUÍ: aquí está la FÓRMULA. Todo lo que se pueda ajustar
 * sin reescribir el cálculo —intensidades, pesos de mezcla, constantes— está en
 * `components/card3d-config.ts`, que es el archivo que se abre para tocar el
 * efecto. Si un número aparece escrito en este archivo es que forma parte del
 * MODELO (p. ej. las bandas del espectro visible en `wavelengthToRgb`) y no una
 * perilla.
 *
 * La cara TRASERA ya no existe (ver `holo-card.tsx`): su shader se eliminó con
 * ella. La carta se muestra siempre de frente y con una inclinación leve, así que
 * el reverso nunca entraba en cuadro y su contorno solo servía para asomar por los
 * cantos.
 */
import * as CFG from '@/components/card3d-config';

/**
 * Número de la config como literal FLOTANTE de GLSL.
 *
 * POR QUÉ HACE FALTA (medido, no teórico)
 * --------------------------------------
 * Un template literal de JS escribe `12.0` como `"12"`: el `.0` se pierde porque el
 * valor es el número 12, no el texto. Y GLSL ES 3.0 NO convierte int a float en una
 * operación: `exp(-dist * 12)` no compila ("no operation '*' exists that takes a
 * left-hand operand of type 'highp float' and a right operand of type 'const int'").
 *
 * Ese fallo es INVISIBLE para todo el stack estático: `tsc` ve una cadena, los tests
 * pasan, `next build` pasa y `check-shaders.mjs` no mira valores. Solo se ve en el
 * navegador, como `THREE.WebGLProgram: Shader Error ... Fragment shader is not
 * compiled` y la carta negra. Por eso TODO número de la config pasa por aquí: no se
 * interpola un `CFG` a pelo en el GLSL.
 */
const f = (n: number): string => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Trío de números de la config como literal `vec3(...)` de GLSL. */
const vec3 = (v: readonly number[]): string => `vec3(${v.map(f).join(', ')})`;

/**
 * `wavelengthToRgb` GENERADA desde SPECTRUM.stops.
 *
 * Los umbrales de cada tramo salen del NÚMERO DE PARADAS, no se escriben a mano: con
 * 6 paradas hay 5 bandas, así que los cortes son i/5 (0.2, 0.4, 0.6, 0.8), que es
 * exactamente lo que hacía la versión escrita a mano. Añadir un color en la config
 * mueve los cortes solo; escrito a mano, un umbral desalineado pintaría un salto de
 * tono en el arcoíris.
 *
 * El ÚLTIMO tramo va como `return` sin condición, no como `if (w < 1.0)`: la función
 * declara devolver vec3, así que necesita un retorno incondicional en el camino final
 * (y `w` ya está recortado a 0..1 al entrar).
 */
const SPECTRUM_FN = (() => {
  const paradas = CFG.SPECTRUM.stops;
  const n = paradas.length;
  const paso = 1 / (n - 1);
  // `i * paso` da 0.6000000000000001 en vez de 0.6 (error de coma flotante): se
  // redondea a 4 decimales, que para estos cortes es exacto y no ensucia el GLSL.
  const corte = (i: number) => f(Number(((i + 1) * paso).toFixed(4)));
  const base = (i: number) => f(Number((i * paso).toFixed(4)));
  const lineas = paradas.slice(0, -1).map((s, i) => {
    const origen = i === 0 ? 'w' : `(w - ${base(i)})`;
    const cuerpo = `mix(${s.name}, ${paradas[i + 1].name}, ${origen} / ${f(Number(paso.toFixed(4)))})`;
    // El último tramo cubre hasta 1.0 inclusive: es el retorno final.
    return i === n - 2 ? `    return ${cuerpo};` : `    if (w < ${corte(i)}) return ${cuerpo};`;
  });
  return `  vec3 wavelengthToRgb(float w) {
    w = clamp(w, 0.0, 1.0);
${paradas.map((s) => `    vec3 ${s.name} = ${vec3(s.rgb)};`).join('\n')}
${lineas.join('\n')}
  }`;
})();

/**
 * Posiciones y tamaños de los slots de facción, como líneas GLSL.
 *
 * Se generan desde la config en vez de escribirse aquí: el shader describe CÓMO se
 * reparten (cuatro posiciones, cuatro tamaños), no dónde están.
 */
const FACTION_SLOTS = CFG.FACTION.slots.map((s, i) => `        slots[${i}] = vec2(${f(s.x)}, ${f(s.y)});`).join('\n');
const FACTION_SIZES = CFG.FACTION.slots.map((s, i) => `        sizes[${i}] = ${f(s.size)};`).join('\n');

export const cardVertexShader = /* glsl */ `
  uniform vec2 uPointer;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);

    // Curvatura sutil: la carta se flexiona como cartón real.
    vec3 transformed = position;
    float bend = 1.0 - smoothstep(0.0, ${f(CFG.MOTION.bendRange)}, abs(transformed.x));
    transformed.z += bend * ${f(CFG.MOTION.bendDepth)} * (1.0 - bend) * ${f(CFG.MOTION.bendGain)};

    // Micro-desplazamiento guiado por el puntero (parallax del frente).
    transformed.xy += uPointer * ${f(CFG.MOTION.parallax)} * vUv.y;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const cardFragmentShader = /* glsl */ `
  precision highp float;

  /**
   * 7 capas con paralaje independiente. Ver [card3d-config.ts] PARALLAX_LAYERS.
   *
   * POR QUÉ SE ELIMINÓ EL FALLBACK uMap (fallo medido)
   * --------------------------------------------------
   * El shader llegó a declarar 18 samplers con uMap y el juego completo del fondo
   * antiguo, y el driver corta en 16: el material no compilaba
   * ("Implementation limit of 16 active fragment shader samplers exceeded") y la
   * carta salía NEGRA, sin un solo error en tsc ni en los tests, que corren sin
   * WebGL. Con las 7 capas declaradas, uMap era además un fallback muerto: la
   * composición se arma siempre desde las capas, así que su rama nunca se ejecutaba.
   * Los samplers del fondo (uBackgroundMap/uBackgroundMask/uBgEdgeMap) también
   * sobraban: la capa 0 YA ES el fondo, con su paralaje propio.
   */
  uniform sampler2D uLayer0;
  uniform sampler2D uLayer1;
  uniform sampler2D uLayer2;
  uniform sampler2D uLayer3;
  uniform sampler2D uLayer4;
  uniform sampler2D uLayer5;
  uniform sampler2D uLayer6;
  uniform float uParallaxFactors[7];
  /**
   * Máscara de TINTA Y PIEL: el lineart negro y los tonos de piel del personaje.
   * Se mezcla en modo LUZ como capa holográfica: enciende el dibujo y la piel sin
   * tocar el resto de la carta.
   */
  uniform sampler2D uEdgeMap;
  uniform float uEdgeStrength;
  /**
   * Emblemas de las facciones del VTuber. Un VTuber tiene entre 2 y 4 facciones,
   * así que se superponen hasta 4 emblemas en posiciones distintas (ver
   * FACTION.slots): no se apilan en el centro, se reparten por la lámina.
   */
  uniform sampler2D uFactionMap0;
  uniform sampler2D uFactionMap1;
  uniform sampler2D uFactionMap2;
  uniform sampler2D uFactionMap3;
  uniform vec4 uFactionCounts;
  /** Opacidad del emblema holográfico (permite atenuarlo sin tocarlo en CPU). */
  uniform float uFactionStrength;
  uniform vec3 uAccent;
  uniform vec3 uSecondary;
  uniform vec2 uPointer;
  uniform vec2 uTilt;
  uniform float uTime;
  uniform float uHolo;
  uniform float uHasHolo;
  uniform float uGloss;
  /** Tamaño de la carta en unidades de mundo y radio de sus esquinas. */
  uniform vec2 uCardSize;
  /**
   * ZONA DE LA IMAGEN dentro de la carta, en UV: (y0, y1). Las capas de barniz,
   * holografía y tinta/piel se aplican SOLO aquí.
   *
   * Por qué: la textura es una sola pieza (arte + cabecera + chips + frase +
   * barra), así que sin esto el holográfico teñía también los elementos de la
   * carta —el nombre, las etiquetas, el pie—, que no son la imagen y deben
   * quedar limpios y legibles. La banda sale de ART_ZONE en la config, que a su
   * vez se deriva del layout real de card-texture.ts.
   */
  uniform vec2 uArtZone;
  // Perillas que el panel de ajuste en vivo mueve en cada frame. Van como uniformes y
  // no interpoladas: un número dentro del GLSL se compila DENTRO del shader, así que
  // moverlo obligaría a recompilar el material (y el slider daría tirones).
  uniform float uLayerWeight;
  uniform float uGlareStrength;
  /**
   * Peso del reflejo vivo del metal (título y wordmark). Existe como uniform y no como
   * constante del shader para poder MEDIR el efecto: mismo puntero, misma carta, con el
   * barrido a 0 y a 1. Y para que el tuner lo pueda apagar, que es como se ajusta.
   */
  uniform float uSheenStrength;
  uniform float uTiltFactor;
  uniform float uBaseMask;
  uniform float uGlossSelf;
  uniform float uHoloSelf;
  uniform float uHighlightWeight;
  /**
   * LOGO COMO STICKER: la marca se recompone al FINAL, encima de todas las capas
   * de efecto, con sus propios píxeles (RGBA) y su alfa.
   *
   * Por qué así y no suprimiendo el efecto con una máscara: la carta tiene tres
   * fuentes de holograma (interferencia, emblemas de facción y barrido de glare)
   * más el barniz, y anularlas una por una sobre la marca dejaba siempre alguna
   * filtrándose —el logo seguía teñido—. Recomponer el logotipo como una pegatina
   * al final hace que sea IMPOSIBLE que el efecto lo toque: no hay nada que
   * suprimir, simplemente se dibuja después con su color original.
   */
  uniform sampler2D uLogoSticker;
  /** Máscara de la silueta del logo (1 sobre la marca): define dónde va el sticker. */
  uniform sampler2D uLogoMask;
  /**
   * Paralaje del fondo, como FRACCIÓN DEL ANCHO DE CARTA (se multiplica por el
   * puntero, que va de -1 a 1). El signo se aplica en el shader para que el fondo
   * vaya al CONTRARIO que el frente: por eso el mismo valor positivo aquí produce
   * los dos sentidos y no hay que alternar el signo de la constante.
   */
  uniform float uLogoParallax;
  uniform float uCardRadius;
  /**
   * El holograma del fondo es su PROPIO juego de perillas. Sus valores son más
   * altos que los del personaje a propósito: el fondo es una superficie lejana y
   * en penumbra, y con el peso del personaje apenas se notaría.
   */
  uniform float uBgHolo;
  uniform float uBgLayerWeight;
  uniform float uBgGlareStrength;
  uniform float uBgBaseMask;
  uniform float uBgTiltFactor;
  /** Suelo de luminancia del arte del fondo: se ajusta en vivo. */
  uniform float uBgArtFloor;
  /**
   * HDR: techo del canal de luz (rolloff del brillo) y ganancia de las luces. Son
   * uniforms, no constantes, para poder medir el efecto y ajustarlo en vivo.
   */
  uniform float uHdrBoost;
  uniform float uHdrCeiling;
  /** Fuerza de la textura de micro-superficie del fondo (0 = lámina lisa). */
  uniform float uBgNoiseStrength;
  /** Fuerza del reflejo de espejo del metal (0 = mate). */
  uniform float uMetalReflect;
  /** Abollado del pulido: desviación de la normal y frecuencia de las micro-facetas. */
  uniform float uMetalBump;
  uniform float uMetalBumpScale;
  /** Refuerzo del reflejo (perilla real: METAL_REFLECT.gain). */
  uniform float uMetalGain;
  /**
   * Peso del reflejo de espejo del metal.
   * (El uniform uMetalEnv se eliminó: el entorno es el mapa dedicado uMetalEnvMap, que
   * tiene su propio alfa de cobertura — así no hacen falta dos perillas para lo mismo.)
   */
  uniform sampler2D uMetalEnvMap;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  /**
   * Máscara de esquinas redondeadas.
   *
   * La textura del frente es un rectángulo lleno, así que sin esto la carta
   * remata en cuatro puntas vivas. Se calcula la distancia con signo a un
   * rectángulo redondeado (el clásico SDF de caja) y se devuelve 1 dentro y 0
   * fuera; el tramo de transición es de ~1 px para que el canto no salga
   * dentado. Se trabaja en unidades de carta (no en UV) porque el UV está
   * estirado y un radio constante en UV daría esquinas ovaladas.
   */
  float cardCornerMask(vec2 uv) {
    // OJO: "half" es palabra reservada en GLSL ES 3.0. Usarla como variable hace
    // que el shader NO compile ("Illegal use of reserved word") y la carta salga
    // negra. (Evitar backticks aquí: esto vive dentro de un template literal.)
    vec2 halfSize = uCardSize * 0.5;
    vec2 p = (uv - 0.5) * uCardSize;
    vec2 q = abs(p) - (halfSize - vec2(uCardRadius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCardRadius;
    /**
     * Ancho de la transición del borde (antialiasing del recorte en el shader).
     *
     * POR QUÉ CON fwidth Y NO UN ANCHO FIJO
     * -------------------------------------
     * Antes era un valor fijo (0.0045 del alto de carta). Ese ancho está en UNIDADES
     * DE CARTA, así que la transición medida en PÍXELES dependía del tamaño en
     * pantalla: ~2 px en la grilla (carta de 163 px) y ~3,8 px en el detalle (420 px).
     * El mismo canto se veía distinto en cada vista.
     *
     * fwidth(d) es cuánto cambia la distancia por píxel de pantalla: se hace grande
     * cuando la carta se ve pequeña y pequeña cuando se ve grande, así que al
     * multiplicarlo el ancho queda EXPRESADO EN PÍXELES y es el mismo en las dos
     * vistas. Medido: ~2,2 px de transición total en ambos casos.
     *
     * SILHOUETTE.aaPixels = ${f(CFG.SILHOUETTE.aaPixels)} significa una transición de ~2,8 px. Se subió desde 1.1
     * (~2,2 px) DESPUÉS de insetar el cuerpo por el bisel: mientras el canto de la
     * geometría asomaba por fuera, ensanchar esto no habría servido de nada (el borde
     * visible era el del mesh). Ya sin esa arista, este es el único contorno de la
     * silueta y se le puede dar el ancho donde se ve limpio sin emborronar: a partir
     * de ~4 px el filo empieza a perder foco y la carta deja de parecer un objeto con
     * canto.
     *
     * Cuesta CERO en memoria, a diferencia del MSAA del canvas: ese suaviza las
     * aristas de la GEOMETRÍA, pero este recorte se hace en el fragment shader con
     * discard, y eso MSAA no lo toca.
     *
     * La cota inferior evita que un fwidth anómalo (carta diminuta, derivada
     * saturada) deje el borde sin suavizar del todo.
     */
    float aa = max(fwidth(d) * ${f(CFG.SILHOUETTE.aaPixels)}, uCardSize.y * ${f(CFG.SILHOUETTE.aaMinRatio)});
    return 1.0 - smoothstep(-aa, aa, d);
  }

  /**
   * RUIDO: la base de la textura de micro-superficie del fondo.
   *
   * POR QUÉ PROCEDURAL Y NO UN MAPA DE NORMALES
   * -------------------------------------------
   * Un mapa de normales costaría un sampler más, y el shader va por 14 de los 16 que el
   * driver admite. El ruido con hash cuesta unas pocas operaciones y no gasta presupuesto.
   *
   * hash21 es el generador: convierte una celda en un número pseudoaleatorio estable. Se
   * multiplica por dos constantes irracionales y se mezcla el resultado consigo mismo
   * (dot) para que celdas vecinas no den valores correlacionados — sin ese mezclado, la
   * interpolación posterior dibuja una rejilla visible.
   */
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  /**
   * ALTURA del ruido en un punto: un fractal de varias octavas de ruido de valor.
   *
   * Cada octava duplica la frecuencia y reduce la amplitud, así que el resultado tiene
   * detalle en varias escalas — que es lo que hace que una superficie parezca material y
   * no una mancha. El suavizado con la curva f*f*(3-2f) (smoothstep) evita que se vean
   * los escalones de la interpolación lineal entre celdas.
   *
   * Devuelve una ALTURA, no una normal: el gradiente se saca fuera, por diferencias
   * finitas sobre esta misma función.
   */
  float bgNoiseHeight(vec2 uv) {
    // La deriva temporal va aquí: la textura se mueve despacio, así que no está
    // congelada, pero tan lento que no se lee como una animación.
    vec2 p = uv * ${f(CFG.BG_NOISE.scale)} + uTime * ${f(CFG.BG_NOISE.drift)};
    float suma = 0.0;
    float amp = ${f(CFG.BG_NOISE.ampStart)};
    float norma = 0.0;
    float freq = 1.0;
    // OJO: la cota del bucle va como ENTERO LITERAL, no por f(). f() añade el .0 que
    // necesita un float, pero un for de GLSL ES 3.0 compara int i < int, así que con
    // 6.0 el shader NO compila ("no operation '<' exists that takes a left-hand operand
    // of type highp int and a right operand of type const float") y la carta sale negra.
    // Es la trampa de f() en sentido contrario y solo se ve al compilar el GLSL de verdad.
    for (int i = 0; i < ${CFG.BG_NOISE.maxOctaves}; i++) {
      if (float(i) >= ${f(CFG.BG_NOISE.octaves)}) break;
      vec2 celda = floor(p * freq);
      vec2 f = fract(p * freq);
      vec2 w = f * f * (3.0 - 2.0 * f);
      float n00 = hash21(celda);
      float n10 = hash21(celda + vec2(1.0, 0.0));
      float n01 = hash21(celda + vec2(0.0, 1.0));
      float n11 = hash21(celda + vec2(1.0, 1.0));
      suma += mix(mix(n00, n10, w.x), mix(n01, n11, w.x), w.y) * amp;
      norma += amp;
      amp *= ${f(CFG.BG_NOISE.persistence)};
      freq *= ${f(CFG.BG_NOISE.lacunarity)};
    }
    // El suelo evita que una norma diminuta dispare el resultado al dividir.
    return suma / max(norma, ${f(CFG.BG_NOISE.normFloor)});
  }

  /**
   * NORMAL de la micro-superficie, por gradiente de la altura.
   *
   * Se muestrea la altura en el punto y en dos vecinos a un paso mínimo; la DIFERENCIA es
   * cuánto sube o baja la superficie en cada eje, o sea su inclinación local. Eso es la
   * normal, en 2D: sirve para romper la uniformidad de la lámina, no para iluminar un
   * objeto real.
   *
   * Es la pieza que convierte "ruido" en "textura": sin la inclinación, el ruido solo
   * aclara y oscurece; con ella, cada punto refleja con un ángulo ligeramente distinto y
   * el holograma se rompe en facetas.
   */
  vec2 bgNoiseNormal(vec2 uv) {
    float paso = ${f(CFG.BG_NOISE.gradientStep)};
    float h = bgNoiseHeight(uv);
    float hx = bgNoiseHeight(uv + vec2(paso, 0.0));
    float hy = bgNoiseHeight(uv + vec2(0.0, paso));
    /**
     * SE DIVIDE POR EL PASO, y eso NO es un detalle: una diferencia finita solo es la
     * DERIVADA si se divide por la distancia a la que se tomó. Sin división el resultado
     * no es la inclinación de la superficie sino "cuánto cambió la altura en 0,004 UV",
     * un número diminuto que no depende de la escala del ruido. Medido: sin dividir, el
     * efecto daba 0,16 de diferencia frente a 22,65 del HDR — invisible.
     *
     * PERO DIVIDIR LA DISPARA (segundo fallo, medido). Con la escala y el paso de la
     * config el gradiente sale del orden de CIENTOS, y multiplicado por la fuerza de la
     * perilla la fase del espectro se envolvía decenas de veces: el fondo dejó de tener
     * textura y se convirtió en un mapa de curvas de nivel psicodélico.
     *
     * La solución no es bajar el número a ojo —eso solo esconde el problema y lo deja
     * dependiendo de la escala del ruido— sino ACOTAR la magnitud. La compresión suave
     * g/(1+|g|) deja el resultado en (-1, 1) y, con ello, la perilla pasa a ser
     * LITERALMENTE la perturbación máxima de la fase en unidades de UV: predecible, e
     * independiente de la escala del ruido y del paso del muestreo.
     */
    vec2 g = vec2((h - hx) / paso, (h - hy) / paso);
    return (g / (1.0 + length(g))) * uBgNoiseStrength;
  }

  /**
   * REFLEJO DE ESPEJO DEL METAL: el entorno (el arte subido, o sea el cielo) reflejado
   * DENTRO del acero.
   *
   * Se proyecta como ENTORNO, no como calco: se perturba la normal con ruido (el pulido
   * tiene micro-facetas), se refleja la dirección de vista y de ahí sale el UV del cielo.
   * Eso hace que las nubes CURVEN con el ángulo de la superficie, que es lo que distingue
   * un espejo de una calcomanía.
   *
   * NO es una copia de textura en coordenada desplazada (que es lo que triplicaba el
   * wordmark): el offset lo produce una perturbación de NORMAL, así que la imagen reflejada
   * es siempre la misma zona del entorno deformada, nunca el texto repetido.
   */
  vec3 metalReflejo(vec2 uv, float cobertura, out float peso) {
    peso = 0.0;
    if (cobertura <= 0.0 || uMetalReflect <= 0.0) return vec3(0.0);
    vec2 abollado = bgNoiseNormal(uv * uMetalBumpScale)
      / max(uBgNoiseStrength, 0.05) * uMetalBump;
    /**
     * LA COORDENADA DEL ENTORNO. Aquí está el detalle que hace que se lea como espejo.
     *
     * Primer intento (fallo medido): se comprimía todo alrededor del centro con
     * (uv - 0.5) * curvatura. Como la carta es PLANA y mira al frente, eso mandaba toda la
     * placa a la MISMA zona del cielo — la más clara y uniforme — así que el metal no
     * reflejaba estructura, solo se BLANQUEABA: medido, la desviación de la placa caía de
     * 63 a 33 al subir el reflejo (se aplanaba hacia blanco) en vez de ganar detalle.
     *
     * Un espejo plano refleja el entorno que tiene delante: la muestra correcta está en la
     * MISMA zona que el metal, y lo que la convierte en reflejo de superficie es el
     * ABOLLADO (las micro-facetas del pulido). Así el metal hereda la ESTRUCTURA del cielo
     * —nubes claras y huecos oscuros— en su propio sitio, que es lo que de verdad se lee
     * como "reflejo tipo espejo" y no como un baño de blanco.
     *
     * La curvatura se queda como perilla de énfasis, mucho más suave.
     */
    vec2 espejo = clamp(uv + abollado + (uv - 0.5) * ${f(CFG.METAL_REFLECT.curvature)}, 0.0, 1.0);
    /**
     * EL ENTORNO ES SU PROPIO MAPA, no el fondo de la carta.
     *
     * Primera versión: el reflejo leía uLayer0 (el fondo del VTuber). Estaba mal por dos
     * motivos: (1) si el VTuber no tiene fondo subido esa capa está vacía y el metal salía
     * NEGRO — medido, justo el caso de "si el background no existe, que lo deje
     * transparente"; y (2) aunque hubiera fondo, el metal reflejaba el ARTE del personaje.
     *
     * Un reflejo describe DÓNDE ESTÁ el metal, no qué hay impreso detrás, así que su imagen
     * es una foto de cielo propia (components/metal-env.webp). Con su propio alfa, la
     * cobertura se resuelve DENTRO del mapa: donde no hay entorno el reflejo simplemente no
     * entra, sin perillas extra ni casos especiales.
     */
    vec4 env = texture2D(uMetalEnvMap, espejo);
    /**
     * PESO DEL REFLEJO: la fuerza del metal por la cobertura del entorno.
     *
     * OJO CON EL ÁMBITO (defecto real, dos veces): este peso se calculó leyendo
     * layer1..layer5, que son locales de main() — el programa NO compilaba (glError 1282,
     * carta entera en negro) sin un solo error en tsc, en los tests ni en check-shaders. Y
     * la lectura del entorno tiene que ir ANTES del peso porque el peso usa su alfa; al
     * revés el error es 'env : undeclared identifier'. Los dos fallos se ven SOLO al
     * compilar el GLSL de verdad, que es exactamente para lo que está el harness.
     */
    peso = clamp(cobertura * uMetalReflect * env.a, 0.0, 1.0);
    /**
     * EL REFLEJO SE NORMALIZA POR EL GRIS MEDIO DEL ENTORNO.
     *
     * POR QUÉ (fallo medido, muy visible)
     * ----------------------------------
     * Multiplicar el metal por el cielo tal cual lo ACLARA en vez de modularlo: la imagen del
     * entorno es muy clara (gris medio 0.826, medido: 210.6/255), así que el metal hereda ese
     * blanco y la superficie se lava. Se veía en la placa del título, que pasaba de 146 a 183
     * de luminancia al encender el reflejo — más clara, pero con menos color del metal.
     *
     * Dividiendo por su propio gris medio, el entorno pasa a modular EN TORNO a la luminancia
     * del metal: las zonas claras del cielo suben un poco, las oscuras bajan, y el gris queda
     * igual. Eso es lo que diferencia un REFLEJO de un BAÑO DE LUZ, y hace que el reflejo
     * funcione con cualquier imagen de entorno, clara u oscura.
     */
    vec3 gris = vec3(${f(CFG.METAL_REFLECT.envMean)});
    return env.rgb / max(gris, vec3(0.05));
  }

  /**
   * COMPRESIÓN DEL CANAL DE LUZ (el rolloff del brillo).
   *
   * POR QUÉ SE COMPRIME LA LUZ SOLA Y NO EL COLOR SUMADO (fallo medido)
   * ------------------------------------------------------------------
   * La primera versión comprimía el color ya compuesto con un codo alto. Sobre un fondo
   * oscuro se veía bien, pero con una imagen CLARA el arte cae por encima del codo y la
   * compresión se lo come: medido con un cielo de nubes (arte ~212), un codo en 0.45
   * dejaba el cielo en 206 y uno en 0.25 en 186 — el HDR OSCURECÍA la imagen en lugar de
   * darle brillo, y el efecto era invisible justo en el caso que se quería lucir.
   *
   * Aquí la luz se comprime en su PROPIO canal: entra empezando en 0, así que no hay zona
   * de identidad que respetar y el ARTE no se toca nunca (por claro que sea). El rolloff
   * es suave y se acerca al techo sin llegar a recortarse, que es lo que da el aspecto de
   * luz con rango en vez de mancha plana.
   */
  vec3 hdrLuz(vec3 luz) {
    float techo = max(uHdrCeiling, 0.05);
    vec3 x = max(luz, 0.0) / techo;
    return techo * (x / (1.0 + x * ${f(1 / CFG.HDR.headroom)}));
  }

  /**
   * Espectro visible -> RGB. El color de una lámina holográfica NO se elige: sale
   * del ORDEN DEL ESPECTRO. Por eso se convierte una longitud de onda normalizada
   * (0 = violeta ~380nm, 1 = rojo ~700nm) a su color real, en vez de mezclar
   * colores arbitrarios. La documentación del efecto es explícita: una lámina
   * creíble recorre sus tonos EN SECUENCIA y nunca salta de verde a magenta.
   *
   * El CUERPO de esta función se genera desde SPECTRUM.stops (config): las paradas
   * —violeta, azul, cian, verde, amarillo, rojo— y sus umbrales salen de la lista, no
   * de literales sueltos aquí. Aquí solo queda el nombre de cada parada.
   */
${SPECTRUM_FN}

  /**
   * INTERFERENCIA DE PELÍCULA DELGADA, que es el fenómeno real de una lámina
   * holográfica (y de una pompa de jabón o la cara de un CD).
   *
   * Física: la lámina tiene un espesor de unos cientos de nanómetros. La luz se
   * refleja a la vez en su cara superior y en la inferior; los dos reflejos llegan
   * desfasados, así que se CANCELAN unas longitudes de onda y se REFUERZAN otras.
   * Ese desfase es la diferencia de camino óptico, y vale aproximadamente
   * 2 * d * cos(theta_refraccion): cuanto MÁS OBLICUO es el ángulo de visión
   * (cos -> 0), MENOR es el desfase, y el color reforzado se corre hacia el
   * extremo azul del espectro. Al inclinar la carta el color recorre el arcoíris
   * entero, que es exactamente lo que se ve en una carta real.
   *
   * De aquí sale también por qué los BORDES se ven más holográficos, que era la
   * pregunta: en los cantos el vector de visión es más oblicuo respecto a la
   * normal, así que el corrimiento espectral es mayor y el arcoíris es más
   * marcado. No es un adorno puesto en el borde: es la misma fórmula con otro
   * ángulo.
   *
   * @param cosTheta coseno del ángulo entre la visión y la normal (1 = de frente)
   * @param espesor espesor óptico en unidades arbitrarias (controla cuántas
   *                bandas de color caben en el recorrido angular)
   * @param fase desplazamiento para que las capas no vayan sincronizadas
   */
  float thinFilmWavelength(float cosTheta, float espesor, float fase) {
    // Diferencia de camino óptico: 2*d*cos(theta). Se le suma la fase y se toma la
    // parte fraccionaria: cada franja de interferencia es un ciclo del espectro.
    float camino = espesor * cosTheta + fase;
    return fract(camino);
  }

  // Reflejo tipo "rainbow foil": ahora sí, bandas de interferencia reales.
  vec3 spectralFoil(vec2 uv, float t) {
    float x = uv.x * ${f(CFG.SPECTRUM.foil.x)} + uv.y * ${f(CFG.SPECTRUM.foil.y)} + t * ${f(CFG.HOLOGRAM.timeShift)};
    // El patrón espacial hace de variación de espesor de la lámina: por eso el
    // arcoíris se reparte en franjas por la superficie y no es un color plano.
    float w = fract(x * ${f(CFG.SPECTRUM.foil.cycles)});
    return wavelengthToRgb(w);
  }

  /**
   * Reflejo especular: simula una fuente de luz blanda rebotando en una
   * superficie con brillo (el "gloss" del barniz de una carta real). Devuelve el
   * resplandor y su máscara para poder aplicarlo como CAPA SUPERPUESTA de color
   * (blend de luz) en vez de sustituir el arte.
   */
  vec2 specularGloss(vec2 uv, vec2 pointer, vec3 nrm) {
    // Dirección de la fuente rotada por el tilt de la carta: al inclinarla, el
    // brillo se desplaza como en una lámina física.
    vec2 lightDir = vec2(
      ${f(CFG.GLOSS.lightDirX)} + uTilt.y * ${f(CFG.GLOSS.tiltInfluence)},
      ${f(CFG.GLOSS.lightDirY)} + uTilt.x * ${f(CFG.GLOSS.tiltInfluence)}
    ) - uv;
    float d = length(lightDir);
    float core = pow(clamp(1.0 - d * ${f(CFG.GLOSS.coreTightness)}, 0.0, 1.0), ${f(CFG.GLOSS.coreFalloff)});

    // Franja vertical estrecha: el reflejo alargado típico de una lámina.
    float band = smoothstep(
      ${f(CFG.GLOSS.bandHalfWidth)},
      0.0,
      abs(lightDir.x * ${f(CFG.GLOSS.bandTiltX)} + lightDir.y * ${f(CFG.GLOSS.bandTiltY)})
    );

    // Parallax con el puntero: el brillo "sigue" al cursor, muy sutil.
    float pointerBoost = pow(
      clamp(1.0 - distance(uv, pointer * 0.5 + 0.5) * ${f(CFG.GLOSS.pointerRadius)}, 0.0, 1.0),
      ${f(CFG.GLOSS.pointerFalloff)}
    );

    // Borde (Fresnel): en los cantos la lámina siempre brilla más.
    float fresnel = pow(
      1.0 - clamp(dot(normalize(nrm), normalize(vViewPosition)), 0.0, 1.0),
      ${f(CFG.GLOSS.fresnelPower)}
    );

    float amount = clamp(
      core * ${f(CFG.GLOSS.coreWeight)}
        + band * ${f(CFG.GLOSS.bandWeight)}
        + pointerBoost * ${f(CFG.GLOSS.pointerWeight)}
        + fresnel * ${f(CFG.GLOSS.fresnelWeight)},
      0.0,
      1.0
    );
    return vec2(amount, fresnel);
  }

  /**
   * Máscara de la ZONA DE IMAGEN: 1 dentro de la banda del personaje y 0 fuera,
   * con un tramo de transición para que el efecto no termine en un corte recto.
   */
  float artZoneMask(vec2 uv) {
    float fade = ${f(CFG.ART_ZONE.fade)};
    float arriba = smoothstep(uArtZone.x - fade, uArtZone.x + fade, uv.y);
    float abajo = 1.0 - smoothstep(uArtZone.y - fade, uArtZone.y + fade, uv.y);
    float zone = arriba * abajo;
    /**
     * El logotipo sale de la zona del HOLOGRÁFICO, pero se calcula por separado
     * para poder aplicarlo solo a esa capa: por eso esta función devuelve la zona
     * de la imagen sin restar el logo, y la supresión del holo se hace abajo con
     * logoCover.
     */
    return zone;
  }

  void main() {
    /**
     * COMPOSICIÓN DESDE LAS 7 CAPAS.
     *
     * Ya no hay rama alternativa: la carta se arma SIEMPRE desde las capas, así que
     * el antiguo else con uMap desapareció. Cada capa se muestrea desplazada por su
     * factor de paralaje (uParallaxFactors), que es lo que da la profundidad.
     */
    vec2 parallax = uPointer;
    vec4 layer0 = texture2D(uLayer0, vUv + parallax * uParallaxFactors[0]);
    vec4 layer1 = texture2D(uLayer1, vUv + parallax * uParallaxFactors[1]);
    vec4 layer2 = texture2D(uLayer2, vUv + parallax * uParallaxFactors[2]);
    vec4 layer3 = texture2D(uLayer3, vUv + parallax * uParallaxFactors[3]);
    vec4 layer4 = texture2D(uLayer4, vUv + parallax * uParallaxFactors[4]);
    vec4 layer5 = texture2D(uLayer5, vUv + parallax * uParallaxFactors[5]);
    vec4 layer6 = texture2D(uLayer6, vUv + parallax * uParallaxFactors[6]);

    // Degradado de marca cuando el fondo no cubre un píxel.
    vec3 themeGradient = mix(uSecondary, mix(uAccent, vec3(0.031, 0.035, 0.063), vUv.y), 0.55);
    vec3 base = themeGradient;
    base = mix(base, layer0.rgb, layer0.a);
    base = mix(base, layer1.rgb, layer1.a);
    base = mix(base, layer2.rgb, layer2.a);
    base = mix(base, layer3.rgb, layer3.a);
    base = mix(base, layer4.rgb, layer4.a);
    base = mix(base, layer5.rgb, layer5.a);
    base = mix(base, layer6.rgb, layer6.a);
    float finalAlpha = max(max(max(max(max(max(layer0.a, layer1.a), layer2.a), layer3.a), layer4.a), layer5.a), layer6.a);

    // Alcance del efecto: solo la imagen, nunca los items de la carta.
    float zone = artZoneMask(vUv);
    /**
     * Cobertura del logotipo, leída de su silueta real. sinLogo (1 fuera del
     * logo, 0 dentro) se calcula aquí para que TODAS las capas holográficas —la
     * interferencia, los emblemas de facción y el barrido— puedan suprimirse sobre
     * la marca sin repetir la resta en cada una.
     *
     * Se lee en la MISMA coordenada desplazada que el sticker (aplicando el
     * parámetro de paralaje del logo, con el puntero y no la inclinación): el
     * holograma tiene que apagarse debajo de donde la marca SE VE, no donde estaba.
     * Con la coordenada fija, al mover la carta la marca se corría y la supresión se
     * quedaba atrás, dejando un fantasma brillante con forma de logo en el sitio
     * viejo — justo el logo duplicado que se veía.
     */
    float logoCover = texture2D(uLogoMask, vUv + uPointer * uLogoParallax).r;
    float sinLogo = 1.0 - logoCover;

    // Normal en espacio de vista -> intensidad de Fresnel en los bordes.
    vec3 viewDir = normalize(vViewPosition);
    /**
     * Coseno del ángulo entre la visión y la normal de la superficie. Es la
     * variable de la que depende TODO el efecto holográfico real:
     *   - 1.0 = mirando la carta de frente (ángulo normal, poco desfase).
     *   - 0.0 = mirando el canto de refilón (ángulo oblicuo, desfase mínimo).
     * Por eso el mismo cálculo da un arcoíris tenue en el centro de la carta y
     * FUERTE en los bordes: allí el ángulo es rasante.
     */
    float cosView = clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0);
    float fresnel = pow(1.0 - cosView, ${f(CFG.GLOSS.surfaceFresnelPower)});

    // Barrido diagonal que sigue al puntero (el "glare" del holográfico).
    vec2 pointerUv = uPointer * 0.5 + 0.5;
    float distToPointer = distance(vUv, pointerUv);
    float glare = smoothstep(${f(CFG.HOLOGRAM.glareRadius)}, 0.0, distToPointer) * uGlareStrength;

    // Bandas holográficas inclinadas por el tilt de la carta.
    float tiltAmount = abs(uTilt.x) + abs(uTilt.y);
    float holoMask = clamp(
      uHasHolo * (uBaseMask + tiltAmount * uTiltFactor + glare),
      0.0,
      1.0
    );

    /**
     * LONGITUD DE ONDA REFORZADA, según la física de película delgada.
     *
     * cosView es el ángulo; al inclinar la carta (uTilt) el coseno baja y la
     * banda reforzada recorre el espectro. El uTime avanza la fase muy despacio
     * para que una carta quieta no quede muerta, pero el movimiento principal lo
     * produce el ÁNGULO, que es lo que hace una lámina de verdad.
     *
     * HOLOGRAM.viewAngleWeight fija cuántos ciclos de color caben entre verse de
     * frente y verse de canto; con el doble el salto de tono al inclinar es evidente
     * sin volverse un patrón de cebra.
     */
    /**
     * El color de la lámina depende de DOS cosas, y el orden importa:
     *
     *   1. El ESPESOR VARÍA POR LA SUPERFICIE. Eso es lo que produce las franjas de
     *      color repartidas por una carta real. Es el término espacial y debe
     *      DOMINAR el patrón.
     *   2. El ÁNGULO de visión desplaza el conjunto (uTilt), que es lo que hace que
     *      el arcoíris recorra la carta al inclinarla.
     *
     * El recorrido espacial es SUAVE (HOLOGRAM.surfaceX + surfaceY): se probó a
     * multiplicar los ciclos y el arcoíris se volvía visible por toda la carta, que
     * es el exceso de saturación que había que corregir. Con este reparto el tono
     * cambia de una zona a otra sin dibujar franjas.
     */
    float faseEspesor = vUv.x * ${f(CFG.HOLOGRAM.surfaceX)} + vUv.y * ${f(CFG.HOLOGRAM.surfaceY)}
      + uTilt.y * ${f(CFG.HOLOGRAM.tiltShift)} + uTime * ${f(CFG.HOLOGRAM.timeShift)};
    float filmColorW = fract(cosView * ${f(CFG.HOLOGRAM.viewAngleWeight)} + faseEspesor);
    vec3 filmColor = wavelengthToRgb(filmColorW);
    /**
     * DESATURACIÓN del espectro y suelo metálico.
     *
     * La mezcla estaba al 72% y el resultado eran colores casi PUROS (un rojo 1.0,
     * 0.2, 0.16), que es lo que hacía que la holografía se viera saturada en exceso.
     * Una lámina holográfica real NO muestra color puro: es un metal pálido con el
     * matiz por encima, porque el reflejo metálico añade blanco a todo.
     *
     * Se aplican dos correcciones:
     *   1. El espectro se desatura hacia su propia luminancia (se mezcla con gris del
     *      mismo brillo), que baja el croma sin oscurecer ni lavar el tono.
     *   2. El suelo metálico pesa más que el color (HOLOGRAM.metalFloorMix), así el
     *      metal domina y el arcoíris solo lo tiñe.
     */
    float lumFilm = dot(filmColor, vec3(0.2126, 0.7152, 0.0722));
    filmColor = mix(filmColor, vec3(lumFilm), ${f(CFG.HOLOGRAM.spectrumDesaturation)});
    vec3 metalGround = mix(${vec3(CFG.HOLOGRAM.metalGround)}, filmColor, ${f(CFG.HOLOGRAM.metalFloorMix)});
    vec3 foil = metalGround * holoMask * uHolo;

  // --- CAPA 1: barniz realista (reflejo especular) ---------------------------
    // Se aplica como luz SUPERPUESTA (aditiva y ponderada por la luminancia del
    // arte), no como sustituto del color: ilumina sin manchar ni lavar la carta.
    vec2 gloss = specularGloss(vUv, uPointer, vNormal);
    float glossAmount = gloss.x * uGloss;
    // El brillo respeta el arte: sobre zonas ya claras aporta menos (evita el
    // efecto "lechoso" que arruina los colores planos).
    float luminance = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float glossWeight = mix(
      1.0,
      uHighlightWeight,
      smoothstep(${f(CFG.GLOSS.highlightLuminanceFrom)}, ${f(CFG.GLOSS.highlightLuminanceTo)}, luminance)
    );
    vec3 glossLayer = vec3(1.0, 0.99, 0.97) * glossAmount * glossWeight;

    // --- CAPA 2: holografía (interferencia) -----------------------------------
    // Se mezcla DESPUÉS del barniz y con peso propio, en modo luz, para que
    // ambas capas convivan sin taparse una a la otra.
    /**
     * PESO de la capa holográfica sobre el arte: HOLOGRAM.layerWeight (venía de
     * 0.42, 0.22, 0.12, 0.06).
     *
     * Esta es la perilla correcta para la SATURACIÓN, no el uHolo. uHolo es una
     * intensidad global (apagaba todas las contribuciones del holograma por igual,
     * incluidas las que dan el tono metálico); este factor decide cuánto del color
     * espectral se SUMA al arte, que es lo que se ve cargado. El usuario pidió
     * bajarlo dos veces: 0.12 -> 0.06 -> 0.03, la mitad cada vez.
     */
    vec3 holoLayer = foil * uLayerWeight;

    // --- CAPA 3: emblemas de FACCIÓN como holograma ---------------------------
    // Cada VTuber tiene entre 2 y 4 facciones. Se reparten por la lámina en
    // cuatro posiciones (no se apilan en el centro) y se mezclan en modo LUZ para
    // que se lean como holograma superpuesto sin manchar la carta. Cada emblema
    // recibe su propio tinte iridiscente y su fase de latido, así no parecen un
    // mismo sello repetido.

    if (uFactionCounts.x > 0.5) {
      // Posición de cada slot en la carta (x,y) y su tamaño relativo, generados
      // desde FACTION.slots: 1º arriba-derecha, 2º abajo-izquierda,
      // 3º arriba-izquierda, 4º abajo-derecha.
      vec2 slots[4];
${FACTION_SLOTS}
      float sizes[4];
${FACTION_SIZES}

      for (int i = 0; i < 4; i++) {
        float activo = (i == 0) ? uFactionCounts.x
                     : (i == 1) ? uFactionCounts.y
                     : (i == 2) ? uFactionCounts.z
                     : uFactionCounts.w;
        if (activo < 0.5) continue;

        vec2 slot = slots[i];
        float size = sizes[i];
        // Parallax por slot: cada emblema se desplaza con el puntero a distinta
        // intensidad, dando sensación de capas a distinta profundidad.
        float depth = 1.0 + float(i) * 0.5;
        vec2 fUv = (vUv - slot - uPointer * ${f(CFG.FACTION.pointerParallax)} * depth) / size + 0.5;
        if (fUv.x < 0.0 || fUv.x > 1.0 || fUv.y < 0.0 || fUv.y > 1.0) continue;

        vec4 fac;
        if (i == 0) fac = texture2D(uFactionMap0, fUv);
        else if (i == 1) fac = texture2D(uFactionMap1, fUv);
        else if (i == 2) fac = texture2D(uFactionMap2, fUv);
        else fac = texture2D(uFactionMap3, fUv);

        // Los emblemas traen el interior en negro OPACO (~30-45% del PNG), así que
        // usar solo el alfa los hacía invisibles: su color casi negro se multiplica
        // a sí mismo. Se usa el BRILLO del trazo como intensidad, de modo que las
        // líneas del emblema lucen y su relleno oscuro no aporta nada.
        float facLum = max(max(fac.r, fac.g), fac.b);
        float facStroke = smoothstep(${f(CFG.FACTION.strokeLow)}, ${f(CFG.FACTION.strokeHigh)}, facLum);
        float facAlpha = fac.a * facStroke * uFactionStrength;
        // Latido desfasado por slot: los emblemas no pulsan al unísono.
        float pulse = ${f(CFG.FACTION.pulseBase)} + ${f(CFG.FACTION.pulseAmplitude)} * sin(
          uTime * ${f(CFG.FACTION.pulseSpeed)} + float(i) * ${f(CFG.FACTION.pulsePhase)}
            + vUv.y * ${f(CFG.FACTION.pulseSurface)}
        );
        float facMask = facAlpha * (
          ${f(CFG.FACTION.maskBase)} + tiltAmount * ${f(CFG.FACTION.maskTilt)} + glare * ${f(CFG.FACTION.maskGlare)}
        ) * pulse;
        // Tinte iridiscente propio de cada slot.
        vec3 facTint = mix(
          vec3(1.0),
          spectralFoil(
            fUv * ${f(CFG.FACTION.tintUvScale)} + uPointer * ${f(CFG.FACTION.tintPointer)}
              + float(i) * ${f(CFG.FACTION.tintPhase)},
            uTime
          ),
          ${f(CFG.FACTION.tintSpectrumMix)}
        );
        vec3 facLayer = fac.rgb * facTint * facMask;
        // Los emblemas son holograma: se suprimen sobre el logo, igual que la
        // capa de interferencia, para no teñir la marca.
        base += (base * facLayer * ${f(CFG.FACTION.selfTint)} + facLayer * ${f(CFG.FACTION.addedLight)}) * sinLogo;
      }
    }

    // --- CAPA 4: HOLOGRAMA DE CONTRASTE (paso alto) --------------------------
    // Se toma la máscara de bordes del arte (diferencia contra una versión
    // desenfocada) y se suma en modo LUZ. Efecto: los contornos del personaje se
    // encienden como un holograma, con un realce de detalle que no existe en la
    // imagen original. Se modula con el tilt y el glare para que solo cobre fuerza
    // cuando la carta se mueve, como el foil de una carta real.
    vec3 edgeLayer = vec3(0.0);
    vec4 edgeTex = texture2D(uEdgeMap, vUv);
    if (uEdgeStrength > 0.001) {
      // La máscara ya viene en escala de grises con la intensidad calculada en CPU
      // (lineart = 1.0, piel = 0.55); aquí solo se lee.
      float edgeLum = dot(edgeTex.rgb, vec3(0.2126, 0.7152, 0.0722));
      /**
       * El tinte del lineart y la piel se evalúa en el ángulo RASANTE: esas zonas
       * se ven más holográficas porque allí el vector de visión es más oblicuo y
       * el corrimiento espectral de la película delgada es mayor. Es el mismo
       * cálculo que en la superficie, con otro ángulo.
       */
      /**
       * El espesor es mayor que en la superficie: en el borde el arcoíris recorre
       * más ciclos, que es lo que produce el efecto "más holográfico" del canto.
       *
       * NOTA: se probó a dar aquí un patrón espacial muy marcado
       * (vUv.x * 3.4 + vUv.y * 2.1) para repartir el tono por la superficie, y el
       * resultado fue PEOR: al multiplicar los ciclos, el arcoíris se volvía visible
       * en todo el personaje y la carta quedaba cargada de franjas. Se revirtió a la
       * variación suave de la config, que es la que se había aprobado.
       */
      float cosEdge = clamp(cosView - ${f(CFG.EDGE.angleOffset)}, 0.0, 1.0);
      float edgeFilm = thinFilmWavelength(
        cosEdge,
        ${f(CFG.EDGE.filmThickness)},
        uTime * ${f(CFG.EDGE.timeShift)} + vUv.x * ${f(CFG.EDGE.surfaceShift)}
      );
      vec3 edgeTint = wavelengthToRgb(edgeFilm);
      // El realce sube con la inclinación y el puntero, y nunca baja del piso de la
      // config: el efecto tiene que verse también con la carta quieta.
      float edgeMask = edgeTex.a * clamp(
        ${f(CFG.EDGE.maskBase)} + tiltAmount * ${f(CFG.EDGE.maskTilt)} + glare * ${f(CFG.EDGE.maskGlare)},
        0.0,
        ${f(CFG.EDGE.maskCeiling)}
      );
      edgeLayer = edgeTint * edgeLum * edgeMask * uEdgeStrength;
    }

    // Las tres capas se escalan por zone: fuera de la imagen no aportan nada, así
    // que la cabecera, los chips, la frase y el pie quedan con su color plano.
    /**
     * Alcance de cada capa:
     *   - zone limita todo a la IMAGEN (los items de la carta quedan limpios).
     *   - sinLogo SUPRIME EL HOLOGRAMA sobre la silueta del logotipo: es una
     *     marca plana y el arcoíris la vuelve ilegible.
     *   - El BARNIZ se mantiene sobre el logo: en una carta real el reflejo pasa
     *     por encima de la marca impresa.
     */
    glossLayer *= zone;
    holoLayer *= zone * sinLogo;
    edgeLayer *= zone;

    /**
     * COMPOSICIÓN EN DOS CANALES: PIGMENTO y LUZ.
     *
     * POR QUÉ SE SEPARAN (esto es lo que hace posible el HDR sin estropear la carta)
     * ------------------------------------------------------------------------------
     * Antes había una sola variable: todo el efecto se sumaba sobre lit y se recortaba
     * al final. Con un solo canal no se puede subir la luz sin subir también el ARTE, así
     * que cualquier intento de "más brillo en los reflejos" acababa lavando al personaje.
     *
     * Reparto:
     *   · lit = PIGMENTO: el arte y los tonos medios. NO se toca (el codo HDR lo deja
     *     intacto por construcción, así que la carta sigue siendo la que se subió).
     *   · luzExtra = LUZ: reflejos, barniz, destellos, holograma. Es lo que se multiplica
     *     para el HDR y lo que después se comprime en el codo, porque es lo que en una foto
     *     real tiene rango y "quema" con degradado.
     */
    vec3 luzExtra = base * (glossLayer + holoLayer)
      + glossLayer * uGlossSelf
      + holoLayer * uHoloSelf
      + edgeLayer;
    vec3 lit = base;

    /**
     * REFLEJO VIVO DEL METAL (título y wordmark).
     *
     * POR QUÉ AQUÍ Y NO EN LA TEXTURA
     * -------------------------------
     * El acero del título y de la palabra del pie está PINTADO en canvas 2D (TEXT_FINISH)
     * y llega como píxeles ya resueltos: su brillo no puede moverse, por mucho que se
     * ajuste. Un reflejo que sigue al ratón tiene que calcularse en cada frame, y eso solo
     * pasa aquí. La textura aporta el material (sus paradas, su bisel) y este bloque
     * aporta el barrido: sumados se leen como una sola lámina pulida.
     *
     * El ALFA de cada capa hace de máscara, así que la banda de luz solo cae sobre la
     * placa y sobre las LETRAS —nunca en el hueco entre ellas ni sobre el personaje—. Es
     * la razón de no usar una máscara propia: la silueta ya está en la textura.
     */
    /**
     * Coordenada y centro RELATIVOS al medio de la carta, no absolutos: así el barrido
     * queda centrado por construcción y no hace falta corregirlo con medio ancho de banda
     * (que era un término de estructura colado en medio del efecto).
     */
    float sheenCoord = (vUv.x - 0.5) + (vUv.y - 0.5) * ${f(CFG.LIVE_SHEEN.slant)};
    float sheenPos = ${f(CFG.LIVE_SHEEN.centerOffset)}
      + uPointer.x * ${f(CFG.LIVE_SHEEN.pointerTravel)}
      + uTilt.y * ${f(CFG.LIVE_SHEEN.tiltTravel)};
    float sheenDist = abs(sheenCoord - sheenPos);
    float sheenWide = smoothstep(${f(CFG.LIVE_SHEEN.wideWidth)}, 0.0, sheenDist) * ${f(CFG.LIVE_SHEEN.wideGain)};
    float sheenCore = smoothstep(${f(CFG.LIVE_SHEEN.coreWidth)}, 0.0, sheenDist) * ${f(CFG.LIVE_SHEEN.coreGain)};
    float sheenAmount = (sheenWide + sheenCore) * uSheenStrength;
    // Solo las capas de metal: el título (3) y el wordmark (6).
    float sheenMask = clamp(max(layer3.a, layer6.a), 0.0, 1.0);
    // El barrido del metal ES luz: entra en el canal de luz para que el HDR lo lleve por
    // encima de blanco y su rolloff le devuelva el degradado (si se sumara al pigmento se
    // recortaría en una mancha blanca plana).
    float sheenNucleo = sheenAmount * sheenMask;
    luzExtra += sheenNucleo;

    /**
     * EL HALO DEL REFLEJO SE ELIMINÓ (petición del usuario: "borra el halo de reflejo").
     *
     * POR QUÉ SE FUE Y QUÉ DEJÓ APRENDIDO
     * ----------------------------------
     * Se había añadido para que la luz "sangrara" fuera del metal, porque un brillo
     * encerrado en su silueta no lee como luz de cámara. Pero el barrido es una coordenada
     * 1-D: "estar cerca del reflejo" define una LÍNEA diagonal sobre toda la carta, no un
     * punto, así que el halo iluminaba esa línea entera. Peor: al dilatarse leyendo la
     * textura del metal en puntos DESPLAZADOS, pintaba copias desplazadas del texto — el
     * wordmark "VTUBERDEX" salía TRIPLICADO (con la capa apagada, o con el barrido a 0,
     * desaparecía: el culpable era el halo, no el texto).
     *
     * La lección queda escrita porque es la trampa de esta carta: cualquier efecto que
     * muestree una capa de TEXTO en una coordenada desplazada REPLICA ese texto. El brillo
     * especular de verdad (que sí sangra) se resuelve abajo con la reflexión de entorno,
     * donde el desplazamiento es de una perturbación de NORMAL sobre el metal, no una copia
     * de la textura.
     */

    /**
     * CAPA 0: el FONDO del VTuber, por DEBAJO del personaje.
     *
     * POR QUÉ SE COMPONE AQUÍ Y NO AL PRINCIPIO
     * -----------------------------------------
     * El sitio natural parecería el arranque del shader, donde se arma base, pero
     * ahí el fondo todavía recibiría encima el barniz, la interferencia, los emblemas
     * y la tinta del frente: TODAS las capas del personaje se aplican sobre base, de
     * modo que el fondo saldría teñido con el efecto del frente y sus perillas
     * propias —lo que se pide— quedarían diluidas en las del personaje. Compuesto
     * después, cada capa conserva su carácter: el frente con su holograma suave y el
     * fondo con el suyo, más marcado.
     *
     * POR QUÉ NO HAY SAMPLERS PROPIOS (fallo medido)
     * ----------------------------------------------
     * Esta capa llegó a leer uBackgroundMap, uBackgroundMask y uBgEdgeMap: TRES
     * samplers más que, sumados a los siete de las capas, llevaban el shader a 18
     * samplers contra un límite de 16 del driver. El material NO compilaba
     * ("Implementation limit of 16 active fragment shader samplers exceeded") y la
     * carta salía NEGRA, sin un error en tsc, en los tests ni en el build — los tres
     * corren sin WebGL.
     *
     * Ahora el fondo se compone con lo que YA está muestreado:
     *   · El ART es layer0, que es la capa 0 y trae su propio paralaje.
     *   · La COBERTURA (dónde el personaje no tapa) sale del ALFA de layer1, la capa
     *     del personaje: esa capa se dibuja aislada y transparente, así que su alfa
     *     es exactamente 1 donde hay personaje y 0 donde no. Antes esa cobertura
     *     viajaba como textura aparte (characterAlphaMask) sólo porque la carta era
     *     una imagen única y opaca; con las capas separadas, el dato ya está aquí.
     */
    {
      /**
       * El contenido se muestrea con el desplazamiento que ya tiene layer0; la
       * cobertura se lee del alfa de layer1.
       *
       * Ese reparto es lo que produce la sensación de profundidad: el agujero de la
       * silueta se queda donde está —es parte del personaje, del plano de delante— y
       * lo que se desliza por detrás es la escena.
       */
      vec3 bgArt = layer0.rgb;
      /**
       * COBERTURA: el fondo solo pinta donde NO hay nada más encima.
       *
       * Antes era 1.0 - layer1.a, es decir "todo donde no esté el personaje". Eso
       * incluía el título, los textos, los tags y el wordmark (capas 2..6), que en esas
       * zonas quedaban REEMPLAZADOS por el arte del fondo: el bloque de abajo hacía una
       * mezcla sobre un lit que YA llevaba esas capas compuestas. En una carta con
       * fondo, los textos desaparecían.
       *
       * Ahora la cobertura descuenta también el alfa de las capas superiores, así que el
       * fondo solo actúa en los píxeles que nadie más reclama. La capa 0 sigue por
       * DEBAJO porque base ya la compone antes que las capas 1..6.
       */
      float upperCover = max(max(max(layer2.a, layer3.a), max(layer4.a, layer5.a)), layer6.a);
      float bgCover = 1.0 - max(layer1.a, upperCover);

      /**
       * Interferencia del fondo: MISMO modelo de película delgada que el frente, mismos
       * pesos de HOLOGRAM y —esto es lo que se corrigió— MISMAS frecuencias espaciales
       * (HOLOGRAM surfaceX y surfaceY), no las suyas propias.
       *
       * POR QUÉ (fallo medido): antes esta capa sumaba un patrón propio de 5 ciclos
       * (BACKGROUND.foilCycles, contra 1.6 del frente) y frecuencias de superficie
       * distintas (2.1/1.2 contra 1.1/0.8), así que las franjas del fondo tenían otra
       * ESCALA que las del personaje. El resultado eran dos tramas holográficas
       * desalineadas sobre la misma carta: el efecto se leía falso, como una calcomanía
       * pegada encima. Un holograma es una propiedad de la SUPERFICIE que se mira, no de
       * la imagen que hay debajo: la franja tiene que medir lo mismo en las dos capas.
       *
       * Lo que sí distingue al fondo es la INTENSIDAD y el CROMA (uBgHolo,
       * uBgLayerWeight), no la frecuencia. La ANIMACIÓN temporal se conserva con su
       * propio ritmo (BACKGROUND timeShift), que es un desfase deliberado: el fondo no
       * cambia de color al unísono con el personaje, igual que en una lámina real la
       * capa de detrás no late con la de delante.
       */
      vec2 bgUv = vUv + uPointer * uParallaxFactors[0];
      /**
       * TEXTURA DE MICRO-SUPERFICIE del fondo.
       *
       * Hasta aquí el holograma del fondo se deslizaba UNIFORME por toda la lámina: la
       * superficie era matemáticamente lisa, así que reflejaba igual en cada punto y se
       * leía como plástico pulido. Un material real tiene micro-relieve: cada punto
       * refleja con un ángulo ligeramente distinto y eso rompe el reflejo en facetas.
       *
       * Aquí se genera ese relieve (ruido fractal, sin gastar sampler) y su gradiente se
       * usa como INCLINACIÓN local. La inclinación desplaza las FASES de abajo, así que
       * las bandas de color ya no avanzan en paralelo: se ondulan siguiendo la textura.
       *
       * ORDEN (fallo medido): el ruido tiene que calcularse ANTES de derivar los colores
       * del espectro. La primera versión perturbaba las fases DESPUÉS de haber calculado
       * bgFilm y bgEdgeSpectrum, así que la perturbación no llegaba a leerse — el efecto
       * medía exactamente 0 píxeles de diferencia y parecía que el ruido no servía.
       * Se calcula primero la faceta, después se pliegan las fases, y solo entonces se
       * convierten a color.
       */
      vec2 bgNormal = bgNoiseNormal(bgUv);
      float bgFaceta = bgNormal.x + bgNormal.y;
      float bgPhase = fract(
        bgUv.x * ${f(CFG.HOLOGRAM.surfaceX)} + bgUv.y * ${f(CFG.HOLOGRAM.surfaceY)}
          + uTilt.y * ${f(CFG.BACKGROUND.tiltShift)} + uTime * ${f(CFG.BACKGROUND.timeShift)}
          + bgFaceta * ${f(CFG.BG_NOISE.phaseFromNormal)}
      );
      /**
       * Fase PROPIA del canto: va atada al giro (uTilt) y no al puntero, para que las
       * bandas del borde no viajen sincronizadas con las del resto de la lámina. Si
       * compartieran fase, el efecto se leería como una sola textura deslizándose.
       */
      float bgEdgePhase = uTilt.x * ${f(CFG.HOLOGRAM.viewAngleWeight)}
        + uTime * ${f(CFG.BACKGROUND.timeShift)}
        + bgFaceta * ${f(CFG.BG_NOISE.phaseFromNormal)};
      vec3 bgFilm = wavelengthToRgb(fract(cosView * ${f(CFG.HOLOGRAM.viewAngleWeight)} + bgPhase));
      /**
       * Desaturación y suelo metálico con perillas PROPIAS, más generosas que las del
       * frente: BACKGROUND.metalFloorMix pesa más que HOLOGRAM.metalFloorMix, así que
       * el matiz domina sobre el gris y el fondo se lee como una lámina teñida en vez
       * de un metal apagado.
       */
      float bgFilmLum = dot(bgFilm, vec3(0.2126, 0.7152, 0.0722));
      bgFilm = mix(bgFilm, vec3(bgFilmLum), ${f(CFG.BACKGROUND.spectrumDesaturation)});
      vec3 bgFoilColor = mix(${vec3(CFG.HOLOGRAM.metalGround)}, bgFilm, ${f(CFG.BACKGROUND.metalFloorMix)});

      // Barrido del puntero propio: mismo gesto que el del frente, otra caída y otro radio.
      float bgGlare = smoothstep(
        ${f(CFG.BACKGROUND.glareRadius)}, 0.0, distance(vUv, pointerUv)
      ) * uBgGlareStrength;
      float bgMask = clamp(
        uBgBaseMask + tiltAmount * uBgTiltFactor + bgGlare, 0.0, 1.0
      ) * uBgHolo;

      /**
       * TINTE HOLOGRÁFICO DEL BORDE.
       *
       * El holograma del fondo iba repartido por igual, así que su canto quedaba apagado:
       * en una lámina real el ángulo rasante del borde es el que más desplaza el color.
       * El frente ya tenía su Fresnel; al fondo le faltaba.
       *
       * Se AÑADE al bgMask en lugar de sustituirlo, para que el holograma de superficie
       * que ya había no se pierda: lo que cambia es que ahora el contorno tiene más.
       * El espectro del borde usa una fase propia (bgEdgePhase, atada al giro) para que
       * las bandas del canto no vayan sincronizadas con las del resto de la lámina.
       */
      float bgEdgeFresnel = pow(fresnel, ${f(CFG.BACKGROUND.edgeTintPower)});
      vec3 bgEdgeSpectrum = wavelengthToRgb(
        fract(bgEdgePhase + bgEdgeFresnel * ${f(CFG.BACKGROUND.edgeTintCycles)})
      );
      vec3 bgEdgeTint = bgEdgeSpectrum * bgEdgeFresnel * ${f(CFG.BACKGROUND.edgeTint)};

      /**
       * Composición sobre el arte del fondo. Se respeta su LUMINANCIA (un fondo oscuro
       * no puede encenderse como uno claro, o dejaría de parecer la imagen que se
       * subió: el arte se escala por su propia claridad) y el color espectral se SUMA,
       * que es lo que hace que el efecto se note aunque el fondo sea oscuro.
       */
      float bgLum = dot(bgArt, vec3(0.2126, 0.7152, 0.0722));
      vec3 bgArtLevel = bgArt * (uBgArtFloor + bgLum * ${f(CFG.BACKGROUND.artLumGain)});
      vec3 bgLayer = bgFoilColor * bgMask * uBgLayerWeight;
      /**
       * El tinte del canto entra SUMADO al arte, no dentro de bgLayer: el contorno tiene
       * que leerse aunque el holograma de superficie esté bajo (o en 0). Se multiplica por
       * bgCover igual que el resto para que no se derrame sobre el personaje.
       */
      vec3 bgLuz = bgArtLevel * bgLayer + bgLayer * uBgLayerWeight;
      bgLuz += bgEdgeTint * (bgArtLevel + ${f(CFG.BACKGROUND.edgeTintFloor)}) * uBgLayerWeight;
      lit = mix(lit, bgArtLevel, bgCover);
      luzExtra = mix(luzExtra, bgLuz, bgCover);
    }

    // Colores de marca del VTuber como tinte del borde.
    // El barrido glare es holograma: se anula sobre el logo.
    /**
     * BORDE METÁLICO.
     *
     * Antes el contorno solo sumaba el color de marca ponderado por el Fresnel, que
     * daba un filo de color PLANO. El metal tiene tres rasgos que eso no reproduce:
     *
     * 1. BARRIDO DIRECCIONAL: el reflejo del metal es una banda que recorre el
     *    contorno según el ángulo de visión y el puntero, no un brillo uniforme.
     * 2. CONTRASTE: hay zonas del borde más claras y otras más oscuras a la vez.
     * 3. ESPECTRO: en una lámina metálica el reflejo desplaza el color (el mismo
     *    principio de película delgada que el resto de la carta), así que el borde
     *    pasa por tonos en orden espectral en vez de quedarse en un color fijo.
     *
     * El Fresnel concentra todo esto en el CONTORNO (donde el ángulo es rasante),
     * que es exactamente donde el usuario lo pide.
     */
    float filoMetal = pow(fresnel, ${f(CFG.METAL_BORDER.filoPower)});
    // El barrido recorre el contorno con el tilt y el puntero.
    float barridoBorde = fract(
      vUv.x * ${f(CFG.METAL_BORDER.sweepX)} + vUv.y * ${f(CFG.METAL_BORDER.sweepY)}
        + uTilt.y * ${f(CFG.METAL_BORDER.sweepTilt)} + uPointer.x * ${f(CFG.METAL_BORDER.sweepPointer)}
    );
    float bandaBorde = smoothstep(${f(CFG.METAL_BORDER.bandHalfWidth)}, 0.0, abs(barridoBorde - 0.5));
    // Tono del metal: espectro real, desplazado por el ángulo de visión.
    vec3 tonoMetal = wavelengthToRgb(
      fract(cosView * ${f(CFG.METAL_BORDER.toneViewAngle)} + uTime * ${f(CFG.METAL_BORDER.toneTimeShift)})
    );
    // Suelo plateado: el metal no es color puro, es gris con el color encima.
    vec3 plateado = ${vec3(CFG.METAL_BORDER.silver)};
    vec3 metalBorde = mix(plateado, tonoMetal, ${f(CFG.METAL_BORDER.silverMix)});
    // Brillo del barrido (claro) y sombra entre barridos (oscura): el contraste.
    vec3 luzBorde = metalBorde * (${f(CFG.METAL_BORDER.lightBase)} + bandaBorde * ${f(CFG.METAL_BORDER.lightSweep)});
    // Se mezcla con el color de marca para que la carta conserve su identidad.
    vec3 bordeFinal = mix(mix(uAccent, uSecondary, vUv.y), luzBorde, ${f(CFG.METAL_BORDER.brandMix)});
    // El canto metálico y su destello son luz: al canal de luz, para el HDR.
    luzExtra += bordeFinal * filoMetal * ${f(CFG.METAL_BORDER.edgeWeight)};
    // Barrido extra, más brillante, para el destello del metal.
    luzExtra += plateado * bandaBorde * filoMetal * ${f(CFG.METAL_BORDER.sparkleWeight)} * sinLogo;

    /**
     * REFLEJO DE ESPEJO DEL METAL (petición: "reflejo tipo espejo con la imagen que te
     * adjunté"). El cielo se refleja DENTRO del acero: se perturba la normal con el ruido
     * de superficie, se refleja la dirección de vista y se lee el entorno — que es la
     * imagen del fondo, ya enlazada.
     *
     * Va al canal de LUZ y no al pigmento: es un reflejo especular, no pintura. Y por eso
     * pasa por el HDR, que es lo que le da el rango (núcleo brillante con caída) en vez de
     * una mancha blanca plana.
     *
     * La cobertura es la máscara del metal (título y wordmark): el reflejo NO puede caer
     * sobre el personaje. Y como la perturbación es de NORMAL, no un desplazamiento de
     * textura, esto NO replica el texto (que fue el defecto del halo eliminado).
     */
    float pesoEspejo = 0.0;
    vec3 entorno = metalReflejo(vUv, sheenMask, pesoEspejo);
    /**
     * El metal se MODULA con el entorno: su color multiplicado por lo que refleja. Es la
     * diferencia entre un espejo y un baño de blanco.
     *
     * Medido: sumarlo a la luz subía la media de la placa (182 -> 226) pero BAJABA su
     * desviación (63 -> 33), o sea que la aplanaba — un metal más claro pero con menos
     * estructura, que es justo lo contrario de un reflejo. Multiplicando el pigmento, la
     * placa conserva su contraste y hereda la estructura del cielo: nubes claras y huecos
     * oscuros dentro del acero.
     *
     * El refuerzo devuelve el brillo que se come la exposición del entorno, para que el
     * reflejo se vea sin lavar el color del metal.
     */
    lit = mix(lit, lit * entorno * uMetalGain, pesoEspejo);

    // Viñeta suave: solo un poco de caída en las esquinas. Antes bajaba muy por
    // debajo de 1 y oscurecía los bordes del arte; el suelo de VIGNETTE mantiene el
    // foco sin apagar la imagen.
    float vignette = smoothstep(
      ${f(CFG.VIGNETTE.outer)},
      ${f(CFG.VIGNETTE.inner)},
      distance(vUv, vec2(0.5))
    );
    /**
     * COMPOSICIÓN HDR: el arte intacto, la luz AMPLIFICADA y comprimida en su canal.
     *
     * El ORDEN es lo que importa:
     *   1. se amplifica el canal de luz (los reflejos pasan de 1.0),
     *   2. se comprime ESE canal con su rolloff (no el color ya sumado),
     *   3. y solo entonces se suma sobre el arte.
     *
     * Comprimir después de sumar era el fallo de la primera versión: con un fondo claro el
     * arte cae por encima del codo y la compresión lo oscurecía. Comprimiendo la luz por
     * separado, el arte no se toca NUNCA y el brillo conserva su degradado.
     *
     * La viñeta va al final, sobre el resultado: es atenuación de la carta, no luz.
     */
    vec3 luzFinal = hdrLuz(max(luzExtra, 0.0) * uHdrBoost);
    vec3 color = (lit + luzFinal) * mix(${f(CFG.VIGNETTE.floor)}, ${f(CFG.VIGNETTE.ceiling)}, vignette);

    /**
     * El brillo de marca NO se pinta aquí.
     *
     * Se probó y el usuario lo rechazó con razón: esta cara está recortada a la
     * silueta, así que cualquier luz sumada por distancia al borde cae ENCIMA del
     * arte en vez de escaparse. El resplandor vive en glowFragmentShader, en un
     * plano mayor que la carta y por detrás de ella, que solo enciende el anillo
     * exterior.
     */

    // La capa de color superpuesta no debe alterar el alfa del arte (el brillo
    // es luz, no pigmento): así no "mancha" los bordes recortados. La máscara de
    // esquinas va sobre el alfa para que el recorte coincida con el canto.
    float alpha = finalAlpha * cardCornerMask(vUv);
    if (alpha < ${f(CFG.SILHOUETTE.alphaCutoff)}) discard;

    /**
     * STICKER del LOGO: se aplica con su mezcla alfa SOBRE el color ya calculado,
     * después de todos los efectos. El logotipo recupera sus píxeles originales
     * (sin arcoíris, sin tinte y sin barrido) y mantiene su propia transparencia.
     *
     * El paralaje va como DESPLAZAMIENTO DE MÁSCARA, no de muestreo, y eso es
     * deliberado. La versión anterior desplazaba solo el arte y dejaba la máscara
     * fija; medido, eso parte la marca en dos: la máscara (la silueta) sigue en su
     * sitio mientras el arte se corre, así que dentro de la silueta entra un trozo
     * del logo vecino y fuera de ella se recorta el que debería estar. El resultado
     * es exactamente el "logo duplicado y raro" que se veía.
     *
     * Con el desplazamiento en la coordenada de MUESTREO, el arte y la máscara se
     * leen en el mismo punto relativo y la marca se mueve ENTERA y con su forma: se
     * un solo logo, desplazado respecto del personaje.
     */
    vec2 logoUv = vUv + uPointer * uLogoParallax;
    vec4 logoPix = texture2D(uLogoSticker, logoUv);
    float logoAlpha = logoPix.a * texture2D(uLogoMask, logoUv).r;
    if (logoAlpha > ${f(CFG.LOGO.stickerCutoff)}) {
      /**
       * BRILLO METÁLICO del logotipo.
       *
       * La versión anterior sumaba el brillo del barniz de la carta, que es una luz
       * BLANCA y difusa: sobre una marca clara no se distinguía nada, y por eso "no
       * tenía ningún efecto". El brillo metálico necesita tres cosas que el barniz
       * no da:
       *
       * 1. BARRIDO DIRECCIONAL: una banda de luz que cruza la marca según el tilt y
       *    el puntero, no una mancha difusa. El metal refleja en una dirección.
       * 2. CONTRASTE: el metal tiene zonas claras y zonas oscuras a la vez (el
       *    barrido se multiplica y también oscurece lo que queda a su espalda). Sin
       *    ese negativo el efecto es un lavado, no un brillo.
       * 3. TINTE FRÍO en las luces y cálido en las sombras: es lo que distingue el
       *    metal de una superficie pintada.
       */
      /**
       * El barrido metálico se calcula en la posición LOCAL del logo, la del
       * fragmento, no en la desplazada. Es el reflejo de una lámina: tiene que
       * recorrer la MARCA tal como se ve ahora, que es justo lo que se está mirando.
       * Con la coordenada desplazada el reflejo perseguiría la marca vieja y se
       * descuadraría del paralaje.
       */
      vec2 logoGloss = specularGloss(vUv, uPointer, vNormal);
      // Coordenada del barrido: diagonal, movida por el tilt y el puntero.
      float barrido = vUv.x * ${f(CFG.LOGO.sweepX)} + vUv.y * ${f(CFG.LOGO.sweepY)}
        + uTilt.y * ${f(CFG.LOGO.sweepTilt)} + uPointer.x * ${f(CFG.LOGO.sweepPointer)};
      // Banda estrecha y con borde suave: el reflejo del metal, no un halo.
      float banda = smoothstep(${f(CFG.LOGO.bandHalfWidth)}, 0.0, abs(fract(barrido) - 0.5));
      float intensidad = banda * ${f(CFG.LOGO.bandWeight)} + logoGloss.x * ${f(CFG.LOGO.specularWeight)};
      // Multiplica la luminancia de la marca (una marca oscura brilla menos que una
      // clara, como el metal real) y añade el especular por encima.
      vec3 metal = logoPix.rgb * (${f(CFG.LOGO.metalBase)} + intensidad * ${f(CFG.LOGO.metalGain)});
      // Luz fría del barrido y sombra cálida entre barridos.
      metal += ${vec3(CFG.LOGO.coolLight)} * banda * ${f(CFG.LOGO.coolLightWeight)};
      metal -= ${vec3(CFG.LOGO.warmShadow)} * (1.0 - banda);
      // Filo luminoso en el contorno: separa la marca del fondo y la hace "tallada".
      float filo = pow(1.0 - abs(logoPix.a - 0.5) * ${f(CFG.LOGO.rimWidth)}, ${f(CFG.LOGO.rimFalloff)}) * ${f(CFG.LOGO.rimWeight)};
      metal += vec3(1.0) * filo;
      color = mix(color, clamp(metal, 0.0, 1.6), clamp(logoAlpha, 0.0, 1.0));
    }

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Shader del GLOW EXTERIOR: el resplandor de marca que rodea la carta.
 *
 * POR QUÉ UN PLANO APARTE Y NO DENTRO DE LA CARA
 * ----------------------------------------------
 * El primer intento pintó el brillo en el shader de la CARA, sumándolo al color
 * final por distancia al borde. Dos problemas medidos:
 *
 *   1. La cara está recortada a la silueta, así que el resplandor se pintaba
 *      ENCIMA de la carta en lugar de escaparse por fuera. El usuario lo vio como
 *      "pusiste el brillo sobre la carta".
 *   2. El SDF recibe UV normalizado y devuelve distancia en unidades de carta; al
 *      remapear el UV antes de llamarlo, la banda se multiplicaba dos veces y teñía
 *      la carta entera.
 *
 * Este plano es más GRANDE que la carta (ver `GEOMETRY.glowSpread`), va DETRÁS de
 * ella y solo enciende el anillo exterior: la silueta queda hueca por dentro (alpha
 * 0), así que el arte nunca se lava. La caída es suave hacia fuera, sin corte
 * visible.
 */
export const glowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const glowFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uGlowColor;
  uniform float uGlowStrength;
  /** Rectángulo de la CARTA dentro de este plano, en UV de 0..1. */
  uniform vec2 uCardRect;
  uniform float uCardRadius;
  varying vec2 vUv;

  /**
   * Distancia con signo al CARD (negativa dentro de la carta, positiva fuera),
   * normalizada por la altura de la carta en este plano.
   *
   * uCardRect expresa qué fracción del plano ocupa la carta: el plano se estira
   * hasta GEOMETRY.glowSpread veces la carta, así que sus bordes están más allá de
   * 0 y 1. Todo lo que quede en la zona "fuera" contribuye; lo de dentro se apaga.
   */
  float cardDistance(vec2 uv) {
    vec2 p = (uv - 0.5) / uCardRect;
    vec2 halfSize = vec2(0.5);
    vec2 q = abs(p) - (halfSize - vec2(uCardRadius));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCardRadius;
  }

  void main() {
    float dist = cardDistance(vUv);
    /**
     * Caída EXPONENCIAL desde el borde de la carta, que es como decae la luz.
     *
     * Se probó antes un smoothstep hasta 0.5 y dejaba un CORTE RECTANGULAR visible:
     * la distancia máxima del plano (su esquina, ~0.23) nunca llegaba al final del
     * rango, así que el resplandor seguía encendido justo en el borde del plano. Una
     * exponencial no depende del tamaño del plano y cae rápido, ceñida al canto.
     */
    float falloff = exp(-dist * ${f(CFG.GLOW.falloffRate)});
    /** Filo más brillante pegado a la silueta: da un punto de contacto definido. */
    float core = exp(-dist * ${f(CFG.GLOW.coreRate)});
    float glow = falloff * ${f(CFG.GLOW.falloffWeight)} + core * ${f(CFG.GLOW.coreWeight)};

    /**
     * Suavizado de los cortes del resplandor, en PÍXELES.
     *
     * Se usa la derivada de la distancia (no un ancho fijo en unidades de carta)
     * porque el mismo plano se ve a 163 px en la grilla y a 420 px en el detalle: un
     * ancho fijo daría un borde más grueso en la carta pequeña. La cota inferior lo
     * protege de un fwidth anómalo en una carta diminuta.
     */
    float aa = max(fwidth(dist) * ${f(CFG.GLOW.aaPixels)}, ${f(CFG.GLOW.aaMin)});

    /**
     * Apagado en el BORDE DEL PROPIO PLANO, en coordenadas UV.
     *
     * Es la garantía de que el resplandor llega exactamente a cero antes de que se
     * acabe la geometría: sin esto, la esquina del plano conserva luz y se ve el
     * rectángulo. El degradado empieza donde ya casi no hay resplandor, así que no
     * corta la caída: solo remata las esquinas.
     */
    vec2 d = abs(vUv - 0.5) * 2.0;
    float edgeFade =
      (1.0 - smoothstep(${f(CFG.GLOW.edgeFadeFrom)} - aa, 1.0, d.x))
        * (1.0 - smoothstep(${f(CFG.GLOW.edgeFadeFrom)} - aa, 1.0, d.y));
    glow *= edgeFade;

    /**
     * rgb va sin atenuar y el alpha lleva toda la intensidad: con blending aditivo
     * el resultado es color * glow * strength, y así la perilla de intensidad y el
     * perfil de caída no se multiplican entre sí (que era lo que pasaba al escalar
     * los dos).
     */
    gl_FragColor = vec4(uGlowColor, glow * uGlowStrength);
  }
`;