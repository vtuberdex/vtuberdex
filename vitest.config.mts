/**
 * Configuración de vitest para el front ya migrado a Next.
 *
 * La suite es la misma que tenía el paquete `web/` (76 tests: utilidades,
 * componentes, páginas) y sigue corriendo en jsdom, sin WebGL: los componentes
 * 3D se prueban por su contrato y el shader se valida como string, porque jsdom
 * no implementa `getContext` (ver `test/setup.ts`).
 */
import { coverageConfigDefaults, defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    include: [
      "components/**/*.test.{ts,tsx}",
      "lib/**/*.test.{ts,tsx}",
      "test/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      // `scraper/**` y `scripts/**` no forman parte de la suite de Next: son
      // scripts `.mjs`/`.sh` que se lanzan a mano y solo ensuciaban el informe
      // al 0 %. Se amplían los excludes por defecto porque definir `exclude`
      // los sustituye.
      exclude: [
        ...coverageConfigDefaults.exclude,
        "scraper/**",
        "scripts/**",
      ],
    },
    // El límite global se deja en el valor por defecto de vitest (5 s) para
    // detectar cuelgues pronto. La instrumentación de v8 sobre jsdom alarga
    // el alta del asistente de carta por encima de esos 5 s, así que ese
    // único test recibe su propio timeout como tercer argumento.
  },
});
