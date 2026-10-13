import { defineConfig } from "vitest/config";

/**
 * Configuración de vitest para el scraper.
 *
 * El paquete no tenía config propia y vitest heredaba la del front
 * (vtuberdex/vitest.config.mts), cuyo `include` solo cubre .ts/.tsx: por eso
 * `npx vitest run test/ocr-write.test.mjs` respondía "No test files found".
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
  },
});
