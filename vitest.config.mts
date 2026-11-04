/**
 * Configuración de vitest para el front ya migrado a Next.
 *
 * La suite es la misma que tenía el paquete `web/` (76 tests: utilidades,
 * componentes, páginas) y sigue corriendo en jsdom, sin WebGL: los componentes
 * 3D se prueban por su contrato y el shader se valida como string, porque jsdom
 * no implementa `getContext` (ver `test/setup.ts`).
 */
import { defineConfig } from "vitest/config";
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
    coverage: { provider: "v8", reporter: ["text", "lcov"] },
    // La instrumentación de cobertura (v8 sobre jsdom) alarga cada test: el
    // alta del asistente de carta (`components/admin.test.tsx`) ronda los
    // 5,5 s y fallaba de forma intermitente con "Test timed out in 5000ms"
    // solo al correr `vitest run --coverage`. Se eleva el límite global en
    // vez de tocar, saltar o borrar el test.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
