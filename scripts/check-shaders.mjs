#!/usr/bin/env node
/**
 * Guard de los shaders GLSL: lo que NINGÚN otro gate del stack ve.
 *
 * QUÉ COMPRUEBA (y qué no)
 * -----------------------
 * SÍ: **uniformes usados sin declarar en su bloque**. Es el fallo invisible del stack:
 * el GLSL es un string, así que `tsc`, los tests y `next build` pasan, y el shader solo
 * falla en el navegador con `'x' : undeclared identifier` — la malla se dibuja NEGRA.
 * Pasa cuando el vertex y el fragment shader son strings separados y el fragment usa un
 * uniforme que se declaró en el vertex.
 *
 * SÍ: **uniformes declarados y nunca usados**, y **uniformes del bloque que no se leen
 * en ningún shader del archivo**. Los dos son código muerto con el mismo síntoma: nadie
 * ve que sobran, `tsc` no se queja (los uniforms de three son un objeto plano) y siguen
 * ahí hasta que alguien los audita. Eliminarlos importa porque cada uniforme que se
 * calcula en CPU y se sube a la GPU en cada carta es trabajo pagado a cambio de nada.
 *
 * NO: **el backtick suelto en un comentario**. Se comprobó que este script no puede
 * detectarlo: el backtick CIERRA el template literal antes de tiempo, así que no queda
 * un shader que analizar, sino un archivo de TypeScript sintácticamente roto. Quien lo
 * detecta es `tsc` (con un error que apunta a la línea SIGUIENTE, no al comentario — de
 * ahí que cueste verlo). No se finge esa comprobación aquí: un guard que dice "OK"
 * sobre algo que no ha mirado da falsa confianza.
 *
 * SÍ: **números de la config interpolados sin convertirlos a literal flotante**.
 * Este es el fallo que costó una tarde: al mover los valores a `card3d-config.ts`, el
 * `12.0` de un `exp(-dist * 12.0)` se interpola como `12` — un template literal escribe
 * el NÚMERO, y el `.0` no existe en el valor. GLSL ES 3.0 no promociona int a float en
 * una operación, así que `exp(-dist * 12)` no compila y la carta sale NEGRA. Es
 * invisible para todo el stack estático (tsc ve una cadena, los tests pasan, el build
 * pasa) y solo aparece en el navegador. La regla es mecánica: si una interpolación
 * dentro de un bloque GLSL menciona la config, tiene que ir por `f(...)` o `vec3(...)`.
 *
 * SÍ: **perillas del efecto que quedaron escritas como literal dentro del GLSL**.
 * Es el hueco inverso al anterior y el más difícil de ver: el refactor puede mover
 * valores a la config y aun así dejar números sueltos en el GLSL. Se descubrió auditando
 * el holograma: la paleta del espectro y el patrón del foil seguían dentro del shader, de
 * modo que la config NO mandaba sobre el color del holograma. Los literales legítimos
 * (índices de bucle, `1.0`/`0.0` de normalización, clamps) están en la lista blanca; si
 * añades uno con criterio propio, justifícalo ahí y no lo dejes suelto.
 *
 * Uso:
 *   node scripts/check-shaders.mjs [ruta]        # por defecto components/shaders.ts
 *   node scripts/check-shaders.mjs <shaders> <quien-declara-los-uniforms>
 * Sale != 0 si hay problema.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CANDIDATAS = [
  'components/shaders.ts',
  'components/shaders.js',
  'src/shaders.ts',
  'lib/shaders.ts',
];
/** El archivo que crea los objetos de uniforms (los lee el shader, los escribe la CPU). */
const DECLARANTE = 'components/holo-card.tsx';

const arg = process.argv[2];
const ruta = resolve(raiz, arg ?? CANDIDATAS.find((c) => existsSync(resolve(raiz, c))) ?? CANDIDATAS[0]);
const rutaDeclarante = resolve(raiz, process.argv[3] ?? DECLARANTE);

if (!existsSync(ruta)) {
  console.error(`check-shaders: no encuentro el archivo de shaders (${ruta})`);
  process.exit(1);
}

const fuente = readFileSync(ruta, 'utf8');

/** Identificadores que aporta GLSL o three.js y no hace falta declarar. */
const APORTADOS = new Set([
  'uv', 'uv1', 'uv2',
  'position', 'normal', 'color', 'instanceMatrix',
  'modelMatrix', 'modelViewMatrix', 'projectionMatrix', 'viewMatrix', 'normalMatrix',
  'cameraPosition', 'gl_Position', 'gl_FragColor', 'gl_FragCoord', 'gl_PointSize',
  'gl_PointCoord', 'gl_FrontFacing', 'gl_DepthRange',
  // varyings propios de esta base: los declara el vertex y los lee el fragment.
  'vUv', 'vNormal', 'vViewPosition', 'vWorldPosition',
]);

/** Bloque de GLSL con su línea de inicio, usando la marca /* glsl *​/ de esta base. */
const bloques = [...fuente.matchAll(/\/\*\s*glsl\s*\*\/\s*`([\s\S]*?)`/g)].map((m) => ({
  cuerpo: m[1],
  linea: fuente.slice(0, m.index).split('\n').length,
}));

if (bloques.length === 0) {
  console.error(
    'check-shaders: no encontré ningún shader con la marca /* glsl *​/. ' +
      'Si el archivo los declara de otro modo, este guard no está comprobando nada.',
  );
  process.exit(1);
}

/**
 * Literales que SÍ pueden vivir dentro del GLSL, y EN QUÉ CONSTRUCCIÓN.
 *
 * La lista va por VALOR + CONTEXTO a propósito: una lista solo por valor tapa
 * duplicados. Ya pasó al escribir esto: `1.6` se declaró legítimo por la cota del
 * `clamp` del logo, y el MISMO 1.6 era a la vez la perilla de las franjas del foil,
 * así que la mutación que devolvía el foil al shader pasaba el guard sin ser vista.
 * Con el contexto, `fract(x * 1.6)` no encaja en ninguna regla y salta.
 *
 * Criterio: aquí solo entra lo que expresa ESTRUCTURA (índices, normalización,
 * centrado, constantes de la física del color). Cualquier valor que quieras ajustar
 * va a `card3d-config.ts`.
 */
const LITERALES_LEGITIMOS = [
  // Identidad y normalización a 0..1: estructura pura, válidos en cualquier sitio.
  { valor: '0.0', en: /./ },
  { valor: '1.0', en: /./ },
  { valor: '1.000' , en: /./ },
  // Centrado respecto a la mitad (UV 0..1 y puntero -1..1) y umbral de ACTIVO/INACTIVO
  // de los emblemas de facción (una cuenta de facciones llega como 0 o 1, así que el
  // corte es 0.5 por construcción, no una perilla).
  { valor: '0.5', en: /-\s*0\.5\b|vec2\(0\.5\)|\*\s*0\.5\s*\+\s*0\.5|fract\([^)]*\)\s*-\s*0\.5|uFactionCounts\.\w\s*>\s*0\.5|uHasBackground\s*>\s*0\.5|activo\s*<\s*0\.5|float\(i\)\s*\*\s*0\.5|uCardSize\s*\*\s*0\.5|\/\s*size\s*\+\s*0\.5|uUseLayers\s*>\s*0\.5/ },
  // Color de fondo por defecto cuando no hay background (capas): gris muy oscuro.
  { valor: '0.031', en: /vec3\(\s*0\.031,\s*0\.035,\s*0\.063\s*\)/ },
  { valor: '0.035', en: /vec3\(\s*0\.031,\s*0\.035,\s*0\.063\s*\)/ },
  { valor: '0.063', en: /vec3\(\s*0\.031,\s*0\.035,\s*0\.063\s*\)/ },
  // Mezcla del degradado por defecto (estructura, no perilla).
  { valor: '0.55', en: /mix\(\s*uSecondary,\s*mix\(\s*uAccent,\s*vec3\([^)]*\),\s*vUv\.y\s*\),\s*0\.55\s*\)/ },
  { valor: '2.0', en: /\*\s*2\.0\b|\/\s*2\.0\b/ },
  // Luminancia Rec.709: constante de la física del color, no un ajuste.
  { valor: '0.2126', en: /\.2126|dot\(/ },
  { valor: '0.7152', en: /\.7152|dot\(/ },
  { valor: '0.0722', en: /\.0722|dot\(/ },
  // Cota superior del color del metal del logo (clamp), no una perilla.
  { valor: '1.6', en: /clamp\([^;]*,\s*1\.6\s*\)/ },
  // Matiz del barniz: vec3(1.0, 0.99, 0.97), la desviación del blanco.
  { valor: '0.99', en: /vec3\(1\.0,\s*0\.99,\s*0\.97\)/ },
  { valor: '0.97', en: /vec3\(1\.0,\s*0\.99,\s*0\.97\)/ },
  // Umbral de "hay capa que evaluar": evita calcular una máscara vacía.
  { valor: '0.001', en: />\s*0\.001/ },
];

const problemas = [];
for (const { cuerpo, linea } of bloques) {
  /**
   * GLSL SIN COMENTARIOS para el análisis.
   *
   * POR QUÉ (fallo medido): la coincidencia de declaraciones corre sobre el cuerpo
   * entero, no línea a línea, así que la palabra "uniform" escrita en un COMENTARIO
   * se tragaba todo el texto siguiente hasta el primer `;` como si fuera una
   * declaración. El resultado era un guard que inventaba uniforms fantasma
   * ("uniform puntero (-1 a 1) y no con el de inclinación: ... declarado y nunca
   * usado") en cuanto un comentario mencionaba la palabra. Y como este repo usa
   * comentarios largos que explican el porqué, mencionar un uniform es lo normal.
   *
   * Se reemplazan por ESPACIOS del mismo largo conservando los saltos de línea, para
   * que los números de línea que reportan los problemas sigan siendo los del archivo.
   */
  const limpio = cuerpo
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));

  const declarados = new Set();
  for (const decl of limpio.matchAll(/\buniform\s+\w+\s+([^;]+);/g)) {
    for (const nombre of decl[1].split(',')) {
      const sucio = nombre.trim().replace(/\[.*\]$/, '');
      // Un nombre de uniform es un identificador; si trae espacios o símbolos es
      // texto que se coló, no una declaración.
      if (/^[A-Za-z_]\w*$/.test(sucio)) declarados.add(sucio);
    }
  }

  const usados = new Set();
  for (const uso of limpio.matchAll(/\bu[A-Z]\w*/g)) usados.add(uso[0]);

  for (const nombre of usados) {
    if (!declarados.has(nombre) && !APORTADOS.has(nombre)) {
      problemas.push(
        `uniform ${nombre} usado sin declarar en el shader que empieza en la línea ${linea} ` +
          '(da "undeclared identifier" y la malla sale negra)',
      );
    }
  }

  /**
   * Números de la config interpolados a pelo. El `.0` de un `12.0` no sobrevive al
   * template literal, y GLSL ES 3.0 no promociona int a float: `exp(-dist * 12)` no
   * compila y la carta sale negra (solo se ve en el navegador). Todo valor de la config
   * que entra al GLSL tiene que pasar por `f()` o por `vec3()`, que garantizan el `.0`.
   */
  for (const interp of cuerpo.matchAll(/\$\{\s*(?!f\(|vec3\()([^}]*)\}/g)) {
    if (/\bCFG\.|slots?\[/.test(interp[1])) {
      problemas.push(
        `interpolación sin f()/vec3() en el shader que empieza en la línea ${linea}: ` +
          `\${${interp[1]}} — un entero sale sin el .0 y GLSL ES 3.0 no lo promociona ` +
          '(la carta sale negra en el navegador)',
      );
    }
  }

  /**
   * PERILLA SUELTA: un literal con decimales dentro del GLSL que no está en la lista
   * de legítimos. Es el hueco inverso al de `f()`: el valor no llegó a la config, así
   * que `card3d-config.ts` NO manda sobre esa parte del efecto. Se detectó auditando
   * el holograma, donde la paleta del espectro y el patrón del foil seguían dentro del
   * shader. Solo se miran literales con punto (un entero suelto es casi siempre un
   * índice) y se ignoran los comentarios, porque ahí el número es documentación.
   */
  for (const [i, l] of cuerpo.split('\n').entries()) {
    // Se QUITAN las interpolaciones (que ya vienen de la config) en vez de saltar la
    // línea entera: saltarla escondía el caso más común, una línea con un `f()` legítimo
    // Y una perilla suelta a la vez (p. ej. `uTilt.y * 1.4 + uTime * ${f(...)}`).
    const sinConfig = l.replace(/\$\{[^}]*\}/g, ' ');
    if (/^\s*(\*|\/\/|\/\*)/.test(sinConfig)) continue; // comentario
    for (const lit of sinConfig.matchAll(/(?<![\w$.])(\d+\.\d+)(?![\w.])/g)) {
      const legitimo = LITERALES_LEGITIMOS.some((r) => r.valor === lit[1] && r.en.test(sinConfig));
      if (legitimo) continue;
      problemas.push(
        `literal ${lit[1]} suelto en el shader que empieza en la línea ${linea} ` +
          `(línea ${linea + i}): si es una perilla del efecto, va en card3d-config.ts; ` +
          'si es estructura, añádelo a LITERALES_LEGITIMOS con SU construcción justificada',
      );
    }
  }

  /** Uniforme DECLARADO y nunca usado. Sobra en el shader, pero sobre todo suele
   * significar que también sobra en la CPU: quien lo crea sigue rellenándolo en cada
   * carta. Se ignora el nombre con prefijo `u` que sea un número (p. ej. `u0`), porque
   * no existe en este archivo.
   */
  for (const nombre of declarados) {
    if (!usados.has(nombre)) {
      problemas.push(
        `uniform ${nombre} declarado y nunca usado (código muerto: el shader que ` +
          `empieza en la línea ${linea} no lo lee)`,
      );
    }
  }
}

/**
 * Uniformes que la CPU escribe pero NINGÚN shader del archivo lee.
 *
 * Es la otra mitad del mismo problema: borrar la declaración del GLSL deja el objeto
 * de uniforms huérfano, y ahí sí es invisible del todo — `tsc` acepta un objeto plano
 * con claves de más y la GPU lo ignora en silencio. Se cuentan los shaders del archivo
 * completo, no bloque a bloque: un uniforme puede declararse en un bloque y leerse en
 * otro (los dos shaders de un material comparten el objeto).
 */
if (existsSync(rutaDeclarante)) {
  const declarante = readFileSync(rutaDeclarante, 'utf8');
  const enShaders = new Set();
  for (const { cuerpo } of bloques) {
    for (const decl of cuerpo.matchAll(/\buniform\s+\w+\s+([^;]+);/g)) {
      for (const nombre of decl[1].split(',')) {
        const limpio = nombre.trim().replace(/\[.*\]$/, '');
        if (limpio) enShaders.add(limpio);
      }
    }
  }
  for (const asignacion of declarante.matchAll(/^\s+(u[A-Z]\w*)\s*:/gm)) {
    const nombre = asignacion[1];
    if (!enShaders.has(nombre)) {
      problemas.push(
        `${rutaDeclarante.split('/').pop()}: ${nombre} se crea como uniforme pero ningún ` +
          'shader lo declara (se sube a la GPU cada frame y se ignora)',
      );
    }
  }
} else {
  problemas.push(
    `no encuentro ${rutaDeclarante.split('/').pop()}: sin él no se puede comprobar que los ` +
      'uniformes creados en CPU los lea algún shader',
  );
}

if (problemas.length > 0) {
  console.error(`check-shaders: ${problemas.length} problema(s) en ${ruta}`);
  for (const p of problemas) console.error(`  · ${p}`);
  process.exit(1);
}

console.log(
  `check-shaders: OK — ${bloques.length} shader(s) sin uniforms sin declarar, sin uniforms ` +
    'muertos, sin uniforms huérfanos en CPU, sin perillas sueltas (todo valor ajustable ' +
    'vive en card3d-config.ts) y con los números de la config como literal flotante ' +
    '(el backtick suelto en comentarios lo cubre tsc)',
);
