/**
 * ESLint del repositorio (config plana / flat config).
 *
 * POR QUÉ EXISTE: hasta ahora `npm run lint` estaba roto — ESLint 9 exige un
 * archivo de configuración PLANO (`eslint.config.js`) o no arranca, y en el
 * repo no había ninguno. Ese hueco hacía que el CI no pudiera comprobar nada
 * que no fuera `tsc`: un `useEffect` sin dependencias, un `<img>` en vez de
 * `next/image` o un `import` que no resuelve no los ve ni el typecheck ni los
 * tests (los tests corren sin WebGL a propósito y el build no compila GLSL).
 *
 * Next 16 ELIMINÓ `next lint` (ver
 * `node_modules/next/dist/docs/01-app/03-api-reference/05-config/03-eslint.md`),
 * así que el linter se invoca SIEMPRE por el CLI de ESLint y la config es
 * nuestra: no hay `next.config.mjs > eslint` que valga.
 *
 * ALCANCE — el repo tiene cuatro zonas con runtimes distintos y una sola
 * config no las cubre bien:
 *
 *   · `app/`, `components/`, `lib/`  — React 19 + Next 16 (TS/TSX). Aquí sí
 *     aplican React, Hooks y las reglas de Next (incluidas las de Core Web
 *     Vitals, que es lo que interesa vigilar en un catálogo con 1.593 imágenes).
 *   · `scripts/` y `*.config.mjs`    — Node ESM puro (las herramientas del
 *     mantenedor y de build). Nada de React ni de `next/*`.
 *   · `server/` y `scraper/`         — paquetes npm INDEPENDIENTES, con su
 *     propio `node_modules` y su runner nativo (`node --test`). Se lintean
 *     desde la raíz a propósito: sus errores también tienen que salir en el CI,
 *     y `npm run lint` en la raíz es el único gate que ve el árbol completo.
 *
 * Se usa el preset `core-web-vitals` y no el base porque en este proyecto las
 * reglas de Next que suben a error son justo las que importan: `no-img-element`
 * evitaría saltarse la ruta `/images/*` que resuelve el manifiesto contra Turso,
 * y `no-sync-scripts`/`no-unwanted-polyfillio` protegen el LCP del catálogo.
 *
 * Uso: `npm run lint` (falla el proceso si hay cualquier error).
 */
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import globals from 'globals';

export default defineConfig([
  /**
   * Ignorados GLOBALES.
   *
   * `deploy/**` y `data/**` son artefactos binarios generados (la base SQLite y
   * el manifiesto de imágenes): sin excluirlos, ESLint intenta leerlos y avisa
   * en cada corrida. `.next/**` y `.verify-stage/**` son salidas de build.
   *
   * `node_modules` lo ignora ESLint por defecto; `scraper/out/` y
   * `scraper/cache/` son datos crudos del scrape (HTML y dataset), no código.
   */
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'deploy/**',
    'data/**',
    'public/**',
    '.verify-stage/**',
    'scraper/out/**',
    'scraper/cache/**',
    'tsconfig.tsbuildinfo',
  ]),

  // --- front (Next 16 + React 19) -------------------------------------------
  ...nextVitals,
  ...nextTs,

  /**
   * Reglas del plugin `react-hooks` (v7) que MIDEN MAL en este repo.
   *
   * La v7 trae las reglas del compilador de React 19. En un proyecto React
   * convencional son valiosas, pero aquí las tres que disparan describen
   * patrones que este código usa a propósito y por razones medidas. Se apagan
   * con el motivo escrito; si mañana se toca el componente, el comentario es lo
   * que evita "arreglar" un falso positivo y romper la carta.
   *
   *   · `react-hooks/immutability` — la carta 3D MUTA los uniforms de three.js
   *     fuera del render: dentro del `useMemo` que construye el material (las
   *     texturas llegan de forma asíncrona, así que no pueden ser argumentos
   *     iniciales) y dentro del `useFrame` de R3F, que es el bucle de animación.
   *     Es exactamente como funciona three.js: `uTime.value = t` no es estado de
   *     React. Marcarlo obligaría a reescribir la carta contra la API de la
   *     librería, y AGENTS.md ya documenta que la geometría del canto DEBE ser
   *     una instancia creada en `useMemo` (instanciarla desde JSX rompe el
   *     bundle de producción con `Class constructor cannot be invoked without
   *     'new'`).
   *   · `react-hooks/refs` — patrón "latest callback ref" en `SearchBar`:
   *     `onChangeRef.current = onChange` en el cuerpo para que el `setTimeout`
   *     del debounce (260 ms) lea el callback vigente sin reiniciar el
   *     temporizador en cada re-render. El test `aplica debounce y comunica un
   *     único cambio` (components.test.tsx) cubre el comportamiento.
   *   · `react-hooks/set-state-in-effect` — el repo resuelve TODA la carga de
   *     datos por `useEffect` + `AbortController` (buscador, ficha, mantenedor):
   *     `setLoading(true)` al empezar y `setData(...)` al resolver. El "cascading
   *     render" que la regla evita es justo lo que aquí es deseable (mostrar el
   *     estado de carga) y el proyecto no usa una librería de datos a propósito:
   *     la URL es el estado de la búsqueda (`lib/query.ts`). Verificado con los
   *     tests de página y con `npm run verify` (rutas reales por HTTP) que el
   *     comportamiento es el esperado.
   */
  {
    files: ['app/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}'],
    rules: {
      /**
       * La versión de TypeScript de `no-unused-vars` que trae el preset NO hereda
       * el patrón de `_`: sin declararlo aquí, `const [_version, setVersion]`
       * (contador que solo existe para forzar un repintado, ver
       * `card3d-tuner.tsx`) sale como aviso permanente. Se mantiene como AVISO a
       * propósito — el preset de Next ya lo deja así y no es motivo para no
       * desplegar —, pero con el mismo criterio que en el resto del repo.
       */
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      /**
       * `<img>` en vez de `next/image`: decisión del repo, no descuido. La
       * optimización de imágenes está DESACTIVADA en `next.config.mjs`
       * (`images: { unoptimized: true }`) porque los assets no vienen de un
       * dominio externo sino de la ruta propia `/images/*`, que resuelve el
       * manifiesto contra Turso o el disco y sirve con `content-length` y
       * `cache-control` propios. Con el optimizador apagado, `next/image` es un
       * envoltorio sobre `<img>`: no aporta LCP ni ancho de banda, y sí añade
       * un componente cliente donde no hace falta.
       */
      '@next/next/no-img-element': 'off',
    },
  },

  // --- JavaScript de Node (scripts, configs, server y scraper) --------------
  {
    files: [
      'scripts/**/*.mjs',
      '*.config.mjs',
      '*.config.mts',
      'server/**/*.mjs',
      'scraper/**/*.mjs',
      // `lib/**/*.mjs` es el huérfano que dejaba pasar el fallo más caro del mantenedor.
      //
      // Son la capa de datos que importan las rutas de Next (`ediciones.mjs`, `db.mjs`,
      // `admin-auth.mjs`, `carpetas.mjs`) y eran los ÚNICOS archivos del repo sin ningún gate:
      // `tsconfig.json` incluye solo `**/*.ts` y `**/*.tsx`, así que `tsc` no los mira, y esta
      // config solo cubría `server/`, `scraper/`, `scripts/` y los `.config.mjs`.
      //
      // Medido: un `EXTENSION_DE_CARPETA is not defined` por un import que faltaba pasó
      // `typecheck`, `test` y `build` en verde y solo apareció como un 500 en la ruta del
      // mantenedor de producción. Con `no-undef` activo, el linter lo señala en el acto.
      'lib/**/*.mjs',
    ],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      /**
       * `globals.node` y no `globals['node/builtin']`: en este repo el código de
       * Node usa `process`, `console`, `Buffer` y también temporizadores
       * (`setTimeout`, que aparece en el sondeo de arranque del verificador del
       * bundle). Los tres viven en el preset completo.
       */
      globals: globals.node,
    },
    rules: {
      /**
       * Un argumento o variable que empieza con `_` está sin usar A PROPÓSITO:
       * es la convención para "no lo uso pero la firma me obliga" (el manejador de
       * errores de Express necesita 4 parámetros para ser reconocido como tal).
       * Sin esta regla el linter obliga a inventar nombres o a borrar parámetros
       * que la firma necesita.
       */
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      /**
       * El preset de TypeScript ya activa su propia versión de `no-unused-vars`
       * como AVISO, y estos archivos (`.mjs`) también pasan por él. Se apaga esa
       * para no reportar el mismo hallazgo dos veces: en este bloque manda la
       * regla de arriba, que falla en vez de avisar.
       */
      '@typescript-eslint/no-unused-vars': 'off',
      /**
       * `no-empty` se relaja solo para bloques con comentario dentro: el repo
       * documenta mucho el POR QUÉ, y los `catch {}` que explican que el error
       * es esperable (ver `unstage()` en `verify-vercel-bundle.mjs`) no son
       * código muerto.
       */
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Los scripts usan `console` para informar; es su salida, no un descuido.
      'no-console': 'off',
    },
  },

  // --- tests (vitest en la raíz, `node --test` en server y scraper) ---------
  {
    files: [
      '**/*.test.ts',
      '**/*.test.tsx',
      '**/*.test.mjs',
      'test/**',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
        /**
         * `vitest.config.mts` activa `globals: true`, así que los tests del front
         * usan `describe`/`it`/`expect` sin importarlos. Sin declararlos aquí,
         * el linter marcaría cada test como `no-undef`.
         */
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        vi: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
  },
]);
