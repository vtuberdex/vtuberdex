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

  uniform sampler2D uMap;
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
   * FONDO de la carta: la imagen del VTuber por DEBAJO del personaje.
   *
   * POR QUÉ LA MÁSCARA Y NO UNA COMPROBACIÓN DE ALFA
   * ------------------------------------------------
   * La tentación es leer el alfa de uMap y pintar el fondo donde el personaje sea
   * transparente. No sirve: uMap es la CARTA ya compuesta —el degradado del color
   * de tema se pinta OPACO sobre todo el lienzo antes del arte—, así que su alfa es 1
   * en cualquier píxel y la transparencia del personaje se perdió al componerla.
   *
   * La cobertura del personaje se calcula entonces en CPU desde la imagen original
   * (characterAlphaMask en card-texture.ts) y viaja como su PROPIA textura, el
   * mismo recurso que ya usan uLogoMask y uEdgeMap. Ese cálculo aprovecha para
   * acotar la ventana: fuera de la banda de arte y dentro de las zonas de TEXTO la
   * máscara vale 0, así el fondo no puede borrar la cabecera, los chips, la frase ni
   * el logotipo.
   */
  uniform sampler2D uBackgroundMap;
  /** Cobertura donde el fondo debe verse (1 sí, 0 no), calculada en CPU. */
  uniform sampler2D uBackgroundMask;
  /** 0 = la ficha no tiene fondo subido. Sin él la capa no toca un solo píxel. */
  uniform float uHasBackground;
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
  /**
   * Paralaje del fondo respecto del frente, en UV por unidad de inclinación. El signo
   * lo hace moverse al CONTRARIO que la carta, que es lo que se lee como lejanía.
   */
  uniform float uBgParallax;
  /**
   * TINTA Y PIEL del fondo: su máscara y su fuerza.
   *
   * Misma máscara de realce de contornos que el frente, pero calculada sobre la IMAGEN
   * DEL FONDO (ver holo-card.tsx) y con peso propio, para que el lineart del fondo se
   * encienda igual que el del personaje y las dos capas no parezcan de técnica distinta.
   */
  uniform sampler2D uBgEdgeMap;
  uniform float uBgEdgeStrength;
  /** Suelo de luminancia del arte del fondo: se ajusta en vivo. */
  uniform float uBgArtFloor;

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
    vec4 tex = texture2D(uMap, vUv);
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
    float luminance = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
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
    vec3 base = tex.rgb;
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

    vec3 lit = base
      + base * (glossLayer + holoLayer)
      + glossLayer * uGlossSelf
      + holoLayer * uHoloSelf;
    lit += edgeLayer;

    /**
     * CAPA 0: el FONDO del VTuber, por DEBAJO del personaje.
     *
     * POR QUÉ SE COMPONE AQUÍ Y NO AL PRINCIPIO
     * -----------------------------------------
     * El sitio natural parecería el arranque del shader (vec3 base = tex.rgb), pero
     * ahí el fondo todavía recibiría encima el barniz, la interferencia, los emblemas
     * y la tinta del frente: TODAS las capas del personaje se aplican sobre base, de
     * modo que el fondo saldría teñido con el efecto del frente y sus perillas
     * propias —lo que se pide— quedarían diluidas en las del personaje. Compuesto
     * después, cada capa conserva su carácter: el frente con su holograma suave y el
     * fondo con el suyo, más marcado.
     *
     * Esto es correcto además por definición: la máscara vale 1 SOLO donde el
     * personaje es transparente, así que no hay píxel del personaje al que se le
     * quite nada. Y sin fondo subido (uHasBackground = 0) el bloque entero se
     * salta: la ficha queda exactamente como estaba.
     */
    if (uHasBackground > 0.5) {
      /**
       * El CONTENIDO se muestrea DESPLAZADO por el puntero (paralaje) mientras la
       * máscara se lee en la posición FIJA.
       *
       * Ese reparto es lo que produce la sensación de profundidad: el agujero de la
       * silueta se queda donde está —es parte del personaje, del plano de delante— y
       * lo que se desliza por detrás es la escena. Si la máscara se desplazara
       * también, el hueco viajaría con el fondo y las dos capas se leerían como un
       * solo plano móvil. El signo va a CONTRARIO del frente, que es como se lee
       * "está más lejos".
       *
       * Se desplaza con el uniform del puntero (-1 a 1) y no con el de inclinación:
       * ese es una rotación en radianes que llega a 0.38, así que el recorrido se
       * quedaba en el 2,3% del ancho. Con el puntero el valor de la config es
       * directamente una fracción del ancho de carta, que es lo que se quiere ajustar.
       */
      vec2 bgUv = vUv - vec2(uPointer.x, uPointer.y) * uBgParallax;
      vec3 bgArt = texture2D(uBackgroundMap, bgUv).rgb;
      float bgCover = texture2D(uBackgroundMask, vUv).r;

      /**
       * Interferencia del fondo: MISMO modelo de película delgada que el frente, mismos
       * pesos de HOLOGRAM y —esto es lo que se corrigió— MISMAS frecuencias espaciales
       * (HOLOGRAM.surfaceX/surfaceY), no las suyas propias.
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
       * propio ritmo (BACKGROUND.timeShift), que es un desfase deliberado: el fondo no
       * cambia de color al unísono con el personaje, igual que en una lámina real la
       * capa de detrás no late con la de delante.
       */
      float bgPhase = fract(
        bgUv.x * ${f(CFG.HOLOGRAM.surfaceX)} + bgUv.y * ${f(CFG.HOLOGRAM.surfaceY)}
          + uTilt.y * ${f(CFG.BACKGROUND.tiltShift)} + uTime * ${f(CFG.BACKGROUND.timeShift)}
      );
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
       * TINTA Y PIEL del fondo: su propia capa de realce de contornos.
       *
       * POR QUÉ SE AÑADIÓ (lo pidió el usuario): el frente tenía esta perilla
       * (EDGE.strength) y el fondo no, así que el lineart del fondo no se encendía
       * como el del personaje y las dos capas se veían de técnica distinta. Es el mismo
       * efecto que la CAPA 4 del frente, con dos diferencias deliberadas:
       *
       *   · La máscara se calcula sobre la IMAGEN DEL FONDO (uBgEdgeMap), en el mismo
       *     encuadre que su arte, no sobre el personaje: resalta el dibujo que hay
       *     debajo del fondo, que es lo que se está mirando.
       *   · El peso es propio (uBgEdgeStrength) para poder ajustarlo por capa.
       *
       * Se muestrea DESPLAZADO por el paralaje, igual que el arte del fondo: si se
       * leyera fijo, el lineart se quedaría clavado en su sitio mientras la imagen se
       * mueve, y se vería un contorno fantasma despegado de la figura.
       */
      vec3 bgEdgeLayer = vec3(0.0);
      if (uBgEdgeStrength > 0.001) {
        vec4 bgEdgeTex = texture2D(uBgEdgeMap, bgUv);
        float bgEdgeLum = dot(bgEdgeTex.rgb, vec3(0.2126, 0.7152, 0.0722));
        /** El mismo ángulo rasante del frente: ahí el corrimiento espectral es mayor. */
        float bgCosEdge = clamp(cosView - ${f(CFG.EDGE.angleOffset)}, 0.0, 1.0);
        float bgEdgeFilm = thinFilmWavelength(
          bgCosEdge,
          ${f(CFG.EDGE.filmThickness)},
          uTime * ${f(CFG.EDGE.timeShift)} + bgUv.x * ${f(CFG.EDGE.surfaceShift)}
        );
        vec3 bgEdgeTint = wavelengthToRgb(bgEdgeFilm);
        float bgEdgeMask = bgEdgeTex.a * clamp(
          ${f(CFG.EDGE.maskBase)} + tiltAmount * ${f(CFG.EDGE.maskTilt)} + bgGlare * ${f(CFG.EDGE.maskGlare)},
          0.0,
          ${f(CFG.EDGE.maskCeiling)}
        );
        bgEdgeLayer = bgEdgeTint * bgEdgeLum * bgEdgeMask * uBgEdgeStrength;
      }

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
       * El realce de tinta y piel se SUMA aparte, en modo luz, igual que en el frente:
       * multiplicarlo por el arte lo apagaría justo en las zonas oscuras, que son las
       * que tiene que encender (el lineart).
       */
      lit = mix(
        lit,
        bgArtLevel + bgArtLevel * bgLayer + bgLayer * uBgLayerWeight + bgEdgeLayer,
        bgCover
      );
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
    lit += bordeFinal * filoMetal * ${f(CFG.METAL_BORDER.edgeWeight)};
    // Barrido extra, más brillante, para el destello del metal.
    lit += plateado * bandaBorde * filoMetal * ${f(CFG.METAL_BORDER.sparkleWeight)} * sinLogo;

    // Viñeta suave: solo un poco de caída en las esquinas. Antes bajaba muy por
    // debajo de 1 y oscurecía los bordes del arte; el suelo de VIGNETTE mantiene el
    // foco sin apagar la imagen.
    float vignette = smoothstep(
      ${f(CFG.VIGNETTE.outer)},
      ${f(CFG.VIGNETTE.inner)},
      distance(vUv, vec2(0.5))
    );
    vec3 color = lit * mix(${f(CFG.VIGNETTE.floor)}, ${f(CFG.VIGNETTE.ceiling)}, vignette);

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
    float alpha = tex.a * cardCornerMask(vUv);
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