/**
 * Configuración de Next.js para Vercel.
 *
 * `outputFileTracingIncludes` es la pieza crítica del despliegue: Vercel empaqueta
 * cada función analizando qué archivos importa el código (Node File Trace), y la
 * base SQLite se lee con `fs` en una ruta construida —el trace no puede
 * deducirla—, así que hay que declararla explícitamente o la función arrancaría
 * sin catálogo. Verificado: la ruta aparece en el `.nft.json` de la función.
 *
 * La base NO va en `public/` (sería descargable por HTTP) sino en `deploy/data/`,
 * que solo entra en el bundle de las funciones.
 */
const nextConfig = {
  // Build autocontenido para servir con `node server.js` detrás de nginx
  // (scripts/release.sh). Es opt-in: Vercel empaqueta por su cuenta y no lo necesita.
  ...(process.env.VTUBERDEX_STANDALONE ? { output: 'standalone' } : {}),
  outputFileTracingIncludes: {
    '/api/**': ['./deploy/data/**'],
    '/images/**': ['./deploy/data/**'],
  },
  // El front habla con su propia API por rutas relativas; no hay dominio externo.
  images: { unoptimized: true },
  /**
   * Orígenes autorizados a pedir los assets SOLO-DEV (`/_next/hmr`, los chunks
   * sin compilar, el websocket de recarga).
   *
   * Next los bloquea por defecto cuando el `Origin` no es `localhost` ni el
   * hostname con el que arrancó el servidor, así que al abrir la app desde OTRA
   * máquina de la LAN (`http://192.168.100.90:3000`) el navegador fallaba al
   * cargar `_next/hmr` y la página se quedaba a medias.
   *
   * Se comparan solo HOSTNAMES: sin `https://`, sin puerto y sin ruta. El
   * comodín `*` cubre exactamente una etiqueta, `**` una o más.
   *
   * No tiene efecto en producción: los assets de dev no existen en un build.
   */
  allowedDevOrigins: [
    '192.168.100.90',   // IP LAN de esta máquina (fuchikoma)
    'fuchikoma',        // el hostname, para entrar por nombre
    '*.local',          // mDNS de la LAN doméstica
    '100.98.52.34',     // IP de Tailscale
  ],
  // `agentRules` se deja en su valor por defecto (true) a propósito.
  //
  // `next dev` mantiene un bloque gestionado entre `<!-- BEGIN:nextjs-agent-rules
  // -->` y `<!-- END:nextjs-agent-rules -->` al final de AGENTS.md. Se comprobó
  // en la doc oficial (`node_modules/next/dist/docs/01-app/02-guides/ai-agents.md`)
  // que ese bloque se AÑADE y todo lo escrito FUERA de los marcadores se
  // PRESERVA al actualizarlo — así que no hay riesgo de perder el AGENTS.md
  // escrito a mano de este repo, y el bloque aporta el aviso de que Next 16
  // cambia APIs respecto a datos de entrenamiento.
};

export default nextConfig;
