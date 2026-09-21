/**
 * Shaders de la carta holográfica.
 *
 * El efecto "carta Pokémon holográfica" del original no existe: allí las cartas
 * son imágenes planas con hover. Aquí el brillo iridiscente, el barrido
 * diagonal y la chispa de borde se calculan en GPU, con el color del VTuber
 * como acento, de modo que cada carta se ve distinta sin assets extra.
 */

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
    float bend = 1.0 - smoothstep(0.0, 1.1, abs(transformed.x));
    transformed.z += bend * 0.035 * (1.0 - bend) * 4.0;

    // Micro-desplazamiento guiado por el puntero (parallax del frente).
    transformed.xy += uPointer * 0.012 * vUv.y;

    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    vViewPosition = -mvPosition.xyz;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

export const cardFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uMap;
  uniform sampler2D uHoloMap;
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
   * FACTION_SLOTS): no se apilan en el centro, se reparten por la lámina.
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
  uniform float uOverlay;
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
   * quedar limpios y legibles.
   */
  uniform vec2 uArtZone;
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
  uniform float uCardRadius;

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
     * Estaba en 0.0015 del alto (≈1-2 px en pantalla), que es tan fino que el
     * contorno se veía FILOSO y dentado al inclinar la carta. 0.0045 da una
     * transición de ~3 px, que es el rango donde el borde se percibe limpio sin
     * volverse difuso. El antialias del canvas no basta: MSAA suaviza las aristas
     * de la GEOMETRÍA, pero este recorte se hace en el fragment shader con
     * discard, y eso MSAA no lo toca.
     */
    float aa = uCardSize.y * 0.0045;
    return 1.0 - smoothstep(-aa, aa, d);
  }

  /**
   * Espectro visible -> RGB. El color de una lámina holográfica NO se elige: sale
   * del ORDEN DEL ESPECTRO. Por eso se convierte una longitud de onda normalizada
   * (0 = violeta ~380nm, 1 = rojo ~700nm) a su color real, en vez de mezclar
   * colores arbitrarios. La documentación del efecto es explícita: una lámina
   * creíble recorre sus tonos EN SECUENCIA y nunca salta de verde a magenta.
   *
   * Aproximación de la respuesta del ojo a cada banda, con las mezclas suaves en
   * las fronteras (violeta->azul->cian->verde->amarillo->rojo).
   */
  vec3 wavelengthToRgb(float w) {
    w = clamp(w, 0.0, 1.0);
    vec3 violeta = vec3(0.62, 0.22, 1.00);
    vec3 azul     = vec3(0.16, 0.34, 1.00);
    vec3 cian     = vec3(0.10, 0.92, 1.00);
    vec3 verde    = vec3(0.18, 1.00, 0.36);
    vec3 amarillo = vec3(1.00, 0.94, 0.22);
    vec3 rojo     = vec3(1.00, 0.20, 0.16);
    if (w < 0.20) return mix(violeta, azul, w / 0.20);
    if (w < 0.40) return mix(azul, cian, (w - 0.20) / 0.20);
    if (w < 0.60) return mix(cian, verde, (w - 0.40) / 0.20);
    if (w < 0.80) return mix(verde, amarillo, (w - 0.60) / 0.20);
    return mix(amarillo, rojo, (w - 0.80) / 0.20);
  }

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
    float x = uv.x * 1.0 + uv.y * 0.7 + t * 0.05;
    // El patrón espacial hace de variación de espesor de la lámina: por eso el
    // arcoíris se reparte en franjas por la superficie y no es un color plano.
    float w = fract(x * 1.6);
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
    vec2 lightDir = vec2(0.35 + uTilt.y * 0.9, 0.75 + uTilt.x * 0.9) - uv;
    float d = length(lightDir);
    float core = pow(clamp(1.0 - d * 1.15, 0.0, 1.0), 2.4);

    // Franja vertical estrecha: el reflejo alargado típico de una lámina.
    float band = smoothstep(0.16, 0.0, abs(lightDir.x * 1.9 + lightDir.y * 0.35));

    // Parallax con el puntero: el brillo "sigue" al cursor, muy sutil.
    float pointerBoost = pow(clamp(1.0 - distance(uv, pointer * 0.5 + 0.5) * 1.5, 0.0, 1.0), 3.0);

    // Borde (Fresnel): en los cantos la lámina siempre brilla más.
    float fresnel = pow(1.0 - clamp(dot(normalize(nrm), normalize(vViewPosition)), 0.0, 1.0), 3.0);

    float amount = clamp(core * 0.75 + band * 0.42 + pointerBoost * 0.3 + fresnel * 0.35, 0.0, 1.0);
    return vec2(amount, fresnel);
  }

  /**
   * Máscara de la ZONA DE IMAGEN: 1 dentro de la banda del personaje y 0 fuera,
   * con un tramo de transición para que el efecto no termine en un corte recto.
   */
  float artZoneMask(vec2 uv) {
    float fade = 0.05;
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
    // Cobertura del logotipo, leída de su silueta real. sinLogo (1 fuera del
    // logo, 0 dentro) se calcula aquí para que TODAS las capas holográficas —la
    // interferencia, los emblemas de facción y el barrido— puedan suprimirse sobre
    // la marca sin repetir la resta en cada una.
    float logoCover = texture2D(uLogoMask, vUv).r;
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
    float fresnel = pow(1.0 - cosView, 2.2);

    // Barrido diagonal que sigue al puntero (el "glare" del holográfico).
    vec2 pointerUv = uPointer * 0.5 + 0.5;
    float distToPointer = distance(vUv, pointerUv);
    float glare = smoothstep(0.62, 0.0, distToPointer) * 0.55;

    // Bandas holográficas inclinadas por el tilt de la carta.
    float tiltAmount = abs(uTilt.x) + abs(uTilt.y);
    float holoMask = clamp(uHasHolo * (0.25 + tiltAmount * 2.4 + glare), 0.0, 1.0);

    /**
     * LONGITUD DE ONDA REFORZADA, según la física de película delgada.
     *
     * cosView es el ángulo; al inclinar la carta (uTilt) el coseno baja y la
     * banda reforzada recorre el espectro. El uTime avanza la fase muy despacio
     * para que una carta quieta no quede muerta, pero el movimiento principal lo
     * produce el ÁNGULO, que es lo que hace una lámina de verdad.
     *
     * El espesor (5.5) fija cuántos ciclos de color caben entre verse de frente y
     * verse de canto; con 2 ciclos el salto de tono al inclinar es evidente sin
     * volverse un patrón de cebra.
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
     * El recorrido espacial es SUAVE (2.6 + 1.9 a lo ancho y alto): se probó a
     * multiplicar los ciclos y el arcoíris se volvía visible por toda la carta, que
     * es el exceso de saturación que había que corregir. Con este reparto el tono
     * cambia de una zona a otra sin dibujar franjas.
     */
    float faseEspesor = vUv.x * 1.1 + vUv.y * 0.8 + uTilt.y * 1.4 + uTime * 0.05;
    float filmColorW = fract(cosView * 1.5 + faseEspesor);
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
     *   2. El suelo metálico pesa más que el color (mezcla al 0.45 en vez de 0.72),
     *      así el metal domina y el arcoíris solo lo tiñe.
     */
    float lumFilm = dot(filmColor, vec3(0.2126, 0.7152, 0.0722));
    filmColor = mix(filmColor, vec3(lumFilm), 0.42);
    vec3 metalGround = mix(vec3(0.87, 0.89, 0.93), filmColor, 0.45);
    vec3 foil = metalGround * holoMask * uHolo;

    // --- CAPA 1: barniz realista (reflejo especular) ---------------------------
    // Se aplica como luz SUPERPUESTA (aditiva y ponderada por la luminancia del
    // arte), no como sustituto del color: ilumina sin manchar ni lavar la carta.
    vec2 gloss = specularGloss(vUv, uPointer, vNormal);
    float glossAmount = gloss.x * uGloss;
    // El brillo respeta el arte: sobre zonas ya claras aporta menos (evita el
    // efecto "lechoso" que arruina los colores planos).
    float luminance = dot(tex.rgb, vec3(0.2126, 0.7152, 0.0722));
    float glossWeight = mix(1.0, 0.35, smoothstep(0.55, 0.95, luminance));
    vec3 glossLayer = vec3(1.0, 0.99, 0.97) * glossAmount * glossWeight;

    // --- CAPA 2: holografía (interferencia) -----------------------------------
    // Se mezcla DESPUÉS del barniz y con peso propio, en modo luz, para que
    // ambas capas convivan sin taparse una a la otra.
    /**
     * PESO de la capa holográfica sobre el arte: 0.06 (venía de 0.42, 0.22, 0.12).
     *
     * Esta es la perilla correcta para la SATURACIÓN, no el uHolo. uHolo es una
     * intensidad global (apagaba todas las contribuciones del holograma por igual,
     * incluidas las que dan el tono metálico); este factor decide cuánto del color
     * espectral se SUMA al arte, que es lo que se veía cargado. Se bajó a la mitad
     * del valor anterior.
     */
    vec3 holoLayer = foil * 0.06;

    // --- CAPA 3: emblemas de FACCIÓN como holograma ---------------------------
    // Cada VTuber tiene entre 2 y 4 facciones. Se reparten por la lámina en
    // cuatro posiciones (no se apilan en el centro) y se mezclan en modo LUZ para
    // que se lean como holograma superpuesto sin manchar la carta. Cada emblema
    // recibe su propio tinte iridiscente y su fase de latido, así no parecen un
    // mismo sello repetido.
    vec3 base = tex.rgb;
    if (uFactionCounts.x > 0.5) {
      // Posición de cada slot en la carta (x,y) y su tamaño relativo.
      // 1ª arriba-derecha, 2ª abajo-izquierda, 3ª arriba-izquierda, 4ª abajo-derecha.
      vec2 slots[4];
      slots[0] = vec2(0.70, 0.76);
      slots[1] = vec2(0.30, 0.30);
      slots[2] = vec2(0.28, 0.78);
      slots[3] = vec2(0.72, 0.28);
      float sizes[4];
      sizes[0] = 0.30; sizes[1] = 0.28; sizes[2] = 0.24; sizes[3] = 0.24;

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
        vec2 fUv = (vUv - slot - uPointer * 0.02 * depth) / size + 0.5;
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
        float facStroke = smoothstep(0.10, 0.55, facLum);
        float facAlpha = fac.a * facStroke * uFactionStrength;
        // Latido desfasado por slot: los emblemas no pulsan al unísono.
        float pulse = 0.72 + 0.28 * sin(uTime * 1.5 + float(i) * 1.9 + vUv.y * 5.0);
        float facMask = facAlpha * (0.5 + tiltAmount * 1.0 + glare * 0.45) * pulse;
        // Tinte iridiscente propio de cada slot.
        vec3 facTint = mix(vec3(1.0), spectralFoil(fUv * 0.9 + uPointer * 0.1 + float(i) * 0.2, uTime), 0.7);
        vec3 facLayer = fac.rgb * facTint * facMask;
        // Los emblemas son holograma: se suprimen sobre el logo, igual que la
        // capa de interferencia, para no teñir la marca.
        base += (base * facLayer * 0.45 + facLayer * 0.8) * sinLogo;
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
       * variación suave original (0.6 de recorrido), que es la que se había aprobado.
       */
      float cosEdge = clamp(cosView - 0.35, 0.0, 1.0);
      float edgeFilm = thinFilmWavelength(cosEdge, 9.0, uTime * 0.05 + vUv.x * 0.6);
      vec3 edgeTint = wavelengthToRgb(edgeFilm);
      // El realce sube con la inclinación y el puntero, y nunca baja del 55%: el
      // efecto tiene que verse también con la carta quieta.
      float edgeMask = edgeTex.a * clamp(0.55 + tiltAmount * 2.2 + glare * 1.2, 0.0, 1.6);
      edgeLayer = edgeTint * edgeLum * edgeMask * uEdgeStrength;
    }

    // Las tres capas se escalan por zone: fuera de la imagen no aportan nada, así
    // que la cabecera, los chips, la frase y el pie quedan con su color plano.
    /**
     * Alcance de cada capa:
     *   - zone limita todo a la IMAGEN (los items de la carta quedan limpios).
     *   - logoCover SUPRIME EL HOLOGRAMA sobre la silueta del logotipo: es una
     *     marca plana y el arcoíris la vuelve ilegible.
     *   - El BARNIZ se mantiene sobre el logo: en una carta real el reflejo pasa
     *     por encima de la marca impresa.
     */
    glossLayer *= zone;
    holoLayer *= zone * sinLogo;
    edgeLayer *= zone;

    vec3 lit = base + base * (glossLayer + holoLayer) + glossLayer * 0.35 + holoLayer * 0.5;
    lit += edgeLayer;

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
    float filoMetal = pow(fresnel, 0.85);
    // El barrido recorre el contorno con el tilt y el puntero.
    float barridoBorde = fract(vUv.x * 1.3 + vUv.y * 1.7 + uTilt.y * 2.2 + uPointer.x * 0.6);
    float bandaBorde = smoothstep(0.34, 0.0, abs(barridoBorde - 0.5));
    // Tono del metal: espectro real, desplazado por el ángulo de visión.
    vec3 tonoMetal = wavelengthToRgb(fract(cosView * 2.0 + uTime * 0.04));
    // Suelo plateado: el metal no es color puro, es gris con el color encima.
    vec3 plateado = vec3(0.88, 0.91, 0.96);
    vec3 metalBorde = mix(plateado, tonoMetal, 0.55);
    // Brillo del barrido (claro) y sombra entre barridos (oscura): el contraste.
    vec3 luzBorde = metalBorde * (0.45 + bandaBorde * 1.15);
    // Se mezcla con el color de marca para que la carta conserve su identidad.
    vec3 bordeFinal = mix(mix(uAccent, uSecondary, vUv.y), luzBorde, 0.72);
    lit += bordeFinal * filoMetal * 0.85;
    // Barrido extra, más brillante, para el destello del metal.
    lit += plateado * bandaBorde * filoMetal * 0.5 * sinLogo;

    // Viñeta suave: solo un poco de caída en las esquinas. Antes bajaba a 0.82 y
    // oscurecía los bordes del arte; 0.92 mantiene el foco sin apagar la imagen.
    float vignette = smoothstep(1.15, 0.35, distance(vUv, vec2(0.5)));
    vec3 color = lit * mix(0.92, 1.04, vignette);

    // La capa de color superpuesta no debe alterar el alfa del arte (el brillo
    // es luz, no pigmento): así no "mancha" los bordes recortados. La máscara de
    // esquinas va sobre el alfa para que el recorte coincida con el canto.
    float alpha = tex.a * cardCornerMask(vUv);
    if (alpha < 0.02) discard;

    /**
     * STICKER del LOGO: se aplica con su mezcla alfa SOBRE el color ya calculado,
     * después de todos los efectos. El logotipo recupera sus píxeles originales
     * (sin arcoíris, sin tinte y sin barrido) y mantiene su propia transparencia.
     */
    vec4 logoPix = texture2D(uLogoSticker, vUv);
    float logoAlpha = logoPix.a * texture2D(uLogoMask, vUv).r;
    if (logoAlpha > 0.001) {
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
      vec2 logoGloss = specularGloss(vUv, uPointer, vNormal);
      // Coordenada del barrido: diagonal, movida por el tilt y el puntero.
      float barrido = vUv.x * 0.7 + vUv.y * 0.9 + uTilt.y * 1.6 + uPointer.x * 0.5;
      // Banda estrecha y con borde suave: el reflejo del metal, no un halo.
      float banda = smoothstep(0.30, 0.0, abs(fract(barrido) - 0.5));
      float intensidad = banda * 0.85 + logoGloss.x * 0.35;
      // Multiplica la luminancia de la marca (una marca oscura brilla menos que una
      // clara, como el metal real) y añade el especular por encima.
      vec3 metal = logoPix.rgb * (0.72 + intensidad * 0.75);
      metal += vec3(0.92, 0.96, 1.0) * banda * 0.5;   // luz fría del barrido
      metal -= vec3(0.10, 0.08, 0.04) * (1.0 - banda); // sombra cálida entre barridos
      // Filo luminoso en el contorno: separa la marca del fondo y la hace "tallada".
      float filo = pow(1.0 - abs(logoPix.a - 0.5) * 2.0, 1.6) * 0.22;
      metal += vec3(1.0) * filo;
      color = mix(color, clamp(metal, 0.0, 1.6), clamp(logoAlpha, 0.0, 1.0));
    }

    gl_FragColor = vec4(color, alpha);
  }
`;

/**
 * Shader del "foil" trasero: la cara posterior de la carta con patrón
 * de interferencia y el color del VTuber.
 */
export const backFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uAccent;
  uniform vec3 uSecondary;
  uniform vec2 uPointer;
  uniform float uTime;
  /**
   * La cara trasera es un PLANO de esquina viva. Sin la máscara de esquinas se
   * dibujaba como un RECTÁNGULO completo detrás de la carta, y su contorno
   * asomaba por los cantos redondeados: ese era el "borde filoso" que se veía.
   * Necesita los mismos uniformes de forma que la cara frontal para recortarse
   * con la misma curva.
   */
  uniform vec2 uCardSize;
  uniform float uCardRadius;
  uniform vec2 uArtZone;

  /** Misma máscara que la cara frontal: distancia con signo a la caja redondeada. */
  float cardCornerMaskBack(vec2 uv) {
    vec2 halfSize = uCardSize * 0.5;
    vec2 p = (uv - 0.5) * uCardSize;
    vec2 q = abs(p) - (halfSize - vec2(uCardRadius));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uCardRadius;
    float aa = uCardSize.y * 0.0045;
    return 1.0 - smoothstep(-aa, aa, d);
  }
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), viewDir), 0.0, 1.0), 1.6);

    float r = length(vUv - 0.5);
    float rings = sin(r * 44.0 - uTime * 1.4 + uPointer.x * 3.0) * 0.5 + 0.5;
    float spokes = sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 9.0 + uPointer.y * 2.0) * 0.5 + 0.5;

    vec3 base = mix(uAccent * 0.16, uSecondary * 0.22, rings);
    vec3 color = base + vec3(rings * spokes) * 0.12 + fresnel * uAccent * 0.35;
    // Alfa con la máscara de esquinas: la cara trasera se recorta con la misma
    // curva que el cuerpo y deja de asomar por los cantos.
    float alpha = cardCornerMaskBack(vUv);
    if (alpha < 0.02) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;
