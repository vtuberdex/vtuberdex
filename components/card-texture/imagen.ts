/**
 * Carga de imágenes del catálogo con manejo de fallo, memoizada por URL.
 *
 * POR QUÉ MEMOIZAR: cada carta pide tres o cuatro imágenes para generar sus texturas
 * y, al pasar de página, las 8 cartas nuevas las pedían en el momento en que el usuario
 * mira. Con la memoria, la precarga de las páginas vecinas (`lib/cache-paginas.ts`) deja
 * los `HTMLImageElement` ya cargados y la textura se genera sin esperar a la red. La
 * misma URL también se repite dentro de una página (emblemas de facción compartidos).
 *
 * Se guarda la PROMESA, no la imagen: dos cartas que piden la misma URL a la vez
 * comparten la petición. Un fallo no se memoiza, para que el siguiente intento vuelva a
 * pedirla. El límite acota la memoria: un `HTMLImageElement` retiene los bytes
 * comprimidos (decenas de KB), así que ~100 son unos pocos MB. Las URLs versionadas del
 * mantenedor (`?v=`) cambian al reemplazar la imagen, así que la memoria nunca sirve una
 * versión vieja.
 */

const LIMITE_IMAGENES = 96;

const memoria = new Map<string, Promise<HTMLImageElement | null>>();

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null);
  const hit = memoria.get(src);
  if (hit) {
    // LRU: lo recién usado va al final.
    memoria.delete(src);
    memoria.set(src, hit);
    return hit;
  }
  const promesa = new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => {
      memoria.delete(src);
      resolve(null);
    };
    image.src = src;
  });
  memoria.set(src, promesa);
  while (memoria.size > LIMITE_IMAGENES) {
    const masVieja = memoria.keys().next().value;
    if (masVieja === undefined) break;
    memoria.delete(masVieja);
  }
  return promesa;
}

/** Para los tests: olvida todas las imágenes memorizadas. */
export function __limpiarImagenes(): void {
  memoria.clear();
}
