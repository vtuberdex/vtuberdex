'use client';
/**
 * Visibilidad de las tarjetas de la grilla: qué se monta en el DOM y quién recibe
 * un contexto WebGL.
 *
 * UN OBSERVER COMPARTIDO
 * ----------------------
 * Antes cada tarjeta creaba SU PROPIO `IntersectionObserver`: medido en la página
 * real, **49 observers** para 24 tarjetas. Cada uno tiene su callback y su registro
 * en el motor, así que el coste crecía con el tamaño de la rejilla. Aquí hay **UNA
 * instancia** y las tarjetas solo se registran: el coste no depende de cuántas haya.
 *
 * POR QUÉ EL MARGEN ES 0 (y esto costó dos intentos)
 * -------------------------------------------------
 * El margen original era `100% 0px`: una pantalla ENTERA (857px). La rejilla mide
 * ~1,44 pantallas, así que TODO caía dentro del «cerca» — medido, 24 de 24
 * tarjetas dentro. Al no salir nunca de la zona, ninguna soltaba su contexto: las
 * sobrantes se quedaban en 2D para siempre. Esa era la demora que se percibía.
 *
 * Con margen 0 la zona es **el viewport exacto**: entran las que se ven (medido:
 * 15) y las de abajo se quedan fuera hasta que el scroll las trae. Entrar y salir
 * del viewport es también lo que redistribuye los contextos, así que no hace falta
 * ningún temporizador ni escuchar el scroll a mano.
 *
 * POR QUÉ NO SE DESMONTA EL CANVAS AL PERDER PRIORIDAD
 * ---------------------------------------------------
 * El primer intento movía el contexto con `active`, que hacía a `HoloCard`
 * desmontar y volver a crear el canvas. Medido: **72 contextos creados para 24
 * tarjetas** y **8 destruidos por el navegador** (esas cartas se quedaban con el
 * canvas muerto, en negro). Crear un contexto WebGL es de lo más caro que hace el
 * navegador, y con umbrales de intersección intermedios el reparto se recalculaba
 * en cada píxel de scroll: churn puro.
 *
 * Ahora el reparto es **estable**: una carta solo cambia de estado cuando entra o
 * sale del viewport, no al desplazarse dentro de él. Y quien pierde el contexto
 * por quedar fuera ya no está en el DOM, así que su canvas muere con él, sin
 * quedarse en negro a la vista.
 */

import { pickCardQuality } from '@/components/card-quality';

/**
 * Presupuesto de contextos vivos para ESTE dispositivo.
 *
 * Viene del plan de calidad (`card-quality.ts`), que lo deriva de las señales
 * reales del navegador: núcleos, memoria, puntero táctil, ahorro de datos y
 * `prefers-reduced-motion`. Antes era un número fijo (12) igual para todos: no
 * distinguía un escritorio de un móvil modesto, y en el segundo eso significa pasar
 * del techo del navegador y que mate contextos a la vista.
 *
 * Chrome sostiene **16** y destruye los más antiguos al pasarse (medido: de 60
 * creados, 16 vivos). El plan se queda por debajo con margen.
 */
function budget(): number {
  return pickCardQuality().maxContexts;
}

export interface CardVisibility {
  /** ¿Está en el viewport? Si no, la tarjeta se desmonta del DOM. */
  near: boolean;
  /** ¿Tiene contexto WebGL concedido? Si no, se muestra la vista 2D. */
  live: boolean;
}

type Listener = (state: CardVisibility) => void;

interface Entry {
  listener: Listener;
  near: boolean;
  live: boolean;
  priority: number;
}

let observer: IntersectionObserver | null = null;
const entries = new Map<Element, Entry>();
const granted = new Set<Entry>();

function notify(entry: Entry): void {
  try {
    entry.listener({ near: entry.near, live: entry.live });
  } catch {
    // Un suscriptor roto no debe impedir que el resto se entere del cambio.
  }
}

/**
 * Prioridad de una tarjeta: cuánto de ella se ve y cuánto de centrada está.
 *
 * Se combinan las dos cosas porque cada una sola falla: el ratio de intersección
 * vale 1 tanto para una carta diminuta en una esquina como para una grande y
 * centrada, y la distancia al centro no distingue una carta que está medio fuera.
 *
 * El recorte a 2 decimales hace de banda muerta: dos cartas casi empatadas no se
 * intercambian el contexto por fracciones de píxel.
 */
export function priorityOf(ratio: number, rect: DOMRect, viewportHeight: number): number {
  const center = rect.top + rect.height / 2;
  const distance = Math.abs(center - viewportHeight / 2) / (viewportHeight / 2);
  const score = ratio * 0.6 + Math.max(0, 1 - distance) * 0.4;
  return Math.round(score * 100) / 100;
}

/**
 * Reparte los contextos entre las cartas del viewport, dando prioridad a las más
 * visibles. Se ejecuta cuando alguna entra o sale — no al desplazarse dentro.
 */
function rebalance(): void {
  for (const entry of [...granted]) {
    if (!entry.near) {
      granted.delete(entry);
      entry.live = false;
      notify(entry);
    }
  }

  const pending = [...entries.values()]
    .filter((entry) => entry.near && !granted.has(entry))
    .sort((a, b) => b.priority - a.priority);

  for (const entry of pending) {
    if (granted.size >= budget()) break;
    granted.add(entry);
    entry.live = true;
    notify(entry);
  }
}

function handleEntries(list: IntersectionObserverEntry[]): void {
  const viewportHeight = window.innerHeight;
  for (const item of list) {
    const entry = entries.get(item.target);
    if (!entry) continue;
    entry.near = item.isIntersecting;
    entry.priority = priorityOf(item.intersectionRatio, item.boundingClientRect, viewportHeight);
  }
  rebalance();
}

function ensureObserver(): IntersectionObserver | null {
  if (observer) return observer;
  if (typeof IntersectionObserver === 'undefined') return null;
  observer = new IntersectionObserver(handleEntries, {
    // Zona = viewport exacto: ver la explicación de la cabecera.
    rootMargin: '0px',
    threshold: 0,
  });
  return observer;
}

/**
 * Registra una tarjeta. Devuelve la función para dejar de observarla.
 *
 * Arranca con `near: true` para que el HTML del servidor traiga el contenido (es
 * estático y no debe depender de JS); el primer reparto lo ajusta enseguida.
 */
export function observeCard(element: Element, listener: Listener): () => void {
  const instance = ensureObserver();
  if (!instance) {
    // Sin `IntersectionObserver` se muestra todo, sin 3D: degradar a «mostrar el
    // contenido» y no a un hueco.
    try {
      listener({ near: true, live: false });
    } catch {
      /* suscriptor roto */
    }
    return () => {};
  }

  const entry: Entry = { listener, near: true, live: false, priority: 0 };
  entries.set(element, entry);
  instance.observe(element);
  rebalance();

  return () => {
    instance.unobserve(element);
    entries.delete(element);
    if (granted.delete(entry)) rebalance();
  };
}

/** Para los tests: limpia el estado del reparto entre casos. */
export function __resetCardVisibility(): void {
  for (const element of entries.keys()) observer?.unobserve(element);
  entries.clear();
  granted.clear();
}
