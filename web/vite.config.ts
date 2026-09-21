import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.VTUBERDEX_API ?? 'http://localhost:4000';

/**
 * Hostnames extra permitidos por el dev-server.
 *
 * Vite 7 rechaza cualquier `Host` que no sea una IP (protección contra DNS
 * rebinding), así que abrir la app por nombre de máquina — p. ej.
 * http://fuchikoma:5173 — devuelve "Blocked request" aunque el puerto sí esté
 * accesible. Se acepta el que se pase por `VTUBERDEX_ALLOWED_HOSTS`
 * (separado por comas) además de los alias locales habituales.
 */
const ALLOWED_HOSTS = [
  'fuchikoma',
  '.local',
  'localhost',
  ...(process.env.VTUBERDEX_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: true,
    port: 5173,
    allowedHosts: [...new Set(ALLOWED_HOSTS)],
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/images': { target: API_TARGET, changeOrigin: true },
    },
  },
  preview: {
    host: true,
    port: 4173,
    allowedHosts: [...new Set(ALLOWED_HOSTS)],
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
  },
});
