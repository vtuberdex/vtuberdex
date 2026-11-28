// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
/**
 * ARTE de la hoja interior de un marco: una imagen con transparencia (el marco ornamentado que dibuja el
 * artista) que se pinta ENCIMA de la hoja, con huecos donde van la etiqueta y la ventana de la carta.
 *
 * POR QUÉ UNA IMAGEN Y NO CÓDIGO
 * ------------------------------
 * La filigrana dorada es dibujo a mano: en código serían cientos de curvas imposibles de ajustar. El resto de la
 * hoja (fondo negro, etiqueta, ventana, nota) sigue dibujándose igual; la imagen solo aporta el borde.
 *
 * CONTRATO PARA EL ARTISTA (para sustituir `marcos/donacion.webp` por la versión final)
 * · Proporción 1 : 1,62 (la de la placa; 988 × 1600 px o cualquier múltiplo), con alfa.
 * · Lo que sea transparente deja ver la hoja negra de debajo; la etiqueta y la ventana de la carta se pintan
 *   DEBAJO, así que el adorno puede pisar sus bordes (las volutas de las esquinas lo hacen).
 * · Márgenes: el adorno vive en el ~7 % exterior (`PREMIUM.layout.margin`); lo de dentro lo cubre la carta.
 *
 * La imagen baja con el bundle (import estático, hasheado por Next) y el lienzo es síncrono, así que la hoja se
 * dibuja primero sin ella y `useArteDeMarco` la repinta al llegar (misma razón que la fuente de misiones).
 */
import arteDonacion from "@/components/marcos/donacion.webp";

/** Claves de arte que un marco puede pedir (`PREMIUM.marcos.<origen>.insert.arte`). */
export type ClaveDeArte = "donacion";

/** Next entrega un import de imagen como `{ src }`; Vite (tests) como la URL a secas. */
function urlDe(importado: string | { src: string }): string {
  return typeof importado === "string" ? importado : importado.src;
}

const URLS: Record<ClaveDeArte, string> = {
  donacion: urlDe(arteDonacion as string | { src: string }),
};

/** Cargadas, por clave. De módulo y sin caducidad: es una imagen fija del bundle, la comparten todas las cartas. */
const cargadas = new Map<ClaveDeArte, HTMLImageElement>();
/** Descargas en vuelo: dos cartas pidiendo el mismo arte a la vez comparten UNA petición. */
const enVuelo = new Map<ClaveDeArte, Promise<boolean>>();

/** La imagen ya cargada, o `null` si aún no llegó (o nunca llegó). */
export function arteDeMarco(clave: ClaveDeArte): HTMLImageElement | null {
  return cargadas.get(clave) ?? null;
}

/** Guarda una imagen ya lista (la usa la carga y los tests, que no tienen red). */
export function registrarArteDeMarco(
  clave: ClaveDeArte,
  imagen: HTMLImageElement,
) {
  cargadas.set(clave, imagen);
}

/** Vacía la caché (solo para tests: la caché es de módulo y sobreviviría de un test al siguiente). */
export function olvidarArtesDeMarco() {
  cargadas.clear();
  enVuelo.clear();
}

/**
 * Baja el arte. Devuelve `false`, sin lanzar, si no se pudo: la hoja se queda sin adorno (negra y legible) y un
 * fallo NO se memoiza, así que la siguiente carta reintenta.
 */
export function cargarArteDeMarco(clave: ClaveDeArte): Promise<boolean> {
  if (cargadas.has(clave)) {
    return Promise.resolve(true);
  }
  const previa = enVuelo.get(clave);
  if (previa) {
    return previa;
  }
  const promesa = new Promise<boolean>((resolver) => {
    const imagen = new Image();
    imagen.onload = () => {
      cargadas.set(clave, imagen);
      resolver(true);
    };
    imagen.onerror = () => resolver(false);
    imagen.src = URLS[clave];
  }).finally(() => enVuelo.delete(clave));
  enVuelo.set(clave, promesa);
  return promesa;
}
