'use client';
/**
 * Banner de «Primeros pasos», descartable.
 *
 * El descarte se recuerda en `localStorage`, que se lee en un efecto y dentro de
 * try/catch: durante el render del servidor no existe, y en ventanas privadas o con
 * datos bloqueados lanza. Mientras no se sabe (`null`) no se pinta nada, para que quien
 * ya lo descartó no vea un parpadeo del banner al cargar.
 */
import { useEffect, useState } from 'react';

import { ghostButton } from '@/components/admin/ui';

export const ONBOARDING_KEY = 'vtuberdex.admin.onboarding.dismissed';

export function GettingStarted({ onGoFactions, onNewCard }: { onGoFactions: () => void; onNewCard: () => void }) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      setDismissed(window.localStorage.getItem(ONBOARDING_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);

  if (dismissed !== false) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // Sin almacenamiento el banner vuelve en la próxima visita: es un detalle, no un fallo.
    }
  };

  return (
    <section aria-label="Primeros pasos" data-testid="getting-started" className="mb-6 rounded-2xl border border-dex-accent/40 bg-dex-accent/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-extrabold text-dex-ink">Primeros pasos</h2>
          <p className="text-sm text-dex-muted">Si es tu primera vez aquí, sigue este orden:</p>
        </div>
        <button type="button" className={ghostButton} onClick={dismiss}>
          Entendido, ocultar
        </button>
      </div>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-dex-ink">
        <li>
          Crea o revisa las <button type="button" className="underline" onClick={onGoFactions}>facciones y sus emblemas</button>.
        </li>
        <li>
          Crea una ficha con <button type="button" className="underline" onClick={onNewCard}>«Nueva carta»</button>.
        </li>
        <li>Súbele las imágenes (personaje, logo y fondo).</li>
        <li>Publícala en el último paso del asistente.</li>
      </ol>
    </section>
  );
}
