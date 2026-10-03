/**
 * Invitación a donar por PayPal, en la ficha.
 *
 * EL ENLACE DE PAGO ES FIJO (el mismo para todos los VTubers), así que PayPal no sabe a qué carta
 * va la donación. La ficha muestra el CÓDIGO de la carta (`VTD-000017`) con un botón de copiar, y
 * pide escribirlo en la nota del pago: es lo que permite al mantenedor saber a quién gradear.
 * Quien no lo escriba obliga a adivinar por el nombre del pagador, y el mantenedor tiene que
 * poder avisar de eso.
 *
 * Dice para qué sirve el dinero en términos de la carta: gradearla (entra en la placa de
 * acrílico) y subirla de nivel. El enlace abre PayPal en una pestaña nueva y SIN `opener`.
 * El logo es una marca simplificada en los azules de PayPal, en línea para no sumar otra petición
 * ni depender de una imagen externa.
 */
'use client';
import { useState } from 'react';

import { PAYPAL_DONATE_URL, codigoDeReferencia } from '@/lib/donar';
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

/** Copia al portapapeles; sin permiso (HTTP, navegador antiguo) devuelve `false` y el código sigue visible para copiarlo a mano. */
async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    return false;
  }
}

export function DonatePayPal({ premium, card }: { premium?: PremiumInfo | null; card?: { id: number; name: string } }) {
  const [copiado, setCopiado] = useState<boolean | null>(null);
  // Una carta en Black Label ya está en lo más alto: no hay nada que subir con una donación.
  if (premium?.grade === 'BL') return null;
  const texto = premium
    ? 'Esta carta ya es premium: cada mes que nos apoyes por PayPal sube de grado, hasta la Black Label.'
    : 'Si quieres gradear y subir de nivel esta carta puedes donar a nuestro PayPal.';
  return (
    <section aria-label="Donar" data-testid="donate-paypal" className="mt-4 rounded-2xl border border-dex-line bg-dex-panel/60 p-4">
      <p className="text-sm leading-relaxed text-dex-ink/90">{texto}</p>
      {card && (
        <div className="mt-3 rounded-xl border border-dashed border-dex-line px-3 py-2.5" data-testid="donate-reference">
          <p className="text-xs text-dex-muted">
            Escribe este código en la <strong className="text-dex-ink">nota del pago</strong> para que sepamos a qué carta ({card.name}) va tu
            donación:
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="rounded-md bg-black/40 px-2 py-1 font-mono text-sm font-bold text-dex-ink" data-testid="donate-code">
              {codigoDeReferencia(card.id)}
            </code>
            <button
              type="button"
              onClick={async () => setCopiado(await copiar(codigoDeReferencia(card.id)))}
              className="rounded-lg border border-dex-line px-2.5 py-1 text-xs text-dex-muted hover:text-dex-ink"
            >
              {copiado === true ? 'Copiado ✓' : 'Copiar código'}
            </button>
            {copiado === false && <span className="text-[11px] text-amber-200">No se pudo copiar: selecciónalo a mano.</span>}
          </div>
        </div>
      )}
      <a
        href={PAYPAL_DONATE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-flex items-center gap-2.5 rounded-xl bg-[#ffc439] px-4 py-2.5 text-sm font-bold text-[#003087] shadow hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dex-accent"
      >
        <PayPalLogo />
        Donar con PayPal
      </a>
    </section>
  );
}

export default DonatePayPal;
