/**
 * SEO: URL del sitio, descripciones y datos estructurados (JSON-LD).
 *
 * Es TypeScript puro, sin DOM ni base de datos, para poder probarlo sin montar nada: la lectura
 * de datos vive en `lib/seo-datos.mjs` y las rutas solo juntan las dos cosas.
 *
 * POR QUÉ EXISTE: el catálogo y la ficha se pintan en el cliente, así que lo único que veía un
 * rastreador era el `<title>` genérico y un esqueleto. Aquí sale todo lo que el servidor puede
 * decir SIN ejecutar JavaScript: título y descripción propios, URL canónica, imagen social y
 * JSON-LD.
 */
import type { VtuberDetail } from '@/lib/types';

export const NOMBRE_SITIO = 'VTuberDex';

export const DESCRIPCION_SITIO =
  'VTuberDex: catálogo buscable de VTubers hispanohablantes con carta holográfica 3D, ficha, atributos y habilidades.';

/**
 * Origen público del sitio, sin barra final.
 *
 * El orden es el de más a menos explícito: `SITE_URL` (lo fija quien despliega con dominio
 * propio), el dominio de producción que Vercel inyecta y, en local, `localhost`. NO se fija un
 * dominio en el código: un canonical que apunte a un dominio ajeno saca la página del índice.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicita = env.SITE_URL?.trim();
  if (explicita) return explicita.replace(/\/+$/, '');
  const vercel = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return `http://localhost:${env.PORT ?? 3000}`;
}

/** URL absoluta de una ruta del sitio. */
export function urlAbsoluta(ruta: string, base: string = siteUrl()): string {
  return `${base}${ruta.startsWith('/') ? ruta : `/${ruta}`}`;
}

/** Ruta pública de una ficha. El slug es ASCII, pero se codifica por si el mantenedor mete otra cosa. */
export const rutaDeFicha = (slug: string) => `/v/${encodeURIComponent(slug)}`;

const MAX_DESCRIPCION = 160;

function recortar(texto: string, max = MAX_DESCRIPCION): string {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (limpio.length <= max) return limpio;
  // Se corta en el último espacio para no partir una palabra, y se marca con puntos suspensivos.
  const corte = limpio.slice(0, max - 1);
  const espacio = corte.lastIndexOf(' ');
  return `${(espacio > max * 0.6 ? corte.slice(0, espacio) : corte).replace(/[\s,.;:]+$/, '')}…`;
}

type FichaSeo = Pick<
  VtuberDetail,
  'name' | 'dexNumber' | 'phrase' | 'countries' | 'groups' | 'factions' | 'languages' | 'skills' | 'level'
>;

/**
 * Descripción de la ficha: lo que de verdad distingue al VTuber (frase, país, facciones, habilidades),
 * en una sola frase de ≤160 caracteres, que es lo que un buscador suele mostrar.
 */
export function descripcionDeFicha(card: FichaSeo): string {
  const partes: string[] = [];
  const pais = card.countries[0]?.name;
  partes.push(
    `${card.name}, VTuber${pais ? ` de ${pais}` : ''}, carta #${String(card.dexNumber).padStart(3, '0')} de la ${NOMBRE_SITIO}.`,
  );
  if (card.phrase?.trim()) partes.push(`«${card.phrase.trim()}»`);
  if (card.factions.length) partes.push(`Facciones: ${card.factions.join(', ')}.`);
  const habilidades = (card.skills ?? []).map((s) => s.name).filter((n): n is string => Boolean(n));
  if (habilidades.length) partes.push(`Habilidades: ${habilidades.slice(0, 3).join(', ')}.`);
  return recortar(partes.join(' '));
}

/**
 * Título de la ficha. El sufijo del sitio lo añade la plantilla del layout raíz, así que el
 * resultado es `<nombre> · VTuberDex`: el MISMO que escribe `DetailPage` en `document.title`
 * al hidratar. Si divergieran, el título cambiaría tras cargar y el buscador vería dos.
 */
export const tituloDeFicha = (card: Pick<FichaSeo, 'name'>) => card.name;

/**
 * JSON-LD de la ficha: una `ProfilePage` cuyo sujeto es la persona (`Person`).
 * Solo se emiten datos que existen: un campo vacío no se inventa.
 */
export function jsonLdDeFicha(
  card: Pick<VtuberDetail, 'name' | 'slug' | 'phrase' | 'birthday' | 'countries' | 'groups' | 'socials' | 'images'>,
  base: string = siteUrl(),
) {
  const url = urlAbsoluta(rutaDeFicha(card.slug), base);
  const imagen = card.images.character ? urlAbsoluta(card.images.character, base) : undefined;
  const persona: Record<string, unknown> = {
    '@type': 'Person',
    '@id': `${url}#persona`,
    name: card.name,
    url,
    ...(imagen ? { image: imagen } : {}),
    ...(card.phrase?.trim() ? { description: card.phrase.trim() } : {}),
    ...(card.countries.length
      ? { nationality: card.countries.map((c) => ({ '@type': 'Country', name: c.name })) }
      : {}),
    ...(card.groups.length
      ? { memberOf: card.groups.map((g) => ({ '@type': 'Organization', name: g })) }
      : {}),
    ...(card.socials?.length ? { sameAs: card.socials.map((s) => s.url).filter(Boolean) } : {}),
  };
  return {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'ProfilePage', '@id': url, url, name: card.name, mainEntity: { '@id': persona['@id'] } },
      persona,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: NOMBRE_SITIO, item: urlAbsoluta('/', base) },
          { '@type': 'ListItem', position: 2, name: card.name, item: url },
        ],
      },
    ],
  };
}

/** JSON-LD del índice: el sitio (con su buscador) y la lista de las primeras fichas. */
export function jsonLdDelIndice(fichas: Array<{ slug: string; name: string }>, base: string = siteUrl()) {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        '@id': `${base}/#sitio`,
        url: urlAbsoluta('/', base),
        name: NOMBRE_SITIO,
        description: DESCRIPCION_SITIO,
        inLanguage: 'es',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${base}/?q={termino}` },
          'query-input': 'required name=termino',
        },
      },
      {
        '@type': 'ItemList',
        name: `Catálogo de ${NOMBRE_SITIO}`,
        itemListElement: fichas.map((f, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: f.name,
          url: urlAbsoluta(rutaDeFicha(f.slug), base),
        })),
      },
    ],
  };
}

/**
 * Serializa JSON-LD para un `<script>`. Se escapa `<` porque un nombre editable desde el
 * mantenedor con `</script>` cerraría la etiqueta e inyectaría HTML.
 */
export const serializarJsonLd = (datos: unknown) => JSON.stringify(datos).replace(/</g, '\\u003c');
