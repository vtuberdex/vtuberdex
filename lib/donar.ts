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
 * ID DE COMERCIANTE de la cuenta de PayPal del proyecto (PayPal → Configuración → Datos de la
 * empresa → «ID de comerciante»; NO el correo). Vacío = se usa el enlace fijo de arriba.
 *
 * POR QUÉ EXISTE: el enlace `ncp/payment/<id>` solo admite `locale.x` y `country.x` (documentación de
 * PayPal): no hay forma de pasarle una referencia, y el donante tiene que copiar el código a mano. El
 * formato de donación `paypal.com/donate?business=…&item_name=…&item_number=…` sí lleva `item_name` e
 * `item_number` hasta el detalle de la transacción, que es donde el mantenedor sabe a quién gradear.
 * No es un secreto (queda en la URL de cada donación) pero sí una decisión de la cuenta, por eso
 * está aquí y no inventado.
 */
export const PAYPAL_MERCHANT_ID = '';

/**
 * Enlace de donación de una ficha. Con ID de comerciante, lleva el código de la carta como
 * `item_number` y en el nombre del concepto; sin él, el enlace fijo de siempre.
 */
export function urlDeDonacion(card?: { dexNumber: number; name: string } | null, merchantId: string = PAYPAL_MERCHANT_ID): string {
  if (!card || !merchantId) return PAYPAL_DONATE_URL;
  const codigo = codigoDeReferencia(card.dexNumber);
  const consulta = new URLSearchParams({
    business: merchantId,
    no_recurring: '0',
    item_name: `VTuberDex ${codigo} · ${card.name}`,
    item_number: codigo,
    currency_code: 'USD',
  });
  return `https://www.paypal.com/donate?${consulta.toString()}`;
}

/**
 * Código que identifica una ficha en una donación: el mismo número de certificado de la carta
 * (`VTD-016` para la carta `#016`), derivado de su NÚMERO DE DEX. `dexDeCodigo` hace el camino
 * inverso para el mantenedor.
 */
export function codigoDeReferencia(dexNumber: number): string {
  return numeroDeCertificado(dexNumber);
}

/**
 * El número de dex a partir de un código `VTD-016` (sin importar mayúsculas ni espacios), o `null`.
 * Acepta 1 a 4 dígitos (el dex llega a 1005). Un código ANTIGUO de 6 dígitos (`VTD-000017`, que era
 * el id interno) se rechaza a propósito: leído como dex apuntaría a otra ficha.
 */
export function dexDeCodigo(texto: string): number | null {
  const coincide = /^\s*VTD-?(\d{1,4})\s*$/i.exec(texto);
  const dex = coincide ? Number(coincide[1]) : NaN;
  return Number.isInteger(dex) && dex >= 0 ? dex : null;
}
