/**
 * Donaciones: el enlace de pago de PayPal de la ficha.
 *
 * `ncp/payment/<id>` es un ENLACE DE PAGO público de la cuenta del proyecto (cualquiera que lo
 * vea en la web ve el identificador); no es una credencial. Va en un archivo propio para cambiar
 * de enlace en un solo sitio.
 *
 * LIMITE CONOCIDO: es un enlace FIJO, igual para todos los VTubers. PayPal no sabe a qué carta
 * va la donación. Por eso la ficha muestra un código de referencia (`codigoDeReferencia`) que
 * el donante escribe en la nota del pago, y el mantenedor sabe buscar una ficha por ese código.
 */
import { numeroDeCertificado } from '@/lib/premium';

export const PAYPAL_PAYMENT_ID = 'TQ6SU2TZL6ZEU';

export const PAYPAL_DONATE_URL = `https://www.paypal.com/ncp/payment/${PAYPAL_PAYMENT_ID}`;

/**
 * Código que identifica una ficha en una donación: el mismo número de certificado de la carta
 * (`VTD-000017`), derivado de su id. `idDeCodigo` hace el camino inverso para el mantenedor.
 */
export const codigoDeReferencia = (id: number): string => numeroDeCertificado(id);

/** El id de una ficha a partir de un código `VTD-000017` (sin importar mayúsculas ni espacios), o `null`. */
export function idDeCodigo(texto: string): number | null {
  const coincide = /^\s*VTD-?(\d{1,9})\s*$/i.exec(texto);
  const id = coincide ? Number(coincide[1]) : NaN;
  return Number.isInteger(id) && id > 0 ? id : null;
}
