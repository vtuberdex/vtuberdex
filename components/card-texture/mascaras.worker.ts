/**
 * Worker de las máscaras: recibe los píxeles RGBA de origen y devuelve los de la máscara.
 *
 * Solo hace matemática (`mascaras-puras.ts`): el hilo principal sigue siendo quien dibuja
 * el arte en un canvas, lee sus píxeles (`getImageData`) y escribe el resultado
 * (`putImageData`), porque un worker no tiene canvas 2D sin `OffscreenCanvas` y ésta no
 * está en todos los navegadores que soportan WebGL. Los búferes viajan TRANSFERIDOS (no
 * copiados) en los dos sentidos.
 */
import { calcularMascara, type TipoMascara } from './mascaras-puras';

interface Pedido {
  id: number;
  tipo: TipoMascara;
  data: Uint8ClampedArray;
}

const canal = self as unknown as {
  onmessage: ((event: MessageEvent<Pedido>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
};

canal.onmessage = (event) => {
  const { id, tipo, data } = event.data;
  const out = new Uint8ClampedArray(data.length);
  calcularMascara(tipo, data, out);
  canal.postMessage({ id, out }, [out.buffer]);
};
