/**
 * `/robots.txt`: se rastrea el sitio público; la API, el mantenedor y las imágenes de la carta
 * no son contenido que deba indexarse. Los assets de Next (`/_next/`) NO se bloquean: el
 * buscador necesita el JS y el CSS para renderizar la página.
 */
import type { MetadataRoute } from "next";

import { urlAbsoluta } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      /**
       * Rastreadores de IA y de SEO que no aportan tráfico: se les pide que no pasen (y nginx les
       * responde 403 de todos modos, ver `conf.d/00-seguridad.conf`). robots.txt es cortesía; la
       * barrera real es nginx.
       */
      {
        userAgent: [
          "GPTBot",
          "ClaudeBot",
          "CCBot",
          "Bytespider",
          "PerplexityBot",
          "Amazonbot",
          "Reflectionbot",
          "AhrefsBot",
          "SemrushBot",
          "MJ12bot",
          "DotBot",
          "PetalBot",
        ],
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/v/archivo-completo"],
      },
    ],
    sitemap: urlAbsoluta("/sitemap.xml"),
  };
}
