/**
 * Invitación a donar por PayPal, en la ficha.
 *
 * EL ENLACE DE PAGO ES FIJO (el mismo para todos los VTubers), así que PayPal no sabe a qué carta
 * va la donación. La ficha muestra el CÓDIGO de la carta (`VTD-016`) con un botón de copiar, y
 * pide escribirlo en la nota del pago: es lo que permite al mantenedor saber a quién gradear.
 * Quien no lo escriba obliga a adivinar por el nombre del pagador, y el mantenedor tiene que
 * poder avisar de eso.
 *
 * Dice que la donación es voluntaria y que los fondos van al desarrollo del proyecto (no a lucro). El enlace abre PayPal en una pestaña nueva y SIN `opener`.
 * El logo es una marca simplificada en los azules de PayPal, en línea para no sumar otra petición
 * ni depender de una imagen externa.
 */
'use client';
import { useState } from 'react';

import { useI18n } from '@/lib/i18n';
import { PAYPAL_MERCHANT_ID, codigoDeReferencia, urlDeDonacion } from '@/lib/donar';
import { DONACION_POR_GRADO } from '@/lib/premium';
import type { PremiumInfo } from '@/lib/types';

export function PayPalLogo({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <path fill="#003087" d="M7.1 21.6 8 15.9H5.2L7.6 2.4h6.5c3 0 4.7 1.5 4.3 4-.5 3.3-2.9 5-6.3 5H9.9l-.7 4.4z" />
      <path fill="#0070e0" d="M9.4 22.5l.8-5h3.1c3.6 0 6.4-2 7.1-6 .2-1.2.1-2.2-.3-3 1.2 1 1.6 2.5 1.2 4.5-.8 4.5-3.8 6.4-7.5 6.4h-2.1l-.6 3.1z" />
      <path fill="#001c64" d="M7.4 2.4 5.2 15.9h2.8l.7-4.4h2.5c3.4 0 5.8-1.7 6.3-5 .1-.7.1-1.3-.1-1.8-.6-1.5-2.2-2.3-4.4-2.3z" opacity=".55" />
    </svg>
  );
}

/**
 * Copia con un `<textarea>` temporal y `execCommand('copy')`. Es el respaldo para cuando
 * `navigator.clipboard` NO existe: los navegadores solo la ofrecen en contextos seguros (HTTPS o
 * localhost), así que en un sitio servido por HTTP —como `test.vtuberdex.com` antes de tener
 * certificado— la copia fallaba siempre con «No se pudo copiar». `execCommand` está en desuso pero lo
 * soportan todos y no exige HTTPS; solo funciona dentro de un gesto del usuario (aquí, un clic).
 */
function copiarConSeleccion(texto: string): boolean {
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  area.style.pointerEvents = 'none';
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, texto.length);
  let copiado = false;
  try {
    copiado = document.execCommand('copy');
  } catch {
    copiado = false;
  }
  area.remove();
  return copiado;
}

/**
 * Copia al portapapeles. Primero la API moderna; si no existe (contexto no seguro) o la rechaza
 * (permiso denegado), el respaldo. Si tampoco hay, devuelve `false` y el código sigue visible para
 * copiarlo a mano.
 */
async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* cae al respaldo */
  }
  return copiarConSeleccion(texto);
}

/**
 * Instrucciones «de champú»: pocos pasos, una frase cada uno. Los montos salen de
 * `DONACION_POR_GRADO` para que la ficha, el mantenedor y la regla digan siempre lo mismo.
 * Redactado como reconocimiento (no como precio): ver cláusulas 9.2 y 9.5 de los términos.
 */
const GRADOS_DE_EJEMPLO = ['6', '8', '9.5', '10'] as const;

function ComoFunciona() {
  const { t } = useI18n();
  const ejemplo = GRADOS_DE_EJEMPLO.map((g) => t('donar.ejemploGrado', { usd: DONACION_POR_GRADO[g] ?? 0, grado: g })).join(' · ');
  return (
    <details className="group mt-3 rounded-xl border border-dex-line px-3 py-2 text-xs text-dex-muted" data-testid="donate-howto">
      {/* Colapsado por defecto: la guía es para quien la busca, no ruido para quien solo quiere donar. */}
      <summary className="cursor-pointer select-none font-semibold text-dex-ink marker:text-dex-muted">{t('donar.comoFunciona')}</summary>
      <ol className="mt-2 list-decimal space-y-1 pl-4">
        <li>{t('donar.paso1')}</li>
        <li>{t('donar.paso2')}</li>
        <li>{t('donar.paso3')}</li>
        <li>{t('donar.paso4')}</li>
        <li>{t('donar.paso5')}</li>
      </ol>
      <p className="mt-1.5">{t('donar.resumen', { ejemplo })}</p>
      <p className="mt-1.5 text-[11px]">{t('donar.voluntario')}</p>
    </details>
  );
}

export function DonatePayPal({
  premium,
  card,
  merchantId = PAYPAL_MERCHANT_ID,
}: {
  premium?: PremiumInfo | null;
  card?: { dexNumber: number; name: string };
  /** Solo para probar el formato con referencia; por defecto, el de `lib/donar.ts`. */
  merchantId?: string;
}) {
  const { t } = useI18n();
  const [copiado, setCopiado] = useState<boolean | null>(null);
  // Una carta en Black Label ya está en lo más alto: no hay nada que subir con una donación.
  if (premium?.grade === 'BL') return null;
  /** Con ID de comerciante el código va en el propio enlace (`item_number`); sin él, hay que pegarlo. */
  const viajaConElPago = Boolean(merchantId);
  // Mensaje único y sin promesas de contraprestación: antes hablaba de «gradear y subir de nivel», y
  // se leía como una venta. La donación es voluntaria y va al desarrollo del proyecto.
  const texto = t('donar.texto');
  return (
    <section aria-label={t('donar.etiqueta')} data-testid="donate-paypal" className="mt-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
      <p className="text-sm leading-relaxed text-dex-ink/90">{texto}</p>
      <ComoFunciona />
      {card && (
        <div className="mt-3 rounded-xl border border-dashed border-dex-line px-3 py-2.5" data-testid="donate-reference">
          <p className="text-xs text-dex-muted">
            {viajaConElPago ? (
              t('donar.codigoViaja', { nombre: card.name })
            ) : (
              t('donar.codigoNota', { nombre: card.name })
            )}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-black/40 px-2 py-1 font-mono text-sm font-bold text-dex-ink" data-testid="donate-code">
              {codigoDeReferencia(card.dexNumber)}
            </code>
            <button
              type="button"
              onClick={async () => setCopiado(await copiar(codigoDeReferencia(card.dexNumber)))}
              className="rounded-lg border border-dex-line px-2.5 py-1 text-xs text-dex-muted hover:text-dex-ink"
            >
              {copiado === true ? t('donar.copiado') : t('donar.copiar')}
            </button>
            {copiado === false && <span className="text-[11px] text-amber-200">{t('donar.noCopio')}</span>}
          </div>
        </div>
      )}
      <a
        href={urlDeDonacion(card, merchantId)}
        target="_blank"
        // Con el enlace fijo, el código no viaja: se copia al pulsar (el clic es el gesto que el
        // portapapeles exige) para pegarlo en la nota. No bloquea ni cambia la navegación.
        onClick={() => {
          if (card && !viajaConElPago) void copiar(codigoDeReferencia(card.dexNumber)).then(setCopiado);
        }}
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-2.5 rounded-xl bg-[#ffc439] px-4 py-2.5 text-sm font-bold text-[#003087] shadow hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dex-accent"
      >
        <PayPalLogo />
        {t('donar.boton')}
      </a>
    </section>
  );
}

export default DonatePayPal;
