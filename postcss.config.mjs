/**
 * Configuración de PostCSS para Tailwind 4.
 *
 * Con Vite el plugin venía de `@tailwindcss/vite`; en Next el camino es PostCSS.
 * El CSS es el mismo (`app/globals.css`), solo cambia quién lo procesa.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
