/** Fábrica de datos de prueba para los componentes. */
import type { ApiListResponse, Facets, VtuberCard, VtuberDetail } from '@/lib/types';

export function makeCard(overrides: Partial<VtuberCard> = {}): VtuberCard {
  return {
    id: 18,
    dexNumber: 18,
    slug: 'gkuro-monochrome',
    name: 'GKuro Monochrome',
    phrase: 'Pixelartista y developer',
    cardText: 'Desde entonces sobrevive entre el ruido de una cafetería casi vacía.',
    cardTextConfidence: 80,
    themeColor: '#616161',
    secondaryColor: 'Blanco/Negro',
    palette: [],
    level: 3,
    powerScore: 1420,
    hasDetail: true,
    status: 'published',
    birthday: '23 de Mayo',
    height: '1.72 m',
    hashtag: '#MonochromeArte',
    favoriteColor: 'Blanco/Negro',
    countries: [{ slug: 'chile', name: 'Chile', flag: '🇨🇱' }],
    groups: ['Moonly'],
    artists: ['PROJECT AR-AI.I'],
    factions: ['Mythical Legacy'],
    factionIcons: [{ label: 'Mythical Legacy', icon: 'images/faction/mythical-legacy.png' }],
    languages: ['es'],
    statsPreview: [142, 233, 123],
    socialCount: 10,
    images: {
      character: 'images/character/gkuro-monochrome.webp',
      card: 'images/card/gkuro-monochrome.webp',
      thumb: 'images/thumb/gkuro-monochrome.webp',
      logo: 'images/logo/gkuro-monochrome.webp',
      // `radar` se deja en `null` a propósito: su carpeta se eliminó (la dibuja
      // `StatBars` desde los datos) y así los tests reflejan el estado real del
      // despliegue en vez de una imagen que ya no existe.
      radar: null,
      // El FONDO de la carta 3D también nace en `null`: no lo produce el scraper,
      // solo existe si alguien lo sube desde el mantenedor. Así los tests cubren el
      // caso mayoritario (sin fondo) y la capa no cambia nada de lo que se veía.
      background: null,
    },
    ...overrides,
  };
}

export function makeFacets(overrides: Partial<Facets> = {}): Facets {
  return {
    countries: [
      { slug: 'chile', name: 'Chile', flag: '🇨🇱', count: 137 },
      { slug: 'mexico', name: 'México', flag: '🇲🇽', count: 232 },
    ],
    languages: [{ slug: 'es', name: 'Español', count: 777 }],
    groups: [{ slug: 'moonly', name: 'Moonly', count: 12 }],
    artists: [{ slug: 'project-ar-ai-i', name: 'PROJECT AR-AI.I', count: 5 }],
    factions: [{ slug: 'mythical-legacy', name: 'Mythical Legacy', count: 40 }],
    totals: { total: 785, withDetail: 211, themes: 205 },
    ...overrides,
  };
}

export function makeList(overrides: Partial<ApiListResponse> = {}): ApiListResponse {
  return {
    items: [makeCard()],
    total: 1,
    page: 1,
    perPage: 24,
    pageCount: 1,
    facets: makeFacets(),
    ...overrides,
  };
}

export function makeDetail(overrides: Partial<VtuberDetail> = {}): VtuberDetail {
  return {
    ...makeCard(),
    profile: [
      { label: 'Cumpleaños', value: '23 de Mayo' },
      { label: 'Altura', value: '1.72 m' },
    ],
    stats: [
      { label: 'HP', slug: 'hp', value: 1710, valueText: null, max: 1710, position: 0 },
      { label: 'Ataque', slug: 'attack', value: 142, valueText: null, max: null, position: 1 },
    ],
    skills: [
      {
        category: 'active',
        section: 'Active Skills',
        type: 'Ofensivo',
        name: 'Monochrome Resolve',
        effect: 'Ataque Mágico Base +30.',
        effectHtml: 'Ataque Mágico Base +30.',
        factions: [{ src: 'facciones/Veilbreaker.png', name: 'Mythical Legacy' }],
        position: 0,
      },
    ],
    socials: [
      { platform: 'x', label: 'X', url: 'https://twitter.com/GKuroMonochrome', icon: 'icons/x.png' },
    ],
    assets: [{ kind: 'card', path: 'images/card/gkuro-monochrome.webp', sourceUrl: null, width: null, height: null, bytes: null }],
    experience: { current: 65, max: 500 },
    ...overrides,
  };
}
